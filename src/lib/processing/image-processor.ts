import sharp from "sharp";
import type { ImageConfig } from "../protocol/index.ts";
import { ImageProcessingError } from "../utils/errors.ts";

/**
 * Image processor for loading, generating, and preparing images.
 * Handles image operations using the Sharp library including resizing,
 * format conversion, and test pattern generation.
 */
export class ImageProcessor {
  /**
   * Creates a new ImageProcessor instance.
   * @param config Image configuration containing default size,
   * JPEG quality, and checkerboard settings
   */
  constructor(private config: ImageConfig) {}

  /**
   * Load an image from a file path
   * @param imagePath Path to the image file
   * @returns Sharp instance
   */
  public async loadFromFile(imagePath: string): Promise<sharp.Sharp> {
    try {
      return sharp(imagePath);
    } catch (error) {
      throw new ImageProcessingError(
        `Failed to load image from ${imagePath}: ${error}`,
      );
    }
  }

  /**
   * Generate a checkerboard test pattern
   * @param size Image size [width, height]
   * @param squares Number of squares per side
   * @returns Buffer containing PNG image data
   */
  public async generateCheckerboard(
    size: [number, number] = this.config.defaultSize,
    squares: number = this.config.checkerboardSquares,
  ): Promise<Buffer> {
    const [width, height] = size;
    const squareWidth = Math.floor(width / squares);
    const squareHeight = Math.floor(height / squares);

    // Create SVG checkerboard pattern
    const svgPattern = this.createCheckerboardSVG(
      width,
      height,
      squareWidth,
      squareHeight,
      squares,
    );

    try {
      return await sharp(Buffer.from(svgPattern)).png().toBuffer();
    } catch (error) {
      throw new ImageProcessingError(
        `Failed to generate checkerboard: ${error}`,
      );
    }
  }

  // Standard JFIF APP0 marker segment (18 bytes)
  // This marker is required for some devices to properly decode the JPEG
  // Structure: FF E0 + length (16) + 'JFIF\0' + version 1.1 + aspect ratio + density
  private static readonly JFIF_MARKER = Buffer.from([
    0xff,
    0xe0, // APP0 marker
    0x00,
    0x10, // Length: 16 bytes (including these 2)
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00, // 'JFIF\0'
    0x01,
    0x01, // Version 1.1
    0x00, // Aspect ratio units: 0 = no units
    0x00,
    0x01, // X density: 1
    0x00,
    0x01, // Y density: 1
    0x00,
    0x00, // No thumbnail
  ]);

  /**
   * Prepare an image as JPEG bytes
   * @param imageInput Sharp instance or buffer
   * @param targetSize Target size [width, height]
   * @returns JPEG image as Buffer with JFIF marker
   */
  public async prepareImage(
    imageInput: sharp.Sharp | Buffer,
    targetSize: [number, number] = this.config.defaultSize,
  ): Promise<Buffer> {
    try {
      const pipeline = Buffer.isBuffer(imageInput)
        ? sharp(imageInput)
        : imageInput;

      const jpegData = await pipeline
        .resize(targetSize[0], targetSize[1], {
          fit: "cover", // Use 'cover' to fill frame (official app does scale increase + crop)
          position: "center",
          kernel: "lanczos3",
        })
        .toColorspace("srgb")
        .jpeg({
          quality: this.config.jpegQuality,
          optimiseCoding: true,
          mozjpeg: false,
          chromaSubsampling: "4:2:0",
        })
        .toBuffer();

      // Inject JFIF marker after SOI (FF D8)
      // Sharp doesn't include JFIF by default, but the device may require it? Just to be safe.
      return Buffer.concat([
        jpegData.subarray(0, 2), // SOI (FF D8)
        ImageProcessor.JFIF_MARKER, // JFIF APP0 marker
        jpegData.subarray(2), // Rest of JPEG data
      ]);
    } catch (error) {
      throw new ImageProcessingError(`Failed to prepare image: ${error}`);
    }
  }

  /**
   * Load and prepare an image from file as JPEG bytes
   * @param imagePath Path to the image file
   * @param targetSize Target size [width, height]
   * @returns JPEG image as Buffer
   */
  public async prepareFromFile(
    imagePath: string,
    targetSize: [number, number] = this.config.defaultSize,
  ): Promise<Buffer> {
    const image = await this.loadFromFile(imagePath);
    return this.prepareImage(image, targetSize);
  }

  /**
   * Create SVG markup for a checkerboard pattern.
   * Generates alternating black and white squares.
   * @private
   * @param width Total image width in pixels
   * @param height Total image height in pixels
   * @param squareWidth Width of each square in pixels
   * @param squareHeight Height of each square in pixels
   * @param squares Number of squares per row/column
   * @returns SVG string containing the checkerboard pattern
   */
  private createCheckerboardSVG(
    width: number,
    height: number,
    squareWidth: number,
    squareHeight: number,
    squares: number,
  ): string {
    let rects = "";

    for (let row = 0; row < squares; row++) {
      for (let col = 0; col < squares; col++) {
        if ((row + col) % 2 === 0) {
          const x = col * squareWidth;
          const y = row * squareHeight;
          rects += `<rect x="${x}" y="${y}" width="${squareWidth}" height="${squareHeight}" fill="black"/>`;
        }
      }
    }

    return `
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${width}" height="${height}" fill="white"/>
        ${rects}
      </svg>
    `;
  }
}
