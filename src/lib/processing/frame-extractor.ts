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
  /** Target FPS for extraction (default: extract all frames) */
  fps?: number;
  /** Target size for frames [width, height] */
  targetSize?: [number, number];
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
    const { fps = null, targetSize = [360, 360] } = options;

    // Create temporary directory for frames
    const tempDir = await mkdtemp(join(tmpdir(), "beambox-frames-"));

    try {
      logger.info(`Extracting frames from ${filePath} to ${tempDir}`);

      // Build ffmpeg command
      const outputPattern = join(tempDir, "frame_%05d.jpg");
      let ffmpegCmd = `ffmpeg -i "${filePath}"`;

      // Build filter chain
      let filters: string[] = [];

      // Add FPS filter if specified
      if (fps !== null) {
        filters.push(`fps=${fps}`);
      }

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
      // Use -q:v 10 for initial extraction (will be re-encoded with Sharp)
      ffmpegCmd += ` -q:v 10`;

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

        // Decode and re-encode to ensure consistent JPEG format with quality 75
        // This should match official app settings:
        // with Chroma subsampling: 4:4:4 (no subsampling, highest quality)
        const reencoded = await sharp(framePath)
          .jpeg({
            quality: 75,
            optimiseCoding: true,
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

  /**
   * Calculate GIF frame interval using app logic
   *
   * The app uses frame-count-based intervals for GIFs:
   * - <=12 frames: 200ms (5 fps)
   * - <=24 frames: 150ms (6.7 fps)
   * - >24 frames: 100ms (10 fps)
   *
   * This is then clamped to [50, 300]ms range.
   *
   * @param frameCount Number of extracted frames
   * @returns Frame interval in milliseconds
   */
  static calculateGifInterval(frameCount: number): number {
    let interval: number;

    if (frameCount <= 12) {
      interval = 200;
    } else if (frameCount <= 24) {
      interval = 150;
    } else {
      interval = 100;
    }

    // Clamp to [50, 300]ms range
    return Math.max(50, Math.min(300, interval));
  }

  /**
   * Get frame rate of a video file
   * @param filePath Path to the video file
   * @returns Frame rate in fps
   */
  static async getFrameRate(filePath: string): Promise<number> {
    try {
      const cmd = `ffprobe -v quiet -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 "${filePath}"`;
      const { stdout } = await execAsync(cmd);

      // Parse fraction (e.g., "30/1" or "30000/1001")
      const parts = stdout.trim().split("/");
      if (parts.length === 2) {
        const num = parseInt(parts[0]!);
        const den = parseInt(parts[1]!);
        return num / den;
      }

      return 30; // Default fallback
    } catch (error) {
      logger.warning(`Failed to get frame rate: ${error}`);
      return 30; // Default fallback
    }
  }

  /**
   * Get duration of a video file in seconds
   * @param filePath Path to the video file
   * @returns Duration in seconds
   */
  static async getDuration(filePath: string): Promise<number> {
    try {
      const cmd = `ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`;
      const { stdout } = await execAsync(cmd);
      return parseFloat(stdout.trim());
    } catch (error) {
      logger.warning(`Failed to get duration: ${error}`);
      return 0;
    }
  }

  /**
   * Calculate recommended frame interval in milliseconds
   *
   * Calculates the interval to preserve the original animation duration
   * based on source duration and actual extracted frame count.
   *
   * @param filePath Path to the source file
   * @param extractedFrameCount Number of frames that were extracted
   * @returns Frame interval in milliseconds
   */
  static async calculateFrameInterval(
    filePath: string,
    extractedFrameCount: number,
  ): Promise<number> {
    const duration = await this.getDuration(filePath);

    if (duration > 0 && extractedFrameCount > 1) {
      // Calculate interval to maintain original playback speed
      const intervalMs = (duration * 1000) / extractedFrameCount;
      // Device requires minimum 150ms interval to play animations? Maybe, from trials and errors.
      // Below 150ms, the device shows only the first frame, somtimes?
      // Need more testing to confirm.
      return Math.max(150, Math.round(intervalMs));
    }

    return 150; // Default 150ms (~6.7fps), device minimum for animation?
  }
}
