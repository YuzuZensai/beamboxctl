import type { ResponseStatus } from "../response-types.ts";
import type { DeviceStatus } from "./device-status.ts";

/**
 * Parsed response from the device
 *
 * Contains the raw response text along with structured data extracted from it.
 * Responses can be status acknowledgments or actual device information.
 */
export interface ParsedResponse {
  /**
   * Raw string response received from the device
   *
   * May contain null bytes (0x00) and other control characters.
   */
  rawText: string;

  /**
   * Status code indicating success/failure of the operation
   */
  status: ResponseStatus | null;

  /**
   * Parsed JSON data if the response contains structured information
   */
  jsonData: Record<string, unknown> | null;

  /**
   * Whether this is a status packet (acknowledgment) rather than data
   *
   * TODO: Implement distinction between status and data packets, there is much better way to do this.
   * true: This is a DEVICE_STATUS response
   * false: This is a simple status acknowledgment
   */
  isStatus: boolean;

  /**
   * Device status information if this is a DEVICE_STATUS response
   *
   * TODO: Implement distinction between status and data packets, there is much better way to do this.
   * Only present when isStatus=true and jsonData contains type:13
   */
  deviceStatus?: DeviceStatus;
}
