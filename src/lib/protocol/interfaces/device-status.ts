import type { PacketType } from "../packet-types.ts";

/**
 * Device status information returned by the device
 */
export interface DeviceStatus {
  /** Packet type identifier (always 13 for DEVICE_STATUS) */
  type: PacketType.DEVICE_STATUS;

  /**
   * Total storage capacity in kilobytes (KB)
   */
  allspace: number;

  /**
   * Available free storage in kilobytes (KB)
   */
  freespace: number;

  /**
   * Device name/identifier
   *
   * Usually empty string from observations
   */
  devname: string;

  /**
   * Display resolution as "width,height" string
   *
   * Example: "368,368" = 368x368 pixels
   */
  size: string;

  /**
   * Brand/device model identifier
   *
   * Usually empty string from observations
   */
  brand: number;
}
