import type { BLEConfig, ProtocolConfig, ImageConfig } from "./config.ts";
import { CMD_TYPE } from "../constants.ts";
import { PacketType } from "../packet-types.ts";

/**
 * Default BLE configuration for BeamBox devices
 *
 * Standard settings for connecting to the beambox e-Badge Pulse device.
 * TODO: Support other BeamBox models in the future.
 */
export const DEFAULT_BLE_CONFIG: BLEConfig = {
  deviceName: "beambox e-Badge Pulse",
  writeCharacteristicUUID: "000001f1-0000-1000-8000-00805f9b34fb",
  notifyCharacteristicUUID: "000001f2-0000-1000-8000-00805f9b34fb",
  scanTimeout: 10.0,
};

/**
 * Default protocol configuration for data transmission
 *
 * Optimized timing and size values for reliable communication with the device.
 *
 * Values based on packet capture analysis:
 * - chunkSize: 0x1F0 (496 bytes) - max payload size observed
 * - imageInfoChunkSize: 0x14 (20 bytes) - size of `{"type":6,"number":1}`
 * - packetDelay: 0.1s - prevents overwhelming device buffer
 * - imageInfoDelay: 0.01s - gives device time to prepare
 * - packetAckTimeout: 2.0s - reasonable wait for response
 */
export const DEFAULT_PROTOCOL_CONFIG: ProtocolConfig = {
  cmdType: CMD_TYPE,
  cmdSubtype: PacketType.IMAGE,
  chunkSize: 0x1f0,
  imageInfoChunkSize: 0x14,
  packetDelay: 0.1,
  imageInfoDelay: 0.01,
  packetAckTimeout: 2.0,
};

/**
 * Default image processing configuration
 *
 * Standard settings for processing images for the 368x368 BeamBox display.
 *
 * - defaultSize: [368, 368] - device native resolution
 * - jpegQuality: 70 - good balance between quality and size
 * - jpegOptimize: true - enable optimization for smaller files
 * - checkerboardSquares: 8 - for test pattern generation
 */
export const DEFAULT_IMAGE_CONFIG: ImageConfig = {
  defaultSize: [368, 368],
  jpegQuality: 70,
  jpegOptimize: true,
  checkerboardSquares: 8,
};
