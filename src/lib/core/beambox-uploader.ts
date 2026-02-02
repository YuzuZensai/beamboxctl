import { BleUploader } from "../ble/ble-client.ts";
import { ImageProcessor } from "../processing/image-processor.ts";
import type {
  BLEConfig,
  ImageConfig,
  ProtocolConfig,
} from "../protocol/index.ts";
import {
  DEFAULT_BLE_CONFIG,
  DEFAULT_IMAGE_CONFIG,
  DEFAULT_PROTOCOL_CONFIG,
  PayloadBuilder,
} from "../protocol/index.ts";
import { UploadError } from "../utils/errors.ts";
import { logger } from "../utils/logger.ts";

export interface UploadOptions {
  imagePath?: string;
  imageData?: Buffer;
  targetSize?: [number, number];
  onProgress?: (progress: number) => void;
}

/**
 * Main uploader class
 */
export class BeamBoxUploader {
  private ble: BleUploader;
  private imageProcessor: ImageProcessor;
  private payloadBuilder: PayloadBuilder;
  private imageConfig: ImageConfig;

  constructor(
    deviceAddress?: string,
    chunkDelay?: number,
    bleConfig?: BLEConfig,
    protocolConfig?: ProtocolConfig,
    imageConfig?: ImageConfig,
    verbose: boolean = false,
  ) {
    this.imageConfig = imageConfig ?? DEFAULT_IMAGE_CONFIG;
    this.ble = new BleUploader(
      deviceAddress ?? null,
      chunkDelay ?? null,
      bleConfig ?? DEFAULT_BLE_CONFIG,
      protocolConfig ?? DEFAULT_PROTOCOL_CONFIG,
      verbose,
    );
    this.imageProcessor = new ImageProcessor(this.imageConfig);
    this.payloadBuilder = new PayloadBuilder(
      protocolConfig ?? DEFAULT_PROTOCOL_CONFIG,
    );
  }

  /**
   * Connect to the device
   * @returns True if connected successfully
   */
  public async connect(): Promise<boolean> {
    return await this.ble.connect();
  }

  /**
   * Disconnect from the device
   */
  public async disconnect(): Promise<void> {
    await this.ble.disconnect();
  }

  /**
   * Upload an image to the device
   *
   * @param options Upload options
   * @returns True if upload successful
   */
  public async upload(options: UploadOptions): Promise<boolean> {
    const { imagePath, imageData, targetSize, onProgress } = options;

    if (!imageData && !imagePath) {
      throw new UploadError("No image provided");
    }

    const effectiveSize = targetSize ?? this.imageConfig.defaultSize;

    // Prepare JPEG data
    let jpegData: Buffer;
    if (imageData) {
      jpegData = imageData;
    } else if (imagePath) {
      jpegData = await this.imageProcessor.prepareFromFile(
        imagePath,
        effectiveSize,
      );
    } else {
      throw new UploadError("No image provided");
    }

    // Wait a moment after connection to ensure device is fully ready
    logger.info("Waiting for device to be fully ready...");
    await this.sleep(1000);

    // Step 1: Send image info packet to announce upload
    const imageInfoPayload = this.payloadBuilder.buildImageInfo();
    await this.ble.sendImageInfo(imageInfoPayload);
    logger.info("Sent image info packet, proceeding to data transfer");

    // Step 2: Build and send image data payload
    const fullData = this.payloadBuilder.buildImageData(
      jpegData,
      effectiveSize,
    );
    const prefixLen = fullData.length - jpegData.length;
    logger.info(
      `Payload bytes: total=${fullData.length}, jpeg=${jpegData.length}, header+prefix=${prefixLen}`,
    );

    // Send data in chunks with protocol packets
    const ok = await this.ble.sendData(fullData, onProgress);

    if (!ok) {
      logger.error("Upload reported error");
      return false;
    }

    // Wait for final response
    if (!(await this.ble.waitForResponse(5.0))) {
      logger.error("Upload timeout waiting for response");
      return false;
    }

    return true;
  }

  /**
   * Upload an image from a file
   * @param imagePath Path to the image file
   * @param targetSize Target image size
   * @param onProgress Progress callback
   * @returns True if upload successful
   */
  public async uploadImageFromFile(
    imagePath: string,
    targetSize?: [number, number],
    onProgress?: (progress: number) => void,
  ): Promise<boolean> {
    return await this.upload({ imagePath, targetSize, onProgress });
  }

  /**
   * Upload a checkerboard test pattern
   * @param targetSize Target image size
   * @param squares Number of squares per side
   * @param onProgress Progress callback
   * @returns True if upload successful
   */
  public async uploadCheckerboard(
    targetSize?: [number, number],
    squares?: number,
    onProgress?: (progress: number) => void,
  ): Promise<boolean> {
    const effectiveSize = targetSize ?? this.imageConfig.defaultSize;
    const effectiveSquares = squares ?? this.imageConfig.checkerboardSquares;

    logger.info(
      `Generating ${effectiveSquares}x${effectiveSquares} checkerboard pattern...`,
    );
    const checkerboardPng = await this.imageProcessor.generateCheckerboard(
      effectiveSize,
      effectiveSquares,
    );

    const jpegData = await this.imageProcessor.prepareImage(
      checkerboardPng,
      effectiveSize,
    );

    return await this.upload({
      imageData: jpegData,
      targetSize: effectiveSize,
      onProgress,
    });
  }

  /**
   * Check if device is ready
   * @returns True if device is ready
   */
  public isDeviceReady(): boolean {
    return this.ble.isDeviceReady();
  }

  /**
   * Get device status notifications
   * @param timeoutMs Maximum time to wait for status in milliseconds
   * @returns Device status object and all notifications
   */
  public async getStatus(timeoutMs: number = 10000): Promise<{
    status: Record<string, unknown> | null;
    notifications: Array<{ time: number; data: Buffer; parsed: any }>;
  }> {
    try {
      logger.info("Connecting to device to get status...");

      const connected = await this.ble.connect();
      if (!connected) {
        throw new Error("Failed to connect to device");
      }

      logger.info("Waiting for device status notifications...");

      // Wait for at least one status notification (PacketType.DEVICE_STATUS)
      const startTime = Date.now();
      const checkInterval = 100;

      while (Date.now() - startTime < timeoutMs) {
        const deviceStatus = this.ble.getDeviceStatus();
        if (deviceStatus && deviceStatus.type === 13) {
          logger.info(
            `Device status received: ${JSON.stringify(deviceStatus)}`,
          );
          logger.info("Device is ready for upload");
          break;
        }

        await this.sleep(checkInterval);
      }

      const notifications = this.ble.getNotifications();

      logger.info(`Received ${notifications.length} notifications from device`);

      return {
        status: this.ble.getDeviceStatus(),
        notifications,
      };
    } finally {
      await this.disconnect();
    }
  }

  /**
   * Get device status
   * @returns Device status object
   */
  public getDeviceStatus(): Record<string, unknown> | null {
    return this.ble.getDeviceStatus();
  }

  /**
   * Check if an error occurred
   * @returns True if error occurred
   */
  public hasError(): boolean {
    return this.ble.hasError();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
