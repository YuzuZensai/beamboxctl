import type {
  BLEConfig,
  ProtocolConfig,
  ImageConfig,
} from "../protocol/index.ts";
import {
  DEFAULT_BLE_CONFIG,
  DEFAULT_PROTOCOL_CONFIG,
  DEFAULT_IMAGE_CONFIG,
  PacketType,
} from "../protocol/index.ts";
import { BleUploader } from "../ble/ble-client.ts";
import { ImageProcessor } from "../processing/image-processor.ts";
import { MediaDetector } from "../processing/media-detector.ts";
import { FrameExtractor } from "../processing/frame-extractor.ts";
import { PayloadBuilder } from "../protocol/index.ts";
import { logger } from "../utils/logger.ts";
import { UploadError } from "../utils/errors.ts";

export interface UploadOptions {
  imagePath?: string;
  imageData?: Buffer;
  targetSize?: [number, number];
  onProgress?: (progress: number, status?: string) => void;
}

/**
 * Main uploader class
 */
export class BeamBoxUploader {
  private ble: BleUploader;
  private imageProcessor: ImageProcessor;
  private payloadBuilder: PayloadBuilder;
  private imageConfig: ImageConfig;
  private verbose: boolean = false;

  constructor(
    deviceAddress?: string,
    chunkDelay?: number,
    bleConfig?: BLEConfig,
    protocolConfig?: ProtocolConfig,
    imageConfig?: ImageConfig,
    verbose: boolean = false,
  ) {
    this.verbose = verbose;
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
   * Upload an image, GIF, or video to the device
   *
   * Automatically detects file type and uses appropriate upload method:
   * - Static images: Type 6 (IMAGE) - single frame
   * - Animated GIFs: Type 5 (DYNAMIC_AMBIENCE), frames extracted
   * - Videos: Type 5 (DYNAMIC_AMBIENCE), frames extracted
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

    // Detect file type if path provided
    let isAnimated = false;
    if (imagePath) {
      const mediaInfo = await MediaDetector.detectFromFile(imagePath);
      isAnimated = mediaInfo.type === "gif" || mediaInfo.type === "video";

      logger.info(
        `Detected file type: ${mediaInfo.type} (${mediaInfo.mimeType})`,
      );

      if (isAnimated) {
        logger.info("File is animated, using Type 5 (DYNAMIC_AMBIENCE)");
        return await this.uploadAnimation(imagePath, effectiveSize, onProgress);
      } else {
        logger.info("File is static image, using Type 6 (IMAGE)");
      }
    }

    // Handle static image upload (Type 6)
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
    const imageInfoPayload = this.payloadBuilder.buildImageInfo(
      PacketType.IMAGE,
      1,
    );
    await this.ble.sendImageInfo(imageInfoPayload);
    logger.info("Sent image info packet, proceeding to data transfer");

    // Step 2: Build and send image data payload
    const fullData = this.payloadBuilder.buildImageData(
      jpegData,
      effectiveSize,
      PacketType.IMAGE,
    );
    const prefixLen = fullData.length - jpegData.length;
    logger.info(
      `Payload bytes: total=${fullData.length}, jpeg=${jpegData.length}, header+prefix=${prefixLen}`,
    );

    // Send data in chunks with protocol packets
    const ok = await this.ble.sendData(fullData, PacketType.IMAGE, onProgress);

    if (!ok) {
      logger.error("Upload reported error");
      return false;
    }

    // Wait for all acknowledgments
    if (!(await this.ble.waitForResponse(onProgress))) {
      logger.error("Upload timeout waiting for response");
      return false;
    }

    return true;
  }

  /**
   * Upload an animated GIF or video as Type 5 (DYNAMIC_AMBIENCE)
   *
   * @param filePath Path to the GIF or video file
   * @param targetSize Target size for frames
   * @param onProgress Progress callback
   * @returns True if upload successful
   */
  private async uploadAnimation(
    filePath: string,
    targetSize: [number, number],
    onProgress?: (progress: number) => void,
  ): Promise<boolean> {
    // Extract frames from the file
    logger.info("Extracting frames from animation...");
    const frames = await FrameExtractor.extractFrames(filePath, {
      maxFrames: 100,
      targetSize,
    });

    logger.info(`Extracted ${frames.length} frames`);

    // Calculate frame interval
    const intervalMs = await FrameExtractor.calculateFrameInterval(
      filePath,
      frames.length,
    );
    logger.info(`Using frame interval: ${intervalMs}ms`);

    // Wait for device to be ready
    logger.info("Waiting for device to be fully ready...");
    await this.sleep(1000);

    // Step 1: Send image info packet (Type 6 for the info)
    const imageInfoPayload = this.payloadBuilder.buildImageInfo(
      PacketType.IMAGE,
      1,
    );
    await this.ble.sendImageInfo(imageInfoPayload);
    logger.info("Sent animation info packet, proceeding to data transfer");

    // Step 2: Build and send animation data payload (Type 5)
    const fullData = this.payloadBuilder.buildAnimationData(
      frames,
      intervalMs,
      targetSize,
    );

    logger.info(
      `Animation payload bytes: total=${fullData.length}, frames=${frames.length}`,
    );

    // Send data in chunks with protocol packets using DYNAMIC_AMBIENCE packet type
    const ok = await this.ble.sendData(
      fullData,
      PacketType.DYNAMIC_AMBIENCE,
      onProgress,
    );

    if (!ok) {
      logger.error("Animation upload reported error");
      return false;
    }

    // Wait for all acknowledgments
    if (!(await this.ble.waitForResponse(onProgress))) {
      logger.error("Animation upload timeout waiting for response");
      return false;
    }

    logger.info("Animation upload completed successfully");
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
    onProgress?: (progress: number, status?: string) => void,
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
    onProgress?: (progress: number, status?: string) => void,
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
      let statusReceived = false;
      let lastNotificationCount = 0;

      while (Date.now() - startTime < timeoutMs) {
        const deviceStatus = this.ble.getDeviceStatus();
        const notifications = this.ble.getNotifications();

        // Log progress if we got new notifications
        if (notifications.length > lastNotificationCount) {
          logger.debug(`Received ${notifications.length} total notifications so far...`);
          lastNotificationCount = notifications.length;
        }

        if (deviceStatus && deviceStatus.type === 13) {
          logger.info(
            `Device status received: ${JSON.stringify(deviceStatus)}`,
          );
          logger.info("Device is ready for upload");
          statusReceived = true;
          break;
        }

        await this.sleep(checkInterval);
      }

      if (!statusReceived) {
        const notifications = this.ble.getNotifications();
        logger.warning(
          `Device status (type 13) not received within ${timeoutMs}ms timeout. Got ${notifications.length} notifications. Proceeding with available data.`,
        );

        // Log what we did receive if in verbose mode
        if (notifications.length > 0 && this.verbose) {
          logger.debug("Received notification types:");
          notifications.forEach((n, i) => {
            logger.debug(`  [${i}] type: ${n.parsed?.jsonData?.type || 'unknown'}, data: ${JSON.stringify(n.parsed?.jsonData || {})}`);
          });
        }
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
