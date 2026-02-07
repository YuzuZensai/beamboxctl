import { describe, it, expect } from "vitest";
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

      const container = XV4HeaderBuilder.build(frames, 50, 360, 360);

      // Check signature
      expect(container.subarray(0, 3).toString("ascii")).toBe("xV4");

      // Check version
      expect(container.readUInt8(3)).toBe(0x12);

      // Check header_size field (offset 4) = frame_table_end - 8 = (32 + 1*16) - 8 = 40
      expect(container.readUInt32LE(4)).toBe(40);

      // Check frame count (offset 8)
      expect(container.readUInt32LE(8)).toBe(1);

      // Check unknown field (offset 12) = frame_count * 10 + 10 = 20
      expect(container.readUInt32LE(12)).toBe(20);
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

      const container = XV4HeaderBuilder.build(frames, 50, 360, 360);

      // Check header_size field = (32 + 3*16) - 8 = 72
      expect(container.readUInt32LE(4)).toBe(72);

      // Check frame count (offset 8)
      expect(container.readUInt32LE(8)).toBe(3);

      // Check total data size (offset 28) = 3 * (32 + 6) = 114 (metadata + jpeg per frame)
      expect(container.readUInt32LE(28)).toBe(114);

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

      const container = XV4HeaderBuilder.build(frames, 50, 360, 360);

      // Timing string is at offset 16, 12 bytes
      const timingString = container
        .subarray(16, 28)
        .toString("utf8")
        .replace(/\0.*$/, "");
      expect(timingString).toBe("output/50ms");
    });

    it("should use interval value in timing string (clamped to 50-99)", () => {
      const frames: XV4Frame[] = [
        {
          name: "frame_00001",
          data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        },
      ];

      // Test with 99ms interval (within range)
      const container99 = XV4HeaderBuilder.build(frames, 99, 360, 360);
      const timingString99 = container99
        .subarray(16, 28)
        .toString("utf8")
        .replace(/\0.*$/, "");
      expect(timingString99).toBe("output/99ms");

      // Test with 100ms interval (clamped to 99)
      const container100 = XV4HeaderBuilder.build(frames, 100, 360, 360);
      const timingString100 = container100
        .subarray(16, 28)
        .toString("utf8")
        .replace(/\0.*$/, "");
      expect(timingString100).toBe("output/99ms");

      // Test with 30ms interval (clamped to 50)
      const container30 = XV4HeaderBuilder.build(frames, 30, 360, 360);
      const timingString30 = container30
        .subarray(16, 28)
        .toString("utf8")
        .replace(/\0.*$/, "");
      expect(timingString30).toBe("output/50ms");
    });

    it("should throw error with no frames", () => {
      expect(() => {
        XV4HeaderBuilder.build([], 50, 360, 360);
      }).toThrow("At least one frame is required");
    });

    it("should include frame names with dot suffix in frame table", () => {
      const frames: XV4Frame[] = [
        {
          name: "frame_00001",
          data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        },
      ];

      const container = XV4HeaderBuilder.build(frames, 50, 360, 360);

      // Frame table starts at offset 32
      // Each entry: 12-byte name + 4-byte offset
      const frameName = container.subarray(32, 44).toString("utf8");
      expect(frameName).toBe("frame_00001.");
    });

    it("should calculate cumulative offsets correctly", () => {
      const frames: XV4Frame[] = [
        {
          name: "frame_00001",
          data: Buffer.alloc(100), // 100 bytes
        },
        {
          name: "frame_00002",
          data: Buffer.alloc(200), // 200 bytes
        },
        {
          name: "frame_00003",
          data: Buffer.alloc(150), // 150 bytes
        },
      ];

      const container = XV4HeaderBuilder.build(frames, 50, 360, 360);

      // Frame table end = 32 + 3*16 = 80
      const frameTableEnd = 80;

      // Frame table offsets (each frame's metadata position):
      // Frame 0: frameTableEnd + 0 = 80
      // Frame 1: frameTableEnd + (32 + 100) = 80 + 132 = 212
      // Frame 2: frameTableEnd + (32 + 100) + (32 + 200) = 80 + 132 + 232 = 444

      expect(container.readUInt32LE(32 + 12)).toBe(frameTableEnd); // Frame 0 offset
      expect(container.readUInt32LE(48 + 12)).toBe(frameTableEnd + 32 + 100); // Frame 1 offset
      expect(container.readUInt32LE(64 + 12)).toBe(frameTableEnd + 32 + 100 + 32 + 200); // Frame 2 offset
    });

    it("should place JPEG data after metadata block for each frame", () => {
      const frames: XV4Frame[] = [
        {
          name: "frame_00001",
          data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        },
        {
          name: "frame_00002",
          data: Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
        },
      ];

      const container = XV4HeaderBuilder.build(frames, 50, 360, 360);

      // Frame table end = 32 + 2*16 = 64
      // Frame 0 metadata at 64, JPEG at 64+32 = 96
      const jpegOffset = 64 + 32;

      // First frame's JPEG SOI marker
      expect(container.readUInt16BE(jpegOffset)).toBe(0xffd8);
    });

    it("should include correct per-frame metadata structure", () => {
      const frames: XV4Frame[] = [
        {
          name: "frame_00001",
          data: Buffer.from([0xff, 0xd8, 0x00, 0x01, 0x02, 0x03]), // 6 bytes
        },
        {
          name: "frame_00002",
          data: Buffer.from([0xff, 0xd8, 0x10, 0x11]), // 4 bytes
        },
      ];

      const container = XV4HeaderBuilder.build(frames, 50, 360, 360);

      // Frame table end = 32 + 2*16 = 64
      const frameTableEnd = 64;
      
      // Frame 0 metadata at offset 64
      const meta0 = frameTableEnd;
      const jpeg0 = meta0 + 32; // JPEG starts after 32-byte metadata
      
      // Frame 1 metadata at offset 64 + 32 + 6 = 102
      const meta1 = meta0 + 32 + 6;
      const jpeg1 = meta1 + 32;

      // Frame 0 metadata structure:
      // [0-3] Current frame table offset
      expect(container.readUInt32LE(meta0)).toBe(meta0);

      // [4-7] Next frame table offset (points to frame 1 metadata)
      expect(container.readUInt32LE(meta0 + 4)).toBe(meta1);

      // [8-11] Unknown value = frame_count - 3 = -1 clamped to 0
      expect(container.readUInt32LE(meta0 + 8)).toBe(0);

      // [12-13] Width
      expect(container.readUInt16LE(meta0 + 12)).toBe(360);

      // [14-15] Height
      expect(container.readUInt16LE(meta0 + 14)).toBe(360);

      // [16-19] JPEG data start offset
      expect(container.readUInt32LE(meta0 + 16)).toBe(jpeg0);

      // [20-23] Frame 0 JPEG size
      expect(container.readUInt32LE(meta0 + 20)).toBe(6);

      // [24-31] Padding zeros
      expect(container.readUInt32LE(meta0 + 24)).toBe(0);
      expect(container.readUInt32LE(meta0 + 28)).toBe(0);

      // Frame 1 metadata structure:
      // [0-3] Current frame table offset
      expect(container.readUInt32LE(meta1)).toBe(meta1);

      // [4-7] Next frame table offset (loops back to first frame for continuous playback)
      expect(container.readUInt32LE(meta1 + 4)).toBe(meta0);

      // [16-19] JPEG data start offset
      expect(container.readUInt32LE(meta1 + 16)).toBe(jpeg1);

      // [20-23] Frame 1 JPEG size
      expect(container.readUInt32LE(meta1 + 20)).toBe(4);
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

      const container = XV4HeaderBuilder.build(frames, 50, 360, 360);
      expect(XV4HeaderBuilder.validate(container)).toBe(true);
    });

    it("should reject buffer that is too small", () => {
      const buffer = Buffer.alloc(10);
      expect(XV4HeaderBuilder.validate(buffer)).toBe(false);
    });

    it("should reject buffer with wrong signature", () => {
      const buffer = Buffer.alloc(40);
      buffer.write("ABC", 0);
      buffer.writeUInt8(0x12, 3);

      expect(XV4HeaderBuilder.validate(buffer)).toBe(false);
    });

    it("should reject buffer with wrong version", () => {
      const buffer = Buffer.alloc(40);
      buffer.write("xV4", 0);
      buffer.writeUInt8(0x99, 3); // Wrong version

      expect(XV4HeaderBuilder.validate(buffer)).toBe(false);
    });
  });

  describe("dump", () => {
    it("should dump xV4 container structure", () => {
      const frames: XV4Frame[] = [
        {
          name: "frame_00001",
          data: Buffer.alloc(100),
        },
        {
          name: "frame_00002",
          data: Buffer.alloc(200),
        },
      ];

      const container = XV4HeaderBuilder.build(frames, 50, 360, 360);
      const dump = XV4HeaderBuilder.dump(container);

      expect(dump).toContain("xV4 Container Dump");
      expect(dump).toContain("Frame count: 2");
      expect(dump).toContain("frame_00001.");
      expect(dump).toContain("frame_00002.");
      expect(dump).toContain("360x360");
    });
  });
});
