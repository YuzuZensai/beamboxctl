import { describe, test, expect } from "vitest";
import { IMBHeaderBuilder } from "./imb-header.ts";
import { expectHex } from "../../../__tests__/utils/test-helpers.ts";

describe("IMBHeaderBuilder", () => {
  describe("build()", () => {
    describe("structure validation", () => {
      test("creates exactly 36-byte buffer", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header.length).toBe(36);
      });

      test("signature is 'IMB' at bytes 0-2", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header.toString("utf-8", 0, 3)).toBe("IMB");
        expect(header[0]).toBe(0x49); // I
        expect(header[1]).toBe(0x4d); // M
        expect(header[2]).toBe(0x42); // B
      });

      test("null byte at position 3", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header[3]).toBe(0x00);
      });

      test("header size (36) at bytes 4-7 (little-endian)", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header.readUInt32LE(4)).toBe(36);
      });

      test("total size (jpegSize + 36) at bytes 8-11 (little-endian)", () => {
        const jpegSize = 1024;
        const header = IMBHeaderBuilder.build(jpegSize, 64, 32);
        expect(header.readUInt32LE(8)).toBe(jpegSize + 36);
      });

      test("format value (11) at byte 12", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header[12]).toBe(11);
      });

      test("zero byte at byte 13", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header[13]).toBe(0x00);
      });

      test("reserved zeros (2 bytes) at bytes 14-15", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header.readUInt16LE(14)).toBe(0);
      });

      test("width at bytes 16-17 (little-endian)", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header.readUInt16LE(16)).toBe(64);
      });

      test("height at bytes 18-19 (little-endian)", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header.readUInt16LE(18)).toBe(32);
      });

      test("header size repeat (36) at bytes 20-23 (little-endian)", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header.readUInt32LE(20)).toBe(36);
      });

      test("JPEG size at bytes 24-27 (little-endian)", () => {
        const jpegSize = 1024;
        const header = IMBHeaderBuilder.build(jpegSize, 64, 32);
        expect(header.readUInt32LE(24)).toBe(jpegSize);
      });

      test("reserved zeros (8 bytes) at bytes 28-35", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header.readUInt32LE(28)).toBe(0);
        expect(header.readUInt32LE(32)).toBe(0);
      });
    });

    describe("edge cases", () => {
      test("zero JPEG size produces valid header", () => {
        const header = IMBHeaderBuilder.build(0, 64, 32);
        expect(header.length).toBe(36);
        expect(header.readUInt32LE(24)).toBe(0); // JPEG size
        expect(header.readUInt32LE(8)).toBe(36); // Total size = 0 + 36
      });

      test("large JPEG size (5MB)", () => {
        const jpegSize = 5 * 1024 * 1024; // 5MB
        const header = IMBHeaderBuilder.build(jpegSize, 64, 32);
        expect(header.readUInt32LE(24)).toBe(jpegSize);
        expect(header.readUInt32LE(8)).toBe(jpegSize + 36);
      });

      test("maximum dimensions (uint16 max: 65535x65535)", () => {
        const header = IMBHeaderBuilder.build(1024, 65535, 65535);
        expect(header.readUInt16LE(16)).toBe(65535);
        expect(header.readUInt16LE(18)).toBe(65535);
      });

      test("minimum dimensions (1x1)", () => {
        const header = IMBHeaderBuilder.build(1024, 1, 1);
        expect(header.readUInt16LE(16)).toBe(1);
        expect(header.readUInt16LE(18)).toBe(1);
      });

      test("common device size (64x32)", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header.readUInt16LE(16)).toBe(64);
        expect(header.readUInt16LE(18)).toBe(32);
      });

      test("common device size (128x64)", () => {
        const header = IMBHeaderBuilder.build(1024, 128, 64);
        expect(header.readUInt16LE(16)).toBe(128);
        expect(header.readUInt16LE(18)).toBe(64);
      });
    });

    describe("known header verification", () => {
      test("1KB JPEG, 64x32 matches expected hex", () => {
        const header = IMBHeaderBuilder.build(1024, 64, 32);
        // IMB\x00 + 36(LE) + 1060(LE) + 11 + 0x00 + 0x0000 + 64(LE) + 32(LE) + 36(LE) + 1024(LE) + 0x00000000 + 0x00000000
        expectHex(
          header,
          "494d420024000000240400000b0000004000200024000000000400000000000000000000"
        );
      });

      test("100 byte JPEG, 128x64 matches expected hex", () => {
        const header = IMBHeaderBuilder.build(100, 128, 64);
        // IMB\x00 + 36(LE) + 136(LE) + 11 + 0x00 + 0x0000 + 128(LE) + 64(LE) + 36(LE) + 100(LE) + 0x00000000 + 0x00000000
        expectHex(
          header,
          "494d420024000000880000000b0000008000400024000000640000000000000000000000"
        );
      });
    });

    describe("consistency", () => {
      test("multiple calls with same params produce identical headers", () => {
        const header1 = IMBHeaderBuilder.build(1024, 64, 32);
        const header2 = IMBHeaderBuilder.build(1024, 64, 32);
        expect(header1.equals(header2)).toBe(true);
      });

      test("different params produce different headers", () => {
        const header1 = IMBHeaderBuilder.build(1024, 64, 32);
        const header2 = IMBHeaderBuilder.build(1024, 128, 64);
        expect(header1.equals(header2)).toBe(false);
      });
    });
  });

  describe("validate()", () => {
    test("validates correct header from build()", () => {
      const header = IMBHeaderBuilder.build(1024, 64, 32);
      expect(IMBHeaderBuilder.validate(header)).toBe(true);
    });

    test("rejects wrong length (35 bytes)", () => {
      const header = Buffer.alloc(35);
      expect(IMBHeaderBuilder.validate(header)).toBe(false);
    });

    test("rejects wrong length (37 bytes)", () => {
      const header = Buffer.alloc(37);
      expect(IMBHeaderBuilder.validate(header)).toBe(false);
    });

    test("rejects wrong signature 'IMC'", () => {
      const header = IMBHeaderBuilder.build(1024, 64, 32);
      header[2] = 0x43; // Change B to C
      expect(IMBHeaderBuilder.validate(header)).toBe(false);
    });

    test("rejects wrong signature 'ABC'", () => {
      const header = Buffer.alloc(36);
      header.write("ABC", 0);
      expect(IMBHeaderBuilder.validate(header)).toBe(false);
    });

    test("rejects empty signature", () => {
      const header = Buffer.alloc(36);
      // All zeros
      expect(IMBHeaderBuilder.validate(header)).toBe(false);
    });

    test("rejects missing null byte at position 3", () => {
      const header = IMBHeaderBuilder.build(1024, 64, 32);
      header[3] = 0x01; // Change null to non-null
      expect(IMBHeaderBuilder.validate(header)).toBe(false);
    });

    test("rejects mismatched header sizes (bytes 4-7 vs 20-23)", () => {
      const header = IMBHeaderBuilder.build(1024, 64, 32);
      header.writeUInt32LE(40, 20); // Change second header size to 40
      expect(IMBHeaderBuilder.validate(header)).toBe(false);
    });

    test("rejects incorrect header size value", () => {
      const header = IMBHeaderBuilder.build(1024, 64, 32);
      header.writeUInt32LE(32, 4); // Change first header size to 32
      expect(IMBHeaderBuilder.validate(header)).toBe(false);
    });

    test("validates headers with various JPEG sizes", () => {
      const sizes = [0, 100, 1024, 10000, 1000000];
      sizes.forEach((size) => {
        const header = IMBHeaderBuilder.build(size, 64, 32);
        expect(IMBHeaderBuilder.validate(header)).toBe(true);
      });
    });

    test("validates headers with various dimensions", () => {
      const dimensions: [number, number][] = [
        [1, 1],
        [64, 32],
        [128, 64],
        [256, 256],
        [1920, 1080],
      ];
      dimensions.forEach(([width, height]) => {
        const header = IMBHeaderBuilder.build(1024, width, height);
        expect(IMBHeaderBuilder.validate(header)).toBe(true);
      });
    });
  });

  describe("build() and validate() integration", () => {
    test("all built headers pass validation", () => {
      const testCases: [number, number, number][] = [
        [0, 1, 1],
        [100, 64, 32],
        [1024, 128, 64],
        [5242880, 256, 256],
        [10000, 1920, 1080],
      ];

      testCases.forEach(([jpegSize, width, height]) => {
        const header = IMBHeaderBuilder.build(jpegSize, width, height);
        expect(IMBHeaderBuilder.validate(header)).toBe(true);
      });
    });
  });
});
