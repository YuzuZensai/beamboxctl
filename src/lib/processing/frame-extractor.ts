import { exec } from "child_process";
import { promisify } from "util";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";
import type { XV4Frame } from "../protocol/index.ts";
import { ImageProcessingError } from "../utils/errors.ts";
import { logger } from "../utils/logger.ts";

const execAsync = promisify(exec);

export interface FrameExtractionOptions {
  /** Target FPS for extraction. */
  fps?: number;
  /** Target size for frames [width, height] */
  targetSize?: [number, number];
  /** Maximum source duration to extract, in seconds. */
  maxDurationSecs?: number;
}

/**
 * Extract frames from animated GIFs and videos using ffmpeg
 */
export class FrameExtractor {
  /**
   * Extract frames from a GIF or video file
   * @param filePath Path to the GIF or video file
   * @param options Extraction options
   * @returns Array of XV4 frames ready for upload
   */
  static async extractFrames(
    filePath: string,
    options: FrameExtractionOptions = {},
  ): Promise<XV4Frame[]> {
    // The official app extracts at 20fps, and caps at 3 seconds (60 frames max).
    // Let's do the same to ensure consistent results and avoid overwhelming the device with too many frames
    // Because the device firmware blindly accepts all frames and can cause the device to brick :(
    const { fps = 20, targetSize = [360, 360], maxDurationSecs = 3 } = options;

    // Create temporary directory for frames
    const tempDir = await mkdtemp(join(tmpdir(), "beambox-frames-"));

    try {
      logger.info(`Extracting frames from ${filePath} to ${tempDir}`);

      // Build ffmpeg command
      const outputPattern = join(tempDir, "frame_%05d.jpg");
      let ffmpegCmd = `ffmpeg -i "${filePath}"`;

      ffmpegCmd += ` -t ${maxDurationSecs}`;

      // Build filter chain
      let filters: string[] = [`fps=${fps}`];

      // Add scaling and cropping to fill frame (official app does this)
      // Use 'increase' to scale up to fill, then crop to exact dimensions
      filters.push(
        `scale=${targetSize[0]}:${targetSize[1]}:force_original_aspect_ratio=increase`,
      );
      filters.push(`crop=${targetSize[0]}:${targetSize[1]}`);

      // Combine all filters
      if (filters.length > 0) {
        ffmpegCmd += ` -vf "${filters.join(",")}"`;
      }

      // Add quality settings
      // -q:v 3 matches the official app
      ffmpegCmd += ` -q:v 3`;

      ffmpegCmd += ` "${outputPattern}"`;

      logger.info(`Running: ${ffmpegCmd}`);

      // Execute ffmpeg
      const { stdout, stderr } = await execAsync(ffmpegCmd);

      if (stderr && !stderr.includes("frame=")) {
        logger.warning(`ffmpeg stderr: ${stderr}`);
      }

      // Read extracted frames
      const files = await readdir(tempDir);
      const frameFiles = files
        .filter((f) => f.startsWith("frame_") && f.endsWith(".jpg"))
        .sort();

      if (frameFiles.length === 0) {
        throw new ImageProcessingError(
          "No frames were extracted. Ensure the file is a valid GIF or video and ffmpeg is installed.",
        );
      }

      logger.info(`Extracted ${frameFiles.length} frames`);

      // Load frames into XV4Frame format
      // Re-encode frames to ensure consistent JPEG format
      logger.info("Re-encoding frames to quality 75...");

      // Standard JFIF APP0 marker segment (18 bytes)
      // This marker is required for some devices to properly decode the JPEG
      // Structure: FF E0 + length (16) + 'JFIF\0' + version 1.1 + aspect ratio + density
      const jfifMarker = Buffer.from([
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

      // Process frames in parallel for speed
      const framePromises = frameFiles.map(async (file) => {
        const framePath = join(tempDir, file);

        // Decode and re-encode to ensure consistent JPEG format with quality 75 (matches official app)
        // the official app's encoder doesn't seem to optimise so optimiseCoding will be off too
        const reencoded = await sharp(framePath)
          .jpeg({
            quality: 75,
            optimiseCoding: false,
            mozjpeg: false,
            chromaSubsampling: "4:4:4",
          })
          .toBuffer();

        // Inject JFIF marker after SOI (FF D8)
        // Sharp doesn't include JFIF by default, but the device may require it? Just to be safe.
        // SOI is always at the start: FF D8
        const withJfif = Buffer.concat([
          reencoded.subarray(0, 2), // SOI (FF D8)
          jfifMarker, // JFIF APP0 marker
          reencoded.subarray(2), // Rest of JPEG data
        ]);

        // Extract frame number from filename like ("frame_00001.jpg" -> "frame_00001")
        const name = file.replace(".jpg", "");

        return {
          name,
          data: withJfif,
        };
      });

      const frames = await Promise.all(framePromises);
      const totalSize = frames.reduce((sum, f) => sum + f.data.length, 0);
      logger.info(
        `Re-encoding complete. Total JPEG data: ${(totalSize / 1024).toFixed(2)} KB`,
      );

      return frames;
    } catch (error) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new ImageProcessingError(
          "ffmpeg not found. Please install ffmpeg to extract frames from GIFs and videos.\n" +
            "Install: sudo apt-get install ffmpeg (Linux) or brew install ffmpeg (macOS)",
        );
      }
      throw new ImageProcessingError(`Failed to extract frames: ${error}`);
    } finally {
      // Clean up temporary directory
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        logger.warning(`Failed to clean up temp directory: ${error}`);
      }
    }
  }
}
