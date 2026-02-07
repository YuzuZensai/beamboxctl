/**
 * xV4 Animation header builder
 *
 * The xV4 format is an animation container for BeamBox devices.
 *
 * ## Format Structure
 *
 * ```
 * HEADER (32 bytes fixed):
 * [0-3]   "xV4" + 0x12 (signature + version)
 * [4-7]   Header size = frame_table_end - 8 (uint32 LE)
 * [8-11]  Frame count (uint32 LE)
 * [12-15] Unknown value = frame_count * 10 + 10 (uint32 LE)
 * [16-27] Timing string "output/XXms\0" (12 bytes, null-padded)
 * [28-31] Total data size including per-frame metadata (uint32 LE)
 *
 * FRAME TABLE (frame_count * 16 bytes):
 * Each entry (16 bytes):
 *   [0-11]  Frame name "frame_XXXXX." (12 bytes, dot-terminated)
 *   [12-15] Cumulative offset from frame_table_end (uint32 LE)
 *           This points to the per-frame metadata block, not the JPEG directly
 *
 * PER-FRAME DATA (repeated for each frame):
 *   FRAME METADATA (32 bytes):
 *   [0-3]   Current frame table offset (uint32 LE)
 *   [4-7]   Next frame table offset (uint32 LE)
 *           Points to next frame's metadata, or back to first frame for looping
 *   [8-11]  Unknown value = frame_count - 3 (uint32 LE)
 *   [12-13] Width (uint16 LE)
 *   [14-15] Height (uint16 LE)
 *   [16-19] Actual JPEG start offset in file (uint32 LE)
 *   [20-23] Current frame JPEG size (uint32 LE)
 *   [24-31] Padding zeros (8 bytes)
 *
 *   JPEG DATA (variable size)
 * ```
 */

export interface XV4Frame {
  /** Frame name without extension, e.g., "frame_00001" */
  name: string;
  /** JPEG image data for this frame */
  data: Buffer;
}

export class XV4HeaderBuilder {
  private static readonly SIGNATURE = Buffer.from("xV4");
  private static readonly VERSION = 0x12;

  // Fixed sizes
  private static readonly FIXED_HEADER_SIZE = 32;
  private static readonly FRAME_ENTRY_SIZE = 16;
  private static readonly FRAME_NAME_SIZE = 12;
  private static readonly FRAME_METADATA_SIZE = 32;

  /**
   * Build complete xV4 animation container with frames
   *
   * @param frames Array of frames with names and JPEG data
   * @param intervalMs Frame interval in milliseconds (e.g., 50 for 20fps)
   * @param width Image width (default: 360)
   * @param height Image height (default: 360)
   * @returns Complete xV4 animation buffer ready to send
   */
  static build(
    frames: XV4Frame[],
    intervalMs: number = 50,
    width: number = 360,
    height: number = 360,
  ): Buffer {
    if (frames.length === 0) {
      throw new Error("At least one frame is required");
    }

    const frameCount = frames.length;

    // Calculate sizes
    const frameTableSize = frameCount * this.FRAME_ENTRY_SIZE;
    const frameTableEnd = this.FIXED_HEADER_SIZE + frameTableSize;

    // Total size = header + frame_table + (metadata + jpeg) for each frame
    const totalDataSize = frames.reduce(
      (sum, frame) => sum + this.FRAME_METADATA_SIZE + frame.data.length,
      0,
    );
    const totalSize = frameTableEnd + totalDataSize;

    const container = Buffer.alloc(totalSize);
    let offset = 0;

    // ===== HEADER (32 bytes) =====

    // [0-2] Signature "xV4"
    this.SIGNATURE.copy(container, offset);
    offset += 3;

    // [3] Version 0x12
    container.writeUInt8(this.VERSION, offset);
    offset += 1;

    // [4-7] Header size = frame_table_end - 8
    const headerSizeField = frameTableEnd - 8;
    container.writeUInt32LE(headerSizeField, offset);
    offset += 4;

    // [8-11] Frame count
    container.writeUInt32LE(frameCount, offset);
    offset += 4;

    // [12-15] Unknown value = frame_count * 10 + 10
    const unknownValue = frameCount * 10 + 10;
    container.writeUInt32LE(unknownValue, offset);
    offset += 4;

    // [16-27] Timing string "output/XXms\0" (12 bytes, null-padded)
    // The timing string must fit in 12 bytes including null terminator.
    // This means intervals must be 10-99ms (2 digits) to fit "output/XXms\0" format.
    // Clamp intervals to 50-99 range to ensure proper format.
    const clampedInterval = Math.max(50, Math.min(99, intervalMs));
    const timingStr = `output/${clampedInterval}ms`;
    const timingBuffer = Buffer.alloc(this.FRAME_NAME_SIZE);
    Buffer.from(timingStr, "utf-8").copy(timingBuffer);
    // Add null terminator (rest is already zeros from alloc)
    timingBuffer.copy(container, offset);
    offset += this.FRAME_NAME_SIZE;

    // [28-31] Total data size (metadata + jpeg for all frames)
    container.writeUInt32LE(totalDataSize, offset);
    offset += 4;

    // Verify we're at the right position
    if (offset !== this.FIXED_HEADER_SIZE) {
      throw new Error(
        `Header size mismatch: expected ${this.FIXED_HEADER_SIZE}, got ${offset}`,
      );
    }

    // ===== FRAME TABLE (frameCount * 16 bytes) =====

    // Calculate cumulative offsets (metadata + jpeg for each frame)
    // The offset stored is: frame_table_end + cumulative_offset_to_metadata
    const frameTableOffsets: number[] = [];
    let cumulativeOffset = 0;

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]!;

