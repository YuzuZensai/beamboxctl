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
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";

export interface UploadOptions {
  imagePath?: string;
  imageData?: Buffer;
  targetSize?: [number, number];
  animationSize?: [number, number];
  onProgress?: (sendProgress: number, confirmProgress: number, status?: string) => void;
  dumpDir?: string;
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

  public setDeviceAddress(address: string): void {
    this.ble.setDeviceAddress(address);
  }

  /**
   * Scan for all matching devices and return them so a UI can offer selection.
   */
  public async scanForDevices(
    onDeviceFound?: (device: { name: string | null; address: string }) => void,
    signal?: AbortSignal,
  ): Promise<Array<{ name: string | null; address: string }>> {
    return await this.ble.scanForDevices(onDeviceFound, signal);
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
    const {
      imagePath,
      imageData,
      targetSize,
      animationSize,
      onProgress,
      dumpDir,
    } = options;

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
          dumpDir,
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

    // Step 1: Build image info packet to announce upload
    const imageInfoPayload = this.payloadBuilder.buildImageInfo(
      PacketType.IMAGE,
      1,
    );

    if (dumpDir) {
      await this.dumpPayload(dumpDir, {
        kind: "image",
        packetType: PacketType.IMAGE,
        infoPayload: imageInfoPayload,
        fullData,
        targetSize: effectiveSize,
        extra: {
          jpegBytes: jpegData.length,
          headerAndPrefixBytes: prefixLen,
        },
      });
      return true;
    }

    // Wait a moment after connection to ensure device is fully ready
    logger.info("Waiting for device to be fully ready...");
    await this.sleep(1000);

    // Check device storage before upload
    if (!this.checkStorageCapacity(fullData.length)) {
      throw new UploadError(
        `Insufficient device storage. Image requires ${Math.ceil(fullData.length / 1024)}KiB. ` +
          `Try reducing image size or quality.`,
      );
    }

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

    const freespaceKiB = Number(deviceStatus.freespace) || 0;
    const freespaceBytes = freespaceKiB * 1024;
    const payloadKiB = (payloadSizeBytes / 1024).toFixed(2);

    logger.info(
      `Storage check: payload=${payloadKiB}KiB, available=${freespaceKiB}KiB`,
    );

    const requiredBytes = Math.ceil(payloadSizeBytes * 1.1);

    if (freespaceBytes < requiredBytes) {
      logger.error(
        `Insufficient storage: need ${(requiredBytes / 1024).toFixed(2)}KiB (with 10% margin), have ${freespaceKiB}KiB`,
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

  private async dumpPayload(
    dumpDir: string,
    info: {
      kind: "image" | "animation";
      packetType: PacketType;
      infoPayload: Buffer;
      fullData: Buffer;
      targetSize: [number, number];
      extra: Record<string, number>;
    },
  ): Promise<void> {
    const { kind, packetType, infoPayload, fullData, targetSize, extra } =
      info;

    await mkdir(dumpDir, { recursive: true });

    const infoPacket = this.payloadBuilder.createPacket(
      infoPayload,
      1,
      0,
      PacketType.IMAGE,
    );

    const chunkSize = this.protocolConfig.chunkSize;
    const totalChunks = Math.ceil(fullData.length / chunkSize);
    const dataPackets: Buffer[] = [];
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, fullData.length);
      const chunk = fullData.subarray(start, end);
      const remainingPackets = totalChunks - 1 - i;
      dataPackets.push(
        this.payloadBuilder.createPacket(
          chunk,
          totalChunks,
          remainingPackets,
          packetType,
        ),
      );
    }

    await writeFile(join(dumpDir, "info_packet.bin"), infoPacket);
    await writeFile(join(dumpDir, "payload.bin"), fullData);
    await writeFile(
      join(dumpDir, "data_packets.bin"),
      Buffer.concat(dataPackets),
    );

    const manifest = {
      kind,
      packetType,
      targetSize,
      payloadBytes: fullData.length,
      chunkSize,
      totalDataPackets: totalChunks,
      infoPacketHex: infoPacket.toString("hex"),
      payloadHexPreview: fullData.subarray(0, 64).toString("hex"),
      ...extra,
    };
    await writeFile(
      join(dumpDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );

    logger.info(`Dumped ${kind} upload to ${dumpDir}`);
    logger.info(
      `  payload.bin: ${fullData.length} bytes | data_packets.bin: ${totalChunks} packets | info_packet.bin: ${infoPacket.length} bytes`,
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
    onProgress?: (sendProgress: number, confirmProgress: number, status?: string) => void,
    dumpDir?: string,
  ): Promise<boolean> {
    const animationSize: [number, number] = targetSize;

    // Official app does this. so let's do it too
    // caps every animation source at 3 seconds, 20fps
    const MAX_ANIMATION_DURATION_SECS = 3;
    const ANIMATION_FPS = 20;

    logger.info(
      `Extracting frames from animation at ${animationSize[0]}x${animationSize[1]}...`,
    );
    const frames = await FrameExtractor.extractFrames(filePath, {
      targetSize: animationSize,
      fps: ANIMATION_FPS,
      maxDurationSecs: MAX_ANIMATION_DURATION_SECS,
    });

    logger.info(`Extracted ${frames.length} frames`);

    const MIN_FRAMES = 2;
    if (frames.length < MIN_FRAMES) {
      logger.info(
        `Padding from ${frames.length} to ${MIN_FRAMES} frames by duplicating last frame`,
      );
      while (frames.length < MIN_FRAMES) {
        const lastFrame = frames[frames.length - 1]!;
        frames.push({
          name: `frame_${String(frames.length + 1).padStart(5, "0")}`,
          data: lastFrame.data,
        });
      }
      logger.info(`Padded to ${frames.length} frames`);
    }

    const intervalMs = Math.round(1000 / ANIMATION_FPS);
    logger.info(`Using frame interval: ${intervalMs}ms`);

    const fullData = this.payloadBuilder.buildAnimationData(
      frames,
      intervalMs,
      animationSize,
    );

    logger.info(
      `Animation payload bytes: total=${fullData.length}, frames=${frames.length}`,
    );

    this.validatePayloadLimits(fullData.length);

    const imageInfoPayload = this.payloadBuilder.buildImageInfo(
      PacketType.IMAGE,
      1,
    );

    if (dumpDir) {
      await this.dumpPayload(dumpDir, {
        kind: "animation",
        packetType: PacketType.DYNAMIC_AMBIENCE,
        infoPayload: imageInfoPayload,
        fullData,
        targetSize: animationSize,
        extra: {
          frameCount: frames.length,
          intervalMs,
        },
      });
      return true;
    }

    logger.info("Waiting for device to be fully ready...");
    await this.sleep(1000);

    if (!this.checkStorageCapacity(fullData.length)) {
      throw new UploadError(
        `Insufficient device storage. Animation requires ${Math.ceil(fullData.length / 1024)}KiB. ` +
          `Try reducing frames or image quality.`,
      );
    }

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
    onProgress?: (sendProgress: number, confirmProgress: number, status?: string) => void,
    dumpDir?: string,
  ): Promise<boolean> {
    return await this.upload({
      imagePath,
      targetSize,
      animationSize,
      onProgress,
      dumpDir,
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
    onProgress?: (sendProgress: number, confirmProgress: number, status?: string) => void,
    dumpDir?: string,
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
      dumpDir,
    });
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

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
