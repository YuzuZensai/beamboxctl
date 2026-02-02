import { describe, test, expect } from "bun:test";
import { PayloadBuilder } from "./payload-builder.ts";
import { PacketType } from "../packet-types.ts";
import { DEFAULT_PROTOCOL_CONFIG } from "../interfaces/defaults.ts";
import type { ProtocolConfig } from "../interfaces/config.ts";
import {
  expectHex,
  createTestJpeg,
  calculateChecksum,
} from "../../../__tests__/utils/test-helpers.ts";

const createBuilder = () => new PayloadBuilder(DEFAULT_PROTOCOL_CONFIG);

describe("PayloadBuilder", () => {
  describe("buildImageInfo()", () => {
    test("default creates {\"type\":6,\"number\":1}", () => {
      const payload = createBuilder().buildImageInfo();
      const json = JSON.parse(payload.toString("utf-8"));
      expect(json).toEqual({ type: 6, number: 1 });
    });

    test("output has no extra spaces", () => {
      const payload = createBuilder().buildImageInfo();
      const text = payload.toString("utf-8");
      expect(text).toBe('{"type":6,"number":1}');
    });

    test("custom type creates {\"type\":5,\"number\":1}", () => {
      const payload = createBuilder().buildImageInfo(PacketType.DYNAMIC_AMBIENCE);
      const json = JSON.parse(payload.toString("utf-8"));
      expect(json).toEqual({ type: 5, number: 1 });
    });

    test("custom number creates {\"type\":6,\"number\":3}", () => {
      const payload = createBuilder().buildImageInfo(PacketType.IMAGE, 3);
      const json = JSON.parse(payload.toString("utf-8"));
      expect(json).toEqual({ type: 6, number: 3 });
    });

    test("returns UTF-8 Buffer", () => {
      const payload = createBuilder().buildImageInfo();
      expect(Buffer.isBuffer(payload)).toBe(true);
      const text = payload.toString("utf-8");
      expect(text).toMatch(/^\{.*\}$/);
    });

    test("JSON.parse(output) matches input params", () => {
      const imageType = 6;
      const number = 1;
      const payload = createBuilder().buildImageInfo(imageType, number);
      const parsed = JSON.parse(payload.toString("utf-8"));
      expect(parsed.type).toBe(imageType);
      expect(parsed.number).toBe(number);
    });
  });

  describe("buildImageData()", () => {
    test("format starts with {\"type\":6,\"data\"", () => {
      const jpeg = createTestJpeg(100);
      const payload = createBuilder().buildImageData(jpeg, [64, 32]);
      const text = payload.toString("utf-8", 0, 15);
      expect(text).toMatch(/^\{"type":6,"data/);
    });

    test("has correct prefix", () => {
      const jpeg = createTestJpeg(100);
      const payload = createBuilder().buildImageData(jpeg, [64, 32]);
      const prefix = payload.toString("utf-8", 0, 17);
      expect(prefix).toBe('{"type":6,"data":');
    });

    test("suffix is '}'", () => {
      const jpeg = createTestJpeg(100);
      const payload = createBuilder().buildImageData(jpeg, [64, 32]);
      const lastByte = payload.toString("utf-8", payload.length - 1);
      expect(lastByte).toBe("}");
    });

    test("IMB header (36 bytes) present after prefix", () => {
      const jpeg = createTestJpeg(100);
      const payload = createBuilder().buildImageData(jpeg, [64, 32]);
      const prefixLen = '{"type":6,"data":'.length;
      const imbSig = payload.toString("utf-8", prefixLen, prefixLen + 3);
      expect(imbSig).toBe("IMB");
    });

    test("JPEG data follows IMB header", () => {
      const jpeg = createTestJpeg(100);
      const payload = createBuilder().buildImageData(jpeg, [64, 32]);
      const prefixLen = '{"type":6,"data":'.length;
      const jpegStart = prefixLen + 36;
      const jpegInPayload = payload.subarray(jpegStart, jpegStart + jpeg.length);
      expect(jpegInPayload.equals(jpeg)).toBe(true);
    });

    test("total length = prefix + 36 + jpegSize + suffix", () => {
      const jpeg = createTestJpeg(100);
      const payload = createBuilder().buildImageData(jpeg, [64, 32]);
      const prefixLen = '{"type":6,"data":'.length;
      const suffixLen = 1;
      const expectedLen = prefixLen + 36 + jpeg.length + suffixLen;
      expect(payload.length).toBe(expectedLen);
    });

    test("custom type creates {\"type\":5,\"data\":...}", () => {
      const jpeg = createTestJpeg(100);
      const payload = createBuilder().buildImageData(
        jpeg,
        [64, 32],
        PacketType.DYNAMIC_AMBIENCE
      );
      const prefix = payload.toString("utf-8", 0, 17);
      expect(prefix).toBe('{"type":5,"data":');
    });

    test("works with 1-byte JPEG", () => {
      const jpeg = Buffer.from([0xff]);
      const payload = createBuilder().buildImageData(jpeg, [64, 32]);
      const prefixLen = '{"type":6,"data":'.length;
      const jpegStart = prefixLen + 36;
      expect(payload[jpegStart]).toBe(0xff);
    });

    test("works with large JPEG (1MB+)", () => {
      const jpeg = createTestJpeg(1024 * 1024);
      const payload = createBuilder().buildImageData(jpeg, [128, 64]);
      const prefixLen = '{"type":6,"data":'.length;
      const suffixLen = 1;
      const expectedLen = prefixLen + 36 + jpeg.length + suffixLen;
      expect(payload.length).toBe(expectedLen);
    });

    test("dimensions are embedded in IMB header", () => {
      const jpeg = createTestJpeg(100);
      const payload = createBuilder().buildImageData(jpeg, [128, 64]);
      const prefixLen = '{"type":6,"data":'.length;
      const imbStart = prefixLen;
      const width = payload.readUInt16LE(imbStart + 16);
      const height = payload.readUInt16LE(imbStart + 18);
      expect(width).toBe(128);
      expect(height).toBe(64);
    });
  });

  describe("buildInitPayload()", () => {
    test("throws error (not implemented)", () => {
      expect(() => createBuilder().buildInitPayload()).toThrow();
    });

    test("error message mentions Type 5/DYNAMIC_AMBIENCE", () => {
      expect(() => createBuilder().buildInitPayload()).toThrow(
        /DYNAMIC_AMBIENCE|Type 5/i
      );
    });

    test("error message mentions not implemented", () => {
      expect(() => createBuilder().buildInitPayload()).toThrow(/not.*implemented/i);
    });
  });

  describe("createPacket() - header structure", () => {
    test("byte 0 is cmdType (0xF1 by default)", () => {
      const payload = Buffer.from("test");
      const packet = createBuilder().createPacket(payload);
      expect(packet[0]).toBe(0xf1);
    });

    test("byte 1 is cmdSubtype (from config)", () => {
      const payload = Buffer.from("test");
      const packet = createBuilder().createPacket(payload);
      expect(packet[1]).toBe(DEFAULT_PROTOCOL_CONFIG.cmdSubtype);
    });

    test("byte 1 uses override packetType when provided", () => {
      const payload = Buffer.from("test");
      const packet = createBuilder().createPacket(payload, 0, 0, PacketType.IMAGE);
      expect(packet[1]).toBe(PacketType.IMAGE);
    });

    test("bytes 2-3 are totalPacketCount (big-endian)", () => {
      const payload = Buffer.from("test");
      const packet = createBuilder().createPacket(payload, 10, 0);
      expect(packet.readUInt16BE(2)).toBe(10);
    });

    test("bytes 4-5 are remainingPackets (big-endian)", () => {
      const payload = Buffer.from("test");
      const packet = createBuilder().createPacket(payload, 10, 5);
      expect(packet.readUInt16BE(4)).toBe(5);
    });

    test("bytes 6-7 are payload length (big-endian)", () => {
      const payload = Buffer.from("test");
      const packet = createBuilder().createPacket(payload);
      expect(packet.readUInt16BE(6)).toBe(4);
    });
  });

  describe("createPacket() - checksum", () => {
    test("last byte is checksum", () => {
      const payload = Buffer.from("test");
      const packet = createBuilder().createPacket(payload);
      const checksumByte = packet[packet.length - 1];
      expect(typeof checksumByte).toBe("number");
    });

    test("checksum = (-sum(header + payload)) & 0xFF", () => {
      const payload = Buffer.from("test");
      const packet = createBuilder().createPacket(payload);
      
      const headerAndPayload = packet.subarray(0, packet.length - 1);
      const expectedChecksum = calculateChecksum(headerAndPayload);
      const actualChecksum = packet[packet.length - 1];
      
      expect(actualChecksum).toBe(expectedChecksum);
    });

    test("different payloads produce different checksums", () => {
      const builder = createBuilder();
      const packet1 = builder.createPacket(Buffer.from("test1"));
      const packet2 = builder.createPacket(Buffer.from("test2"));
      const checksum1 = packet1[packet1.length - 1];
      const checksum2 = packet2[packet2.length - 1];
      expect(checksum1).not.toBe(checksum2);
    });

    test("same payload produces same checksum", () => {
      const payload = Buffer.from("test");
      const builder = createBuilder();
      const packet1 = builder.createPacket(payload);
      const packet2 = builder.createPacket(payload);
      const checksum1 = packet1[packet1.length - 1];
      const checksum2 = packet2[packet2.length - 1];
      expect(checksum1).toBe(checksum2);
    });
  });

  describe("createPacket() - parameters", () => {
    test("totalPacketCount=0, remainingPackets=0 (info packet)", () => {
      const payload = Buffer.from('{"type":6,"number":1}');
      const packet = createBuilder().createPacket(payload, 0, 0);
      expect(packet.readUInt16BE(2)).toBe(0);
      expect(packet.readUInt16BE(4)).toBe(0);
    });

    test("totalPacketCount=1, remainingPackets=0 (single data packet)", () => {
      const payload = Buffer.from("data");
      const packet = createBuilder().createPacket(payload, 1, 0);
      expect(packet.readUInt16BE(2)).toBe(1);
      expect(packet.readUInt16BE(4)).toBe(0);
    });

    test("totalPacketCount=10, remainingPackets=9 (first of 10)", () => {
      const payload = Buffer.from("chunk1");
      const packet = createBuilder().createPacket(payload, 10, 9);
      expect(packet.readUInt16BE(2)).toBe(10);
      expect(packet.readUInt16BE(4)).toBe(9);
    });

    test("totalPacketCount=10, remainingPackets=0 (last of 10)", () => {
      const payload = Buffer.from("chunk10");
      const packet = createBuilder().createPacket(payload, 10, 0);
      expect(packet.readUInt16BE(2)).toBe(10);
      expect(packet.readUInt16BE(4)).toBe(0);
    });

    test("override packetType changes byte 1", () => {
      const payload = Buffer.from("test");
      const packet = createBuilder().createPacket(
        payload,
        0,
        0,
        PacketType.DEVICE_STATUS
      );
      expect(packet[1]).toBe(PacketType.DEVICE_STATUS);
    });
  });

  describe("createPacket() - edge cases", () => {
    test("empty payload (length=0)", () => {
      const payload = Buffer.alloc(0);
      const packet = createBuilder().createPacket(payload);
      expect(packet.readUInt16BE(6)).toBe(0);
      expect(packet.length).toBe(9);
    });

    test("1-byte payload", () => {
      const payload = Buffer.from([0x42]);
      const packet = createBuilder().createPacket(payload);
      expect(packet.readUInt16BE(6)).toBe(1);
      expect(packet[8]).toBe(0x42);
    });

    test("large payload (512 bytes)", () => {
      const payload = Buffer.alloc(512, 0xaa);
      const packet = createBuilder().createPacket(payload);
      expect(packet.readUInt16BE(6)).toBe(512);
      expect(packet.length).toBe(8 + 512 + 1);
    });

    test("values overflow handling (65535+ packets)", () => {
      const payload = Buffer.from("test");
      const packet = createBuilder().createPacket(payload, 70000, 70000);
      const totalPackets = packet.readUInt16BE(2);
      const remaining = packet.readUInt16BE(4);
      expect(totalPackets).toBe(70000 & 0xffff);
      expect(remaining).toBe(70000 & 0xffff);
    });
  });

  describe("createPacket() - structure", () => {
    test("packet = header(8) + payload + checksum(1)", () => {
      const payload = Buffer.from("test data");
      const packet = createBuilder().createPacket(payload);
      expect(packet.length).toBe(8 + payload.length + 1);
    });

    test("payload is correctly embedded", () => {
      const payload = Buffer.from("test data");
      const packet = createBuilder().createPacket(payload);
      const embeddedPayload = packet.subarray(8, 8 + payload.length);
      expect(embeddedPayload.equals(payload)).toBe(true);
    });

    test("image info packet structure", () => {
      const infoPayload = Buffer.from('{"type":6,"number":1}');
      const packet = createBuilder().createPacket(infoPayload, 0, 0, PacketType.IMAGE);
      
      expect(packet[0]).toBe(0xf1);
      expect(packet[1]).toBe(PacketType.IMAGE);
      expect(packet.readUInt16BE(2)).toBe(0);
      expect(packet.readUInt16BE(4)).toBe(0);
      expect(packet.readUInt16BE(6)).toBe(infoPayload.length);
      
      const embeddedPayload = packet.subarray(8, 8 + infoPayload.length);
      expect(embeddedPayload.equals(infoPayload)).toBe(true);
    });
  });

  describe("integration - upload sequence", () => {
    test("build info + data packets for single image", () => {
      const builder = createBuilder();
      
      const infoPayload = builder.buildImageInfo();
      const infoPacket = builder.createPacket(infoPayload, 0, 0, PacketType.IMAGE);
      
      expect(infoPacket[0]).toBe(0xf1);
      expect(infoPacket[1]).toBe(PacketType.IMAGE);
      
      const jpeg = createTestJpeg(200);
      const dataPayload = builder.buildImageData(jpeg, [64, 32]);
      const dataPacket = builder.createPacket(dataPayload, 1, 0);
      
      expect(dataPacket[0]).toBe(0xf1);
      expect(dataPacket.readUInt16BE(2)).toBe(1);
      expect(dataPacket.readUInt16BE(4)).toBe(0);
    });

    test("build multi-packet data sequence", () => {
      const builder = createBuilder();
      const jpeg = createTestJpeg(1000);
      const fullData = builder.buildImageData(jpeg, [64, 32]);
      
      const chunkSize = 512;
      const totalChunks = Math.ceil(fullData.length / chunkSize);
      
      const packets = [];
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, fullData.length);
        const chunk = fullData.subarray(start, end);
        const remaining = totalChunks - 1 - i;
        
        const packet = builder.createPacket(chunk, totalChunks, remaining);
        packets.push(packet);
        
        expect(packet.readUInt16BE(2)).toBe(totalChunks);
        expect(packet.readUInt16BE(4)).toBe(remaining);
      }
      
      expect(packets.length).toBe(totalChunks);
      expect(packets[0]!.readUInt16BE(4)).toBe(totalChunks - 1);
      expect(packets[packets.length - 1]!.readUInt16BE(4)).toBe(0);
    });
  });
});