      // [0-11] Frame name (12 bytes, dot-terminated, null-padded)
      const nameWithDot = frame.name + ".";
      const nameBuffer = Buffer.alloc(this.FRAME_NAME_SIZE);
      Buffer.from(nameWithDot, "utf-8").copy(
        nameBuffer,
        0,
        0,
        this.FRAME_NAME_SIZE,
      );
      nameBuffer.copy(container, offset);
      offset += this.FRAME_NAME_SIZE;

      // [12-15] Offset = frame_table_end + cumulative offset to this frame's metadata
      const frameOffset = frameTableEnd + cumulativeOffset;
      frameTableOffsets.push(frameOffset);
      container.writeUInt32LE(frameOffset, offset);
      offset += 4;

      // Update cumulative offset for next frame (metadata + jpeg size)
      cumulativeOffset += this.FRAME_METADATA_SIZE + frame.data.length;
    }

    // Verify frame table end position
    if (offset !== frameTableEnd) {
      throw new Error(
        `Frame table end mismatch: expected ${frameTableEnd}, got ${offset}`,
      );
    }

    // ===== PER-FRAME DATA (metadata + jpeg for each frame) =====

    // TODO: Investigate unknown metadata field meaning
    const unknownMetaValue = Math.max(0, frameCount - 3); // 11 for 14 frames?

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]!;
      const frameSize = frame.data.length;

      // Current frame's table offset
      const currentTableOffset = frameTableOffsets[i]!;
      // Next frame's table offset (loop back to first frame for continuous playback)
      const nextTableOffset =
        i < frames.length - 1
          ? frameTableOffsets[i + 1]!
          : frameTableOffsets[0]!;
      // Actual JPEG start position in file
      const jpegStartOffset = offset + this.FRAME_METADATA_SIZE;

      // ===== FRAME METADATA (32 bytes) =====

      // [0-3] Current frame table offset
      container.writeUInt32LE(currentTableOffset, offset);
      offset += 4;

      // [4-7] Next frame table offset (loops back to first frame for continuous playback)
      container.writeUInt32LE(nextTableOffset, offset);
      offset += 4;

      // [8-11] Unknown value = frame_count - 3
      container.writeUInt32LE(unknownMetaValue, offset);
      offset += 4;

      // [12-13] Width (uint16 LE)
      container.writeUInt16LE(width, offset);
      offset += 2;

      // [14-15] Height (uint16 LE)
      container.writeUInt16LE(height, offset);
      offset += 2;

      // [16-19] Actual JPEG start offset in file
      container.writeUInt32LE(jpegStartOffset, offset);
      offset += 4;

      // [20-23] Current frame JPEG size
      container.writeUInt32LE(frameSize, offset);
      offset += 4;

      // [24-31] Padding zeros (already zeroed from alloc)
      offset += 8;

      // ===== FRAME JPEG DATA =====
      frame.data.copy(container, offset);
      offset += frameSize;
    }

    // Verify final size
    if (offset !== totalSize) {
      throw new Error(
        `Total size mismatch: expected ${totalSize}, got ${offset}`,
      );
    }

    return container;
  }

  /**
   * Validate that a buffer is a proper xV4 container
   * @param buffer Buffer to validate
   * @returns True if valid xV4 container
   */
  static validate(buffer: Buffer): boolean {
    if (buffer.length < this.FIXED_HEADER_SIZE) {
      return false;
    }

    // Check signature
    if (!buffer.subarray(0, 3).equals(this.SIGNATURE)) {
      return false;
    }

    // Check version
    if (buffer.readUInt8(3) !== this.VERSION) {
      return false;
    }

    return true;
  }

  /**
   * Debug helper: dump xV4 container structure
   */
  static dump(buffer: Buffer): string {
    const lines: string[] = [];
    lines.push("=== xV4 Container Dump ===");

    if (!this.validate(buffer)) {
      lines.push("Invalid xV4 container");
      return lines.join("\n");
    }

    lines.push(`Total size: ${buffer.length} bytes`);
    lines.push("");

    // Header
    lines.push("HEADER:");
    lines.push(`  Signature: ${buffer.subarray(0, 3).toString()}`);
    lines.push(`  Version: 0x${buffer.readUInt8(3).toString(16)}`);
    lines.push(`  Header size field: ${buffer.readUInt32LE(4)}`);
    lines.push(`  Frame count: ${buffer.readUInt32LE(8)}`);
    lines.push(`  Unknown field: ${buffer.readUInt32LE(12)}`);

    const timingStr = buffer
      .subarray(16, 28)
      .toString("utf-8")
      .replace(/\0.*$/, "");
    lines.push(`  Timing string: "${timingStr}"`);
    lines.push(`  Total JPEG size: ${buffer.readUInt32LE(28)}`);

    // Frame table
    const frameCount = buffer.readUInt32LE(8);
    lines.push("");
    lines.push(`FRAME TABLE (${frameCount} entries):`);

    let tableOffset = this.FIXED_HEADER_SIZE;
    for (let i = 0; i < frameCount && tableOffset + 16 <= buffer.length; i++) {
      const name = buffer
        .subarray(tableOffset, tableOffset + 12)
        .toString("utf-8")
        .replace(/\0.*$/, "");
      const cumOffset = buffer.readUInt32LE(tableOffset + 12);
      lines.push(`  [${i}] name="${name}", cumOffset=${cumOffset}`);
      tableOffset += 16;
    }

    // First frame metadata (32 bytes)
    const firstMetadataStart =
      this.FIXED_HEADER_SIZE + frameCount * this.FRAME_ENTRY_SIZE;
    if (firstMetadataStart + this.FRAME_METADATA_SIZE <= buffer.length) {
      lines.push("");
      lines.push("FIRST FRAME METADATA:");
      lines.push(
        `  Current table offset: ${buffer.readUInt32LE(firstMetadataStart)}`,
      );
      lines.push(
        `  Next table offset: ${buffer.readUInt32LE(firstMetadataStart + 4)}`,
      );
      lines.push(`  Unknown: ${buffer.readUInt32LE(firstMetadataStart + 8)}`);
      lines.push(
        `  Dimensions: ${buffer.readUInt16LE(firstMetadataStart + 12)}x${buffer.readUInt16LE(firstMetadataStart + 14)}`,
      );
      lines.push(
        `  JPEG offset: ${buffer.readUInt32LE(firstMetadataStart + 16)}`,
      );
      lines.push(
        `  Frame size: ${buffer.readUInt32LE(firstMetadataStart + 20)}`,
      );
    }

    return lines.join("\n");
  }
}
