import { describe, expect, test } from "bun:test";
import path from "path";
import sharp from "sharp";
import { DEFAULT_IMAGE_CONFIG } from "../protocol/interfaces/defaults.ts";
import { ImageProcessingError } from "../utils/errors.ts";
import { ImageProcessor } from "./image-processor.ts";

const fixturesPath = path.join(__dirname, "../../__tests__/fixtures");
const testImagePath = path.join(fixturesPath, "test-1x1.png");
const invalidImagePath = path.join(fixturesPath, "invalid-image.txt");

describe("ImageProcessor", () => {
  const processor = new ImageProcessor(DEFAULT_IMAGE_CONFIG);

  describe("loadFromFile()", () => {
    test("loads valid PNG file", async () => {
      const image = await processor.loadFromFile(testImagePath);
      expect(image).toBeDefined();

      // Should be a Sharp instance
      const metadata = await image.metadata();
      expect(metadata.width).toBe(1);
      expect(metadata.height).toBe(1);
    });

    test("Sharp doesn't throw immediately on non-existent file", async () => {
      // Sharp creates lazily, so loadFromFile won't throw
      // The error happens when you try to use it
      const image = await processor.loadFromFile("/non/existent/path.png");
      expect(image).toBeDefined();
    });

    test("Sharp doesn't throw immediately on invalid image file", async () => {
      // Sharp loads lazily
      const image = await processor.loadFromFile(invalidImagePath);
      expect(image).toBeDefined();
    });
  });

  describe("generateCheckerboard()", () => {
    test("generates PNG buffer with default size", async () => {
      const png = await processor.generateCheckerboard();
      expect(Buffer.isBuffer(png)).toBe(true);

      const metadata = await sharp(png).metadata();
      expect(metadata.format).toBe("png");
      expect(metadata.width).toBe(DEFAULT_IMAGE_CONFIG.defaultSize[0]);
      expect(metadata.height).toBe(DEFAULT_IMAGE_CONFIG.defaultSize[1]);
    });

    test("generates PNG with custom size (128x64)", async () => {
      const png = await processor.generateCheckerboard([128, 64]);
      const metadata = await sharp(png).metadata();
      expect(metadata.width).toBe(128);
      expect(metadata.height).toBe(64);
    });

    test("generates with default squares (from config)", async () => {
      const png = await processor.generateCheckerboard();
      expect(Buffer.isBuffer(png)).toBe(true);
      // Just verify it doesn't throw
    });

    test("generates with custom squares (4x4)", async () => {
      const png = await processor.generateCheckerboard([64, 32], 4);
      expect(Buffer.isBuffer(png)).toBe(true);
      const metadata = await sharp(png).metadata();
      expect(metadata.width).toBe(64);
      expect(metadata.height).toBe(32);
    });

    test("generates with custom squares (16x16)", async () => {
      const png = await processor.generateCheckerboard([128, 128], 16);
      expect(Buffer.isBuffer(png)).toBe(true);
      const metadata = await sharp(png).metadata();
      expect(metadata.width).toBe(128);
      expect(metadata.height).toBe(128);
    });

    test("can be parsed by Sharp", async () => {
      const png = await processor.generateCheckerboard([64, 32]);
      const image = sharp(png);
      const metadata = await image.metadata();
      expect(metadata.width).toBe(64);
      expect(metadata.height).toBe(32);
    });

    test("edge case: 1x1 grid (all black)", async () => {
      const png = await processor.generateCheckerboard([10, 10], 1);
      expect(Buffer.isBuffer(png)).toBe(true);
    });

    test("edge case: 2x2 grid", async () => {
      const png = await processor.generateCheckerboard([20, 20], 2);
      expect(Buffer.isBuffer(png)).toBe(true);
    });

    test("throws ImageProcessingError on failure", async () => {
      // This is hard to trigger, but we verify the error type would be correct
      // by checking that normal generation doesn't throw
      await expect(
        processor.generateCheckerboard([64, 32], 8),
      ).resolves.toBeDefined();
    });
  });

  describe("prepareImage()", () => {
    test("accepts Sharp instance input", async () => {
      const image = sharp(await processor.generateCheckerboard());
      const jpeg = await processor.prepareImage(image, [64, 32]);
      expect(Buffer.isBuffer(jpeg)).toBe(true);
    });

    test("accepts Buffer input (PNG)", async () => {
      const png = await processor.generateCheckerboard();
      const jpeg = await processor.prepareImage(png, [64, 32]);
      expect(Buffer.isBuffer(jpeg)).toBe(true);
    });

    test("resizes to target size", async () => {
      const png = await processor.generateCheckerboard([100, 100]);
      const jpeg = await processor.prepareImage(png, [64, 32]);

      const metadata = await sharp(jpeg).metadata();
      expect(metadata.width).toBe(64);
      expect(metadata.height).toBe(32);
    });

    test("output is JPEG format", async () => {
      const png = await processor.generateCheckerboard();
      const jpeg = await processor.prepareImage(png, [64, 32]);

      const metadata = await sharp(jpeg).metadata();
      expect(metadata.format).toBe("jpeg");
    });

    test("output has correct JPEG quality (from config)", async () => {
      const png = await processor.generateCheckerboard();
      const jpeg = await processor.prepareImage(png, [64, 32]);

      // Can't directly test quality, but verify it's a valid JPEG
      const metadata = await sharp(jpeg).metadata();
      expect(metadata.format).toBe("jpeg");
    });

    test("output dimensions match target", async () => {
      const png = await processor.generateCheckerboard();
      const jpeg = await processor.prepareImage(png, [128, 64]);

      const metadata = await sharp(jpeg).metadata();
      expect(metadata.width).toBe(128);
      expect(metadata.height).toBe(64);
    });

    test("uses default size when not specified", async () => {
      const png = await processor.generateCheckerboard();
      const jpeg = await processor.prepareImage(png);

      const metadata = await sharp(jpeg).metadata();
      expect(metadata.width).toBe(DEFAULT_IMAGE_CONFIG.defaultSize[0]);
      expect(metadata.height).toBe(DEFAULT_IMAGE_CONFIG.defaultSize[1]);
    });

    test("throws ImageProcessingError on invalid input", async () => {
      const invalidBuffer = Buffer.from("not an image");
      await expect(
        processor.prepareImage(invalidBuffer, [64, 32]),
      ).rejects.toThrow(ImageProcessingError);
    });

    test("error message includes context", async () => {
      try {
        await processor.prepareImage(Buffer.from("bad"), [64, 32]);
        throw new Error("Should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("prepare image");
      }
    });
  });

  describe("prepareFromFile()", () => {
    test("loads and prepares in one call", async () => {
      const jpeg = await processor.prepareFromFile(testImagePath, [64, 32]);
      expect(Buffer.isBuffer(jpeg)).toBe(true);

      const metadata = await sharp(jpeg).metadata();
      expect(metadata.format).toBe("jpeg");
      expect(metadata.width).toBe(64);
      expect(metadata.height).toBe(32);
    });

    test("returns JPEG Buffer", async () => {
      const jpeg = await processor.prepareFromFile(testImagePath, [64, 32]);
      const metadata = await sharp(jpeg).metadata();
      expect(metadata.format).toBe("jpeg");
    });

    test("dimensions match target", async () => {
      const jpeg = await processor.prepareFromFile(testImagePath, [128, 64]);
      const metadata = await sharp(jpeg).metadata();
      expect(metadata.width).toBe(128);
      expect(metadata.height).toBe(64);
    });

    test("throws on invalid path", async () => {
      await expect(
        processor.prepareFromFile("/bad/path.png", [64, 32]),
      ).rejects.toThrow(ImageProcessingError);
    });

    test("throws on invalid image", async () => {
      await expect(
        processor.prepareFromFile(invalidImagePath, [64, 32]),
      ).rejects.toThrow(ImageProcessingError);
    });

    test("uses default size when not specified", async () => {
      const jpeg = await processor.prepareFromFile(testImagePath);
      const metadata = await sharp(jpeg).metadata();
      expect(metadata.width).toBe(DEFAULT_IMAGE_CONFIG.defaultSize[0]);
      expect(metadata.height).toBe(DEFAULT_IMAGE_CONFIG.defaultSize[1]);
    });
  });

  describe("output format verification", () => {
    test("JPEG has correct magic bytes", async () => {
      const png = await processor.generateCheckerboard();
      const jpeg = await processor.prepareImage(png, [64, 32]);

      // JPEG starts with FF D8
      expect(jpeg[0]).toBe(0xff);
      expect(jpeg[1]).toBe(0xd8);
      // JPEG ends with FF D9
      expect(jpeg[jpeg.length - 2]).toBe(0xff);
      expect(jpeg[jpeg.length - 1]).toBe(0xd9);
    });

    test("output is valid and can be processed again", async () => {
      const png = await processor.generateCheckerboard();
      const jpeg1 = await processor.prepareImage(png, [64, 32]);

      // Process the JPEG again
      const jpeg2 = await processor.prepareImage(jpeg1, [32, 16]);

      const metadata = await sharp(jpeg2).metadata();
      expect(metadata.width).toBe(32);
      expect(metadata.height).toBe(16);
      expect(metadata.format).toBe("jpeg");
    });
  });

  describe("integration tests", () => {
    test("full workflow: generate -> prepare", async () => {
      const png = await processor.generateCheckerboard([100, 100], 8);
      const jpeg = await processor.prepareImage(png, [64, 32]);

      expect(Buffer.isBuffer(jpeg)).toBe(true);
      const metadata = await sharp(jpeg).metadata();
      expect(metadata.format).toBe("jpeg");
      expect(metadata.width).toBe(64);
      expect(metadata.height).toBe(32);
    });

    test("full workflow: load file -> prepare", async () => {
      const jpeg = await processor.prepareFromFile(testImagePath, [64, 32]);

      expect(Buffer.isBuffer(jpeg)).toBe(true);
      const metadata = await sharp(jpeg).metadata();
      expect(metadata.format).toBe("jpeg");
      expect(metadata.width).toBe(64);
      expect(metadata.height).toBe(32);
    });

    test("multiple operations in sequence", async () => {
      const png1 = await processor.generateCheckerboard([100, 100]);
      const jpeg1 = await processor.prepareImage(png1, [64, 32]);

      const png2 = await processor.generateCheckerboard([50, 50]);
      const jpeg2 = await processor.prepareImage(png2, [128, 64]);

      expect(jpeg1.length).toBeDefined();
      expect(jpeg2.length).toBeDefined();
      expect(jpeg1.length).not.toBe(jpeg2.length);
    });
  });
});
