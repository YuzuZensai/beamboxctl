/**
 * Status codes returned by the device in response to packet transfers
 *
 * These string values indicate whether the device successfully received and processed
 * a packet, or if an error occurred during transmission or processing.
 */
export enum ResponseStatus {
  /**
   * Packet was successfully received and processed by the device
   * 
   * Device sends this after successfully receiving each data chunk.
   * Client should proceed to send the next chunk.
   */
  SUCCESS = "GetPacketSuccess",

  /**
   * Packet transmission or processing failed
   * 
   * Device sends this when a chunk was corrupted or couldn't be processed.
   * Client should retry sending the failed chunk.
   */
  FAIL = "PacketFail",

  /**
   * Error occurred (represented by ten '1' characters)
   * 
   * Likely occurs when an error happens during packet handling,
   * like malformed data or unexpected conditions.
   * 
   * Client should abort the upload and reconnect.
   */
  ERROR = "1111111111",
}
