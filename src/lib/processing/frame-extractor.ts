import { exec } from "child_process";
import { promisify } from "util";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { XV4Frame } from "../protocol/index.ts";
import { ImageProcessingError } from "../utils/errors.ts";
import { logger } from "../utils/logger.ts";

const execAsync = promisify(exec);

export interface FrameExtractionOptions {
  /** Maximum number of frames to extract (default: 100) */
  maxFrames?: number;
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
    const {
      maxFrames = 100,
      fps = null,
      targetSize = [368, 368],
    } = options;

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

      // Add scaling and padding
      filters.push(`scale=${targetSize[0]}:${targetSize[1]}:force_original_aspect_ratio=decrease`);
      filters.push(`pad=${targetSize[0]}:${targetSize[1]}:(ow-iw)/2:(oh-ih)/2`);

      // Combine all filters
      if (filters.length > 0) {
        ffmpegCmd += ` -vf "${filters.join(',')}"`;
      }

      // Add frame limit
      ffmpegCmd += ` -vframes ${maxFrames}`;

      // Add quality settings
      ffmpegCmd += ` -q:v 2`; // High quality JPEG

      ffmpegCmd += ` "${outputPattern}"`;

      logger.info(`Running: ${ffmpegCmd}`);

      // Execute ffmpeg
      const { stdout, stderr } = await execAsync(ffmpegCmd);

      if (stderr && !stderr.includes("frame=")) {
        logger.warn(`ffmpeg stderr: ${stderr}`);
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
      const frames: XV4Frame[] = [];
      for (const file of frameFiles) {
        const framePath = join(tempDir, file);
        const data = await readFile(framePath);

        // Extract frame number from filename (e.g., "frame_00001.jpg" -> "frame_00001")
        const name = file.replace(".jpg", "");

        frames.push({
          name,
          data,
        });
      }

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
        logger.warn(`Failed to clean up temp directory: ${error}`);
      }
    }
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
      logger.warn(`Failed to get frame rate: ${error}`);
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
      logger.warn(`Failed to get duration: ${error}`);
      return 0;
    }
  }

  /**
   * Calculate recommended frame interval in milliseconds based on extracted frames and original duration
   * @param filePath Path to the source file
   * @param extractedFrameCount Number of frames that were extracted
   * @returns Recommended interval in milliseconds
   */
  static async calculateFrameInterval(
    filePath: string,
    extractedFrameCount: number,
  ): Promise<number> {
    const duration = await this.getDuration(filePath);

    if (duration > 0 && extractedFrameCount > 1) {
      // Calculate interval to maintain original playback speed
      const intervalMs = (duration * 1000) / extractedFrameCount;
      return Math.max(20, Math.round(intervalMs)); // Minimum 20ms (50fps)
    }

    return 50; // Default 50ms (20fps)
  }
}
