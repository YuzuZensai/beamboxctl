import { readFile } from "fs/promises";

/**
 * Media type detection result
 */
export interface MediaInfo {
  /** Type of media file */
  type: "image" | "gif" | "video";
  /** MIME type */
  mimeType: string;
  /** File extension */
  extension: string;
}

/**
 * Detect media file type from file path or buffer
 */
export class MediaDetector {
  /**
   * Detect media type from file path
   * @param filePath Path to the media file
   * @returns Media info
   */
  static async detectFromFile(filePath: string): Promise<MediaInfo> {
    const buffer = await readFile(filePath);
    const extension = filePath.split(".").pop()?.toLowerCase() || "";

    return this.detectFromBuffer(buffer, extension);
  }

  /**
   * Detect media type from buffer
   * @param buffer File data buffer
   * @param extension Optional file extension hint
   * @returns Media info
   */
  static detectFromBuffer(buffer: Buffer, extension: string = ""): MediaInfo {
    // Check magic bytes for file type
    const magic = buffer.subarray(0, 12);

    // GIF: 47 49 46 38 (GIF8)
    if (magic[0] === 0x47 && magic[1] === 0x49 && magic[2] === 0x46) {
      return {
        type: "gif",
        mimeType: "image/gif",
        extension: "gif",
      };
    }

    // Video formats
    // MP4: starts with ftyp box (offset 4-7: 66 74 79 70 = "ftyp")
    if (
      magic[4] === 0x66 &&
      magic[5] === 0x74 &&
      magic[6] === 0x79 &&
      magic[7] === 0x70
    ) {
      return {
        type: "video",
        mimeType: "video/mp4",
        extension: "mp4",
      };
    }

    // WebM: 1A 45 DF A3
    if (
      magic[0] === 0x1a &&
      magic[1] === 0x45 &&
      magic[2] === 0xdf &&
      magic[3] === 0xa3
    ) {
      return {
        type: "video",
        mimeType: "video/webm",
        extension: "webm",
      };
    }

    // AVI: 52 49 46 46 ... 41 56 49 20 (RIFF...AVI )
    if (
      magic[0] === 0x52 &&
      magic[1] === 0x49 &&
      magic[2] === 0x46 &&
      magic[3] === 0x46 &&
      magic[8] === 0x41 &&
      magic[9] === 0x56 &&
      magic[10] === 0x49
    ) {
      return {
        type: "video",
        mimeType: "video/x-msvideo",
        extension: "avi",
      };
    }

    // MOV/QuickTime: similar to MP4 but with different ftyp subtypes
    if (extension === "mov" || extension === "qt") {
      return {
        type: "video",
        mimeType: "video/quicktime",
        extension: "mov",
      };
    }

    // MKV: 1A 45 DF A3 (same as WebM but different codec)
    if (extension === "mkv") {
      return {
        type: "video",
        mimeType: "video/x-matroska",
        extension: "mkv",
      };
    }

    // JPEG: FF D8 FF
    if (magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff) {
      return {
        type: "image",
        mimeType: "image/jpeg",
        extension: "jpg",
      };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      magic[0] === 0x89 &&
      magic[1] === 0x50 &&
      magic[2] === 0x4e &&
      magic[3] === 0x47
    ) {
      return {
        type: "image",
        mimeType: "image/png",
        extension: "png",
      };
    }

    // WebP: 52 49 46 46 ... 57 45 42 50 (RIFF...WEBP)
    if (
      magic[0] === 0x52 &&
      magic[1] === 0x49 &&
      magic[2] === 0x46 &&
      magic[3] === 0x46 &&
      magic[8] === 0x57 &&
      magic[9] === 0x45 &&
      magic[10] === 0x42 &&
      magic[11] === 0x50
    ) {
      return {
        type: "image",
        mimeType: "image/webp",
        extension: "webp",
      };
    }

    // BMP: 42 4D
    if (magic[0] === 0x42 && magic[1] === 0x4d) {
      return {
        type: "image",
        mimeType: "image/bmp",
        extension: "bmp",
      };
    }

    // Default to image for unknown types
    return {
      type: "image",
      mimeType: "application/octet-stream",
      extension: extension || "bin",
    };
  }

  /**
   * Check if a file is animated (GIF or video)
   * @param filePath Path to the file
   * @returns True if file is animated
   */
  static async isAnimated(filePath: string): Promise<boolean> {
    const info = await this.detectFromFile(filePath);
    return info.type === "gif" || info.type === "video";
  }

  /**
   * Check if a buffer is animated (GIF or video)
   * @param buffer File data buffer
   * @param extension Optional file extension hint
   * @returns True if buffer is animated
   */
  static isAnimatedBuffer(buffer: Buffer, extension: string = ""): boolean {
    const info = this.detectFromBuffer(buffer, extension);
    return info.type === "gif" || info.type === "video";
  }
}
