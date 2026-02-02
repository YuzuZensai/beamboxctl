import type { DeviceStatus, ParsedResponse } from "../interfaces/index.ts";
import { PacketType } from "../packet-types.ts";
import { ResponseStatus } from "../response-types.ts";

/**
 * Parser for responses received from the BeamBox device
 *
 * Handles parsing of raw Buffer data into structured response objects,
 * extracting status codes, JSON data, and device status information
 */
export class ResponseParser {
  /**
   * Parses raw response data from the device
   *
   * Cleans the raw text, extracts status codes, parses JSON data,
   * and identifies device status packets
   *
   * @param data - Raw Buffer received from the device
   * @returns Parsed response containing status, JSON data, and device info if applicable
   */
  public static parse(data: Buffer): ParsedResponse {
    if (data.length === 0) {
      return {
        rawText: "",
        status: null,
        jsonData: null,
        isStatus: false,
      };
    }

    const rawText = data
      .toString("utf-8")
      .replace(/\x00/g, "")
      .replace(/\xd1/g, "")
      .trim();

    let status: ResponseStatus | null = null;
    if (rawText.includes(ResponseStatus.SUCCESS)) {
      status = ResponseStatus.SUCCESS;
    } else if (rawText.includes(ResponseStatus.FAIL)) {
      status = ResponseStatus.FAIL;
    } else if (rawText.includes(ResponseStatus.ERROR)) {
      status = ResponseStatus.ERROR;
    }

    const jsonData = ResponseParser.extractJson(rawText);

    const isStatus = ResponseParser.isDeviceStatusPacket(jsonData);

    const result: ParsedResponse = {
      rawText,
      status,
      jsonData,
      isStatus,
    };

    if (isStatus && jsonData) {
      result.deviceStatus = ResponseParser.parseDeviceStatus(jsonData);
    }

    return result;
  }

  /**
   * Determines if the parsed JSON data represents a device status packet
   *
   * @param jsonData - Parsed JSON object from the response
   * @returns True if this is a device status packet, false otherwise
   */
  private static isDeviceStatusPacket(
    jsonData: Record<string, unknown> | null,
  ): boolean {
    if (!jsonData) return false;

    const type = jsonData.type;
    return (
      type === PacketType.DEVICE_STATUS ||
      type === String(PacketType.DEVICE_STATUS)
    );
  }

  /**
   * Parses device status information from JSON data
   *
   * Extracts storage information, device name, display size, and brand ID
   *
   * @param jsonData - Parsed JSON object containing device status
   * @returns Device status with typed fields
   */
  private static parseDeviceStatus(
    jsonData: Record<string, unknown>,
  ): DeviceStatus {
    return {
      type: PacketType.DEVICE_STATUS,
      allspace: Number(jsonData.allspace) || 0,
      freespace: Number(jsonData.freespace) || 0,
      devname: String(jsonData.devname || ""),
      size: String(jsonData.size || ""),
      brand: Number(jsonData.brand) || 0,
    };
  }

  /**
   * Extracts JSON data from response text
   *
   * Attempts to parse the entire text as JSON. If that fails,
   * attempts to extract JSON from within the text by finding
   * the first '{' and last '}' characters.
   *
   * @param text - Response text to parse
   * @returns Parsed JSON object or null if no valid JSON found
   */
  private static extractJson(text: string): Record<string, unknown> | null {
    try {
      return JSON.parse(text);
    } catch {
      // Try extracting JSON from within text, it might come prefixed/suffixed
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");

      if (start !== -1 && end !== -1 && end > start) {
        const jsonPart = text.substring(start, end + 1);
        try {
          return JSON.parse(jsonPart);
        } catch {
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Checks if the response indicates successful operation
   *
   * @param response - Parsed response to check
   * @returns True if response status is SUCCESS
   */
  public static isSuccess(response: ParsedResponse): boolean {
    return response.status === ResponseStatus.SUCCESS;
  }

  /**
   * Checks if the response indicates a failed operation
   *
   * @param response - Parsed response to check
   * @returns True if response status is FAIL
   */
  public static isFail(response: ParsedResponse): boolean {
    return response.status === ResponseStatus.FAIL;
  }

  /**
   * Checks if the response indicates an error
   *
   * @param response - Parsed response to check
   * @returns True if response status is ERROR
   */
  public static isError(response: ParsedResponse): boolean {
    return response.status === ResponseStatus.ERROR;
  }
}
