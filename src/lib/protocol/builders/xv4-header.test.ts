import { describe, it, expect } from "bun:test";
import { XV4HeaderBuilder, type XV4Frame } from "./xv4-header.ts";

describe("XV4HeaderBuilder", () => {
  describe("build", () => {
    it("should create a valid xV4 container with single frame", () => {
      const frames: XV4Frame[] = [
        {
          name: "frame_00001",
          data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), // Fake JPEG header
        },
      ];

      const container = XV4HeaderBuilder.build(frames, 50, 368, 368);

      // Check signature
      expect(container.subarray(0, 3).toString("ascii")).toBe("xV4");

      // Check version
      expect(container.readUInt8(3)).toBe(0x12);

      // Check unknown byte
      expect(container.readUInt8(4)).toBe(0x48);

      // Check frame count (offset 8, u32 LE)
      expect(container.readUInt32LE(8)).toBe(1);
    });

    it("should create a valid xV4 container with multiple frames", () => {
      const frames: XV4Frame[] = [
        {
          name: "frame_00001",
          data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
        },
        {
          name: "frame_00002",
          data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x11]),
        },
        {
          name: "frame_00003",
          data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x12]),
        },
      ];

      const container = XV4HeaderBuilder.build(frames, 50, 368, 368);

      // Check frame count (offset 8, u32 LE)
      expect(container.readUInt32LE(8)).toBe(3);

      // Validate it's a proper xV4 container
      expect(XV4HeaderBuilder.validate(container)).toBe(true);
    });

    it("should include correct timing string", () => {
      const frames: XV4Frame[] = [
        {
          name: "frame_00001",
          data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        },
      ];

      const container = XV4HeaderBuilder.build(frames, 100, 368, 368);

      // Timing string is after: xV4 (3) + ver (1) + unk (1) + pad (3) + count (4) + size (4) = offset 16
      const timingString = container
        .subarray(16, 35)
        .toString("utf8")
        .replace(/\0.*$/, "");
      expect(timingString).toBe("output/100ms");
    });

    it("should throw error with no frames", () => {
      expect(() => {
        XV4HeaderBuilder.build([], 50, 368, 368);
      }).toThrow("At least one frame is required");
    });
  });

  describe("validate", () => {
    it("should validate a proper xV4 container", () => {
      const frames: XV4Frame[] = [
        {
          name: "frame_00001",
          data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        },
      ];

      const container = XV4HeaderBuilder.build(frames, 50, 368, 368);
      expect(XV4HeaderBuilder.validate(container)).toBe(true);
    });

    it("should reject buffer that is too small", () => {
      const buffer = Buffer.alloc(10);
      expect(XV4HeaderBuilder.validate(buffer)).toBe(false);
    });

    it("should reject buffer with wrong signature", () => {
      const buffer = Buffer.alloc(20);
      buffer.write("ABC", 0);
      buffer.writeUInt8(0x12, 3);
      buffer.writeUInt8(0x48, 4);

      expect(XV4HeaderBuilder.validate(buffer)).toBe(false);
    });

    it("should reject buffer with wrong version", () => {
      const buffer = Buffer.alloc(20);
      buffer.write("xV4", 0);
      buffer.writeUInt8(0x99, 3); // Wrong version
      buffer.writeUInt8(0x48, 4);

      expect(XV4HeaderBuilder.validate(buffer)).toBe(false);
    });

    it("should reject buffer with wrong unknown byte", () => {
      const buffer = Buffer.alloc(20);
      buffer.write("xV4", 0);
      buffer.writeUInt8(0x12, 3);
      buffer.writeUInt8(0x99, 4); // Wrong unknown byte

      expect(XV4HeaderBuilder.validate(buffer)).toBe(false);
    });
  });
});
