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
  animationSize?: [number, number];
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
  private protocolConfig: ProtocolConfig;
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
    this.protocolConfig = protocolConfig ?? DEFAULT_PROTOCOL_CONFIG;
    this.ble = new BleUploader(
      deviceAddress ?? null,
      chunkDelay ?? null,
      bleConfig ?? DEFAULT_BLE_CONFIG,
      this.protocolConfig,
      verbose,
    );
    this.imageProcessor = new ImageProcessor(this.imageConfig);
    this.payloadBuilder = new PayloadBuilder(this.protocolConfig);
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
    const { imagePath, imageData, targetSize, animationSize, onProgress } =
      options;

    if (!imageData && !imagePath) {
      throw new UploadError("No image provided");
    }

    const effectiveSize = targetSize ?? this.imageConfig.defaultSize;
    const effectiveAnimationSize =
      animationSize ?? this.imageConfig.animationsSize;

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
        return await this.uploadAnimation(
          imagePath,
          effectiveAnimationSize,
          onProgress,
        );
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

    // Build image data payload
    const fullData = this.payloadBuilder.buildImageData(
      jpegData,
      effectiveSize,
      PacketType.IMAGE,
    );
    const prefixLen = fullData.length - jpegData.length;
    logger.info(
      `Payload bytes: total=${fullData.length}, jpeg=${jpegData.length}, header+prefix=${prefixLen}`,
    );

    // Validate against protocol limits
    this.validatePayloadLimits(fullData.length);

    // Check device storage before upload
    if (!this.checkStorageCapacity(fullData.length)) {
      throw new UploadError(
        `Insufficient device storage. Image requires ${Math.ceil(fullData.length / 1024)}KB. ` +
          `Try reducing image size or quality.`,
      );
    }

    // Step 1: Send image info packet to announce upload
    const imageInfoPayload = this.payloadBuilder.buildImageInfo(
      PacketType.IMAGE,
      1,
    );
    await this.ble.sendImageInfo(imageInfoPayload);
    logger.info("Sent image info packet, proceeding to data transfer");

    // Step 2: Send image data payload
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
   * Check if device has enough free storage for the upload
   * @param payloadSizeBytes Size of the payload in bytes
   * @returns True if enough space available, false otherwise
   */
  private checkStorageCapacity(payloadSizeBytes: number): boolean {
    const deviceStatus = this.ble.getDeviceStatus();
    if (!deviceStatus) {
      logger.warning("Device status not available, cannot check storage");
      return false;
    }

    const freespaceKB = Number(deviceStatus.freespace) || 0;
    const freespaceBytes = freespaceKB * 1024;
    const payloadKB = Math.ceil(payloadSizeBytes / 1024);

    logger.info(
      `Storage check: payload=${payloadKB}KB, available=${freespaceKB}KB`,
    );

    // Add 10% safety margin to avoid filling device completely
    const requiredBytes = Math.ceil(payloadSizeBytes * 1.1);

    if (freespaceBytes < requiredBytes) {
      logger.error(
        `Insufficient storage: need ${Math.ceil(requiredBytes / 1024)}KB (with 10% margin), have ${freespaceKB}KB`,
      );
      return false;
    }

    return true;
  }

  /**
   * Validate payload against protocol limits
   * @param payloadSizeBytes Size of the payload in bytes
   * @throws UploadError if payload exceeds safety limits
   */
  private validatePayloadLimits(payloadSizeBytes: number): void {
    // Check 2MB payload size limit (from iOS app)
    if (payloadSizeBytes > this.protocolConfig.maxPayloadSize) {
      const sizeMB = (payloadSizeBytes / (1024 * 1024)).toFixed(2);
      const limitMB = (
        this.protocolConfig.maxPayloadSize /
        (1024 * 1024)
      ).toFixed(2);
      throw new UploadError(
        `Payload too large: ${sizeMB}MB exceeds ${limitMB}MB limit. ` +
          `Reduce image quality, frame count, or dimensions.`,
      );
    }

    // Check packet count limit (from iOS app: 20000 packets max)
    const packetCount = Math.ceil(
      payloadSizeBytes / this.protocolConfig.chunkSize,
    );
    if (packetCount > this.protocolConfig.maxPacketCount) {
      throw new UploadError(
        `Too many packets: ${packetCount} exceeds ${this.protocolConfig.maxPacketCount} limit. ` +
          `Reduce payload size or increase chunk size.`,
      );
    }

    logger.info(
      `Payload validation passed: ${(payloadSizeBytes / 1024).toFixed(2)}KB, ${packetCount} packets`,
    );
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
    const animationSize: [number, number] = targetSize;

    // Extract frames from the file
    logger.info(
      `Extracting frames from animation at ${animationSize[0]}x${animationSize[1]}...`,
    );
    const frames = await FrameExtractor.extractFrames(filePath, {
      targetSize: animationSize,
    });

    logger.info(`Extracted ${frames.length} frames`);

    // Ensure minimum 2 frames for device compatibility
    // The xV4 format requires at least 2 frames
    const MIN_FRAMES = 2;
    if (frames.length < MIN_FRAMES) {
      logger.info(
        `Padding from ${frames.length} to ${MIN_FRAMES} frames by duplicating last frame`,
      );
      while (frames.length < MIN_FRAMES) {
        const lastFrame = frames[frames.length - 1]!;
        frames.push({
          name: `frame_${String(frames.length + 1).padStart(5, "0")}`,
          data: lastFrame.data, // Reuse the same buffer
        });
      }
      logger.info(`Padded to ${frames.length} frames`);
    }

    // Calculate frame interval
    // Based on analysis: working animations use 50ms interval
    // TODO: Experiment with different intervals later
    // The timing string must fit in 12 bytes ("output/XXms\0"), so intervals
    // must be 2 digits (10-99). Using 50ms as it's proven to work.
    const intervalMs = 50;
    logger.info(`Using frame interval: ${intervalMs}ms`);

    // Wait for device to be ready
    logger.info("Waiting for device to be fully ready...");
    await this.sleep(1000);

    // Build animation payload to check size
    const fullData = this.payloadBuilder.buildAnimationData(
      frames,
      intervalMs,
      animationSize,
    );

    logger.info(
      `Animation payload bytes: total=${fullData.length}, frames=${frames.length}`,
    );

    // Validate against protocol limits
    this.validatePayloadLimits(fullData.length);

    // Check device storage before upload
    if (!this.checkStorageCapacity(fullData.length)) {
      throw new UploadError(
        `Insufficient device storage. Animation requires ${Math.ceil(fullData.length / 1024)}KB. ` +
          `Try reducing frames or image quality.`,
      );
    }

    // Step 1: Send image info packet (Type 6 for the info)
    const imageInfoPayload = this.payloadBuilder.buildImageInfo(
      PacketType.IMAGE,
      1,
    );
    await this.ble.sendImageInfo(imageInfoPayload);
    logger.info("Sent animation info packet, proceeding to data transfer");

    // Step 2: Send animation data payload (Type 5)
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
    animationSize?: [number, number],
    onProgress?: (progress: number, status?: string) => void,
  ): Promise<boolean> {
    return await this.upload({
      imagePath,
      targetSize,
      animationSize,
      onProgress,
    });
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
          logger.debug(
            `Received ${notifications.length} total notifications so far...`,
          );
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
            logger.debug(
              `  [${i}] type: ${n.parsed?.jsonData?.type || "unknown"}, data: ${JSON.stringify(n.parsed?.jsonData || {})}`,
            );
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
