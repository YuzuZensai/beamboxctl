import type { ProtocolConfig } from "../interfaces/config.ts";
import { PacketType } from "../packet-types.ts";
import { IMBHeaderBuilder } from "./imb-header.ts";

/**
 * Builder for creating protocol payloads and packets for image uploads
 *
 * Handles construction of image info, data payloads, and complete protocol packets
 * with proper headers, checksums, and formatting.
 */
export class PayloadBuilder {
  /**
   * Creates a new PayloadBuilder instance.
   * @param config Protocol configuration containing command type and subtype values
   */
  constructor(private config: ProtocolConfig) {}

  /**
   * Build image info payload for image upload
   *
   * This announces to the device that one image is coming.
   * For batch uploads, call this once per image (always with number=1).
   *
   * NOTE: Dynamic ambience (Type 5) also uses this same info format
   * with imageType=PacketType.IMAGE, followed by Type 5 data packet.
   *
   * @param imageType Image type identifier (PacketType.IMAGE for still image or animation info)
   * @param number Number of images in this announcement (always 1)
   * @returns Image info payload bytes in format: {"type":6,"number":1}
   */
  public buildImageInfo(
    imageType: number = PacketType.IMAGE,
    number: number = 1,
  ): Buffer {
    const imageInfo = { type: imageType, number };
    // Real app format: {"type":IMAGE,"number":1} without extra spaces
    const jsonStr = JSON.stringify(imageInfo);
    return Buffer.from(jsonStr, "utf-8");
  }

  /**
   * Build initialization payload for dynamic ambience mode (animations, gallery)
   *
   * Type 5 (DYNAMIC_AMBIENCE) is used for:
   * - Video uploads (frames extracted via FFmpeg)
   * - GIF uploads (frames separated)
   * - Gallery/slideshow mode (multiple images converted to animation)
   *
   * Process:
   * 1. Extract/convert frames using FFmpeg
   * 2. Send info packet: {"type":6,"number":1} (uses buildImageInfo)
   * 3. Send data packet: {"type":5,"data":<xV4_ANIMATION>}
   *
   * Animation data format (needs implementation):
   * - Signature: "xV4" (0x78 0x56 0x34)
   * - Frame timing: "output/50ms" or similar
   * - Frame references: "frame_00001", "frame_00002", etc.
   * - Multiple JPEG frames embedded
   *
   * @throws {Error} Dynamic ambience feature is not yet implemented
   * @deprecated This feature is not implemented yet
   */
  public buildInitPayload(): Buffer {
    throw new Error(
      "Dynamic ambience (PacketType.DYNAMIC_AMBIENCE) is not yet implemented. " +
        "This feature is required for video/GIF upload and gallery/slideshow mode. " +
        "Only static single image upload (PacketType.IMAGE) is currently supported.",
    );
  }

  /**
   * Build image data payload with binary header
   * @param jpegData JPEG image bytes
   * @param targetSize Image dimensions [width, height]
   * @param imageType Image type identifier (PacketType.IMAGE)
   * @returns Complete data payload with prefix, header, and JPEG data
   */
  public buildImageData(
    jpegData: Buffer,
    targetSize: [number, number],
    imageType: number = PacketType.IMAGE,
  ): Buffer {
    const dataPrefix = Buffer.from(`{"type":${imageType},"data":`, "utf-8");
    const dataSuffix = Buffer.from("}", "utf-8");

    // Build IMB header
    const header = IMBHeaderBuilder.build(
      jpegData.length,
      targetSize[0],
      targetSize[1],
    );

    return Buffer.concat([dataPrefix, header, jpegData, dataSuffix]);
  }

  /**
   * Create a protocol packet with header, payload, and checksum
   *
   * - Bytes 0-1: Command type and subtype
   * - Bytes 2-3: Total packet count (CONSTANT across all packets)
   * - Bytes 4-5: Remaining packets (COUNTDOWN from total-1 to 0)
   * - Bytes 6-7: Payload length
   * - Payload data
   * - Checksum byte: (-sum(header + payload)) & 0xFF
   *
   * @param payload Packet payload data
   * @param totalPacketCount Total number of packets in this transmission (constant across all packets)
   * @param remainingPackets Number of packets remaining after this one (countdown: total-1 to 0)
   * @param packetType Override packet subtype
   * @returns Complete packet with header + payload + checksum
   */
  public createPacket(
    payload: Buffer,
    totalPacketCount: number = 0,
    remainingPackets: number = 0,
    packetType?: PacketType,
  ): Buffer {
    const payloadLength = payload.length;
    const type = packetType !== undefined ? packetType : this.config.cmdSubtype;

    const headerLength = 8;
    const packet = Buffer.alloc(headerLength + payloadLength + 1);

    // Build 8-byte header
    packet.writeUInt8(this.config.cmdType & 0xff, 0); // CMD_TYPE (0xF1)
    packet.writeUInt8(type & 0xff, 1); // CMD_SUBTYPE
    packet.writeUInt16BE(totalPacketCount & 0xffff, 2); // TOTAL_PACKETS (constant)
    packet.writeUInt16BE(remainingPackets & 0xffff, 4); // REMAINING_PACKETS (countdown)
    packet.writeUInt16BE(payloadLength & 0xffff, 6); // PAYLOAD_LENGTH

    payload.copy(packet, headerLength);

    // Calculate checksum: (-sum(header + payload)) & 0xFF
    let sum = 0;
    for (let i = 0; i < headerLength + payloadLength; i++) {
      sum += packet[i]!;
    }
    const checksum = -sum & 0xff;
    packet.writeUInt8(checksum, headerLength + payloadLength);

    return packet;
  }
}
