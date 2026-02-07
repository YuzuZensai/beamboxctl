import { describe, it, expect } from "vitest";
import { MediaDetector } from "./media-detector.ts";

describe("MediaDetector", () => {
  describe("detectFromBuffer", () => {
    it("should detect JPEG from magic bytes", () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const info = MediaDetector.detectFromBuffer(buffer);

      expect(info.type).toBe("image");
      expect(info.mimeType).toBe("image/jpeg");
      expect(info.extension).toBe("jpg");
    });

    it("should detect PNG from magic bytes", () => {
      const buffer = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const info = MediaDetector.detectFromBuffer(buffer);

      expect(info.type).toBe("image");
      expect(info.mimeType).toBe("image/png");
      expect(info.extension).toBe("png");
    });

    it("should detect GIF from magic bytes", () => {
      const buffer = Buffer.from([
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
      ]);
      const info = MediaDetector.detectFromBuffer(buffer);

      expect(info.type).toBe("gif");
      expect(info.mimeType).toBe("image/gif");
      expect(info.extension).toBe("gif");
    });

    it("should detect MP4 from ftyp box", () => {
      const buffer = Buffer.from([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, // ftyp
        0x69, 0x73, 0x6f, 0x6d, // isom
      ]);
      const info = MediaDetector.detectFromBuffer(buffer);

      expect(info.type).toBe("video");
      expect(info.mimeType).toBe("video/mp4");
      expect(info.extension).toBe("mp4");
    });

    it("should detect WebM from magic bytes", () => {
      const buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
      const info = MediaDetector.detectFromBuffer(buffer);

      expect(info.type).toBe("video");
      expect(info.mimeType).toBe("video/webm");
      expect(info.extension).toBe("webm");
    });

    it("should detect AVI from RIFF header", () => {
      const buffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00,
        0x41, 0x56, 0x49, 0x20, // AVI
      ]);
      const info = MediaDetector.detectFromBuffer(buffer);

      expect(info.type).toBe("video");
      expect(info.mimeType).toBe("video/x-msvideo");
      expect(info.extension).toBe("avi");
    });

    it("should detect WebP from magic bytes", () => {
      const buffer = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x00, 0x00, 0x00, 0x00,
        0x57, 0x45, 0x42, 0x50, // WEBP
      ]);
      const info = MediaDetector.detectFromBuffer(buffer);

      expect(info.type).toBe("image");
      expect(info.mimeType).toBe("image/webp");
      expect(info.extension).toBe("webp");
    });

    it("should detect BMP from magic bytes", () => {
      const buffer = Buffer.from([0x42, 0x4d]);
      const info = MediaDetector.detectFromBuffer(buffer);

      expect(info.type).toBe("image");
      expect(info.mimeType).toBe("image/bmp");
      expect(info.extension).toBe("bmp");
    });

    it("should use extension hint for MOV files", () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      const info = MediaDetector.detectFromBuffer(buffer, "mov");

      expect(info.type).toBe("video");
      expect(info.mimeType).toBe("video/quicktime");
      expect(info.extension).toBe("mov");
    });

    it("should default to image for unknown types", () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      const info = MediaDetector.detectFromBuffer(buffer);

      expect(info.type).toBe("image");
      expect(info.mimeType).toBe("application/octet-stream");
    });
  });

  describe("isAnimatedBuffer", () => {
    it("should return true for GIF", () => {
      const buffer = Buffer.from([0x47, 0x49, 0x46, 0x38]);
      expect(MediaDetector.isAnimatedBuffer(buffer)).toBe(true);
    });

    it("should return true for MP4", () => {
      const buffer = Buffer.from([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70,
      ]);
      expect(MediaDetector.isAnimatedBuffer(buffer)).toBe(true);
    });

    it("should return true for WebM", () => {
      const buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
      expect(MediaDetector.isAnimatedBuffer(buffer)).toBe(true);
    });

    it("should return false for JPEG", () => {
      const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(MediaDetector.isAnimatedBuffer(buffer)).toBe(false);
    });

    it("should return false for PNG", () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      expect(MediaDetector.isAnimatedBuffer(buffer)).toBe(false);
    });

    it("should return true for MOV with extension hint", () => {
      const buffer = Buffer.from([0x00, 0x00, 0x00, 0x00]);
      expect(MediaDetector.isAnimatedBuffer(buffer, "mov")).toBe(true);
    });
  });
});
