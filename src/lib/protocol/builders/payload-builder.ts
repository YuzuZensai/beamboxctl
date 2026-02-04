import type { ProtocolConfig } from "../interfaces/config.ts";
import { PacketType } from "../packet-types.ts";
import { IMBHeaderBuilder } from "./imb-header.ts";
import { XV4HeaderBuilder, type XV4Frame } from "./xv4-header.ts";

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
   * Build animation data payload for dynamic ambience mode
   *
   * @param frames Array of frames with names and JPEG data
   * @param intervalMs Frame interval in milliseconds (default: 50ms = 20fps)
   * @param targetSize Image dimensions [width, height] (default: [368, 368])
   * @returns Animation data payload bytes in format: {"type":5,"data":<xV4_BINARY>}
   */
  public buildAnimationData(
    frames: XV4Frame[],
    intervalMs: number = 50,
    targetSize: [number, number] = [368, 368],
  ): Buffer {
    const dataPrefix = Buffer.from(
      `{"type":${PacketType.DYNAMIC_AMBIENCE},"data":`,
      "utf-8",
    );
    const dataSuffix = Buffer.from("}", "utf-8");

    // Build xV4 animation container
    const xv4Container = XV4HeaderBuilder.build(
      frames,
      intervalMs,
      targetSize[0],
      targetSize[1],
    );

    return Buffer.concat([dataPrefix, xv4Container, dataSuffix]);
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
