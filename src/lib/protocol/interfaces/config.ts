import type { PacketType } from "../packet-types.ts";

/**
 * Bluetooth Low Energy (BLE) connection configuration
 *
 * Contains settings for discovering and connecting to the BeamBox device via BLE.
 */
export interface BLEConfig {
  /**
   * Expected name of the device during scanning
   */
  deviceName: string;

  /**
   * UUID of the BLE characteristic used for writing commands/data to the device
   */
  writeCharacteristicUUID: string;

  /**
   * UUID of the BLE characteristic used for receiving notifications/responses from the device
   */
  notifyCharacteristicUUID: string;

  /**
   * Maximum time (in seconds) to wait for device discovery before timing out
   */
  scanTimeout: number;
}

/**
 * Protocol configuration for packet transmission
 *
 * Contains timing and size parameters for data transfer to the device.
 * These values control the flow of data to prevent overwhelming the device.
 */
export interface ProtocolConfig {
  /**
   * Command type byte (CMD_TYPE) sent in packet headers
   *
   * Always 0xF1 as observed in packet captures
   */
  cmdType: number;

  /**
   * Command subtype indicating the type of data being sent
   */
  cmdSubtype: PacketType;

  /**
   * Maximum size in bytes of each data chunk sent to the device
   */
  chunkSize: number;

  /**
   * Maximum size in bytes for image info JSON packets
   */
  imageInfoChunkSize: number;

  /**
   * Delay (in seconds) between sending consecutive data chunks
   */
  packetDelay: number;

  /**
   * Delay (in seconds) after sending the image info packet
   */
  imageInfoDelay: number;

  /**
   * Maximum time (in seconds) to wait for a packet acknowledgment from the device
   */
  packetAckTimeout: number;

  /**
   * Maximum number of packets allowed per upload
   * Value: 20000 packets max
   */
  maxPacketCount: number;

  /**
   * Maximum payload size in bytes allowed per upload
   * Value: 2MB (2 * 1024 * 1024 bytes)
   */
  maxPayloadSize: number;
}

/**
 * Image processing and configuration settings
 *
 * Contains parameters for processing images before sending to the device,
 * including resizing, compression, and validation settings.
 */
export interface ImageConfig {
  /**
   * Default display dimensions [width, height] for images
   *
   * Images are resized to fit these dimensions
   */
  defaultSize: [number, number];

  /**
   * Default frame dimensions [width, height] for animations
   *
   * Frames are resized to fit these dimensions
   */
  animationsSize: [number, number];

  /**
   * JPEG compression quality (0-100)
   *
   * - 0: Lowest quality, smallest file
   * - 100: Highest quality, largest file
   * - 70: Good balance (recommended)
   */
  jpegQuality: number;

  /**
   * Whether to enable JPEG optimization for smaller file sizes
   *
   * true: Apply optimization algorithms (slower but smaller)
   * false: Skip optimization (faster but larger)
   */
  jpegOptimize: boolean;

  /**
   * Number of squares per dimension for checkerboard transparency pattern
   *
   * Example: 8 = 8x8 checkerboard grid
   * Used for test pattern generation
   */
  checkerboardSquares: number;
}
