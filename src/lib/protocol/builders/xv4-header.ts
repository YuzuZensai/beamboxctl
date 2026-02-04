/**
 * xV4 Animation header builder
 *
 * The xV4 format is a animation container
 *
 * ## Format Structure
 *
 * ```
 * [Magic: "xV4"] [3 bytes]
 * [Version] [1 byte] - Always 0x12
 * [Unknown] [1 byte] - Always 0x48
 * [Padding] [3 bytes] - Always 0x00 0x00 0x00
 * [Frame count] [4 bytes, LE u32]
 * [Total JPEG size] [4 bytes, LE u32] - Sum of all frame data sizes
 * [Timing string] [variable, null-terminated] - e.g., "output/50ms\0"
 * [Frame data offset] [4 bytes, LE u32] - Offset to where JPEG data starts
 * [Frame table] [variable] - Frame entries (name + size)
 * [Footer] [16 bytes] - Frame sizes (first 2), unknown, dimensions
 * [JPEG data] [variable] - Concatenated JPEG frames
 * ```
 *
 * ## Frame Table Entry
 *
 * Each entry consists of:
 * - Frame name (dot-terminated string): e.g., "frame_00001."
 * - Frame size (4 bytes, LE u32): Size of this JPEG frame in bytes
 *
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
  private static readonly UNKNOWN_BYTE = 0x48;

  /**
   * Build complete xV4 animation container with frames
   *
   * @param frames Array of frames with names and JPEG data
   * @param intervalMs Frame interval in milliseconds (e.g., 50 for 20fps)
   * @param width Image width (default: 368)
   * @param height Image height (default: 368)
   * @returns Complete xV4 animation buffer ready to send
   */
  static build(
    frames: XV4Frame[],
    intervalMs: number = 50,
    width: number = 368,
    height: number = 368,
  ): Buffer {
    if (frames.length === 0) {
      throw new Error("At least one frame is required");
    }

    // Calculate frame count
    const frameCount = frames.length;

    // Total JPEG size field is it's frame_count * 1000
    const totalSizeField = frameCount * 1000;

    const totalJpegSize = frames.reduce(
      (sum, frame) => sum + frame.data.length,
      0,
    );

    // Build timing string with null terminator
    const timingStr = `output/${intervalMs}ms`;
    const timingBuffer = Buffer.from(timingStr + "\0", "utf-8");

    // Calculate frame table size (each entry: name + "." + 4-byte size)
    let frameTableSize = 0;
    for (const frame of frames) {
      frameTableSize += Buffer.from(frame.name + ".", "utf-8").length + 4;
    }

    // Footer size (from capture: 2 frame sizes + unknown + dimensions)
    const footerSize = 16;

    // Header structure:
    const headerSize =
      3 + // signature "xV4"
      1 + // version 0x12
      1 + // unknown 0x48
      3 + // padding 0x00 0x00 0x00
      4 + // frame count (u32 LE)
      4 + // total JPEG size (u32 LE)
      timingBuffer.length + // timing string with null terminator
      4; // frame data offset (u32 LE)

    // Frame data offset
    const frameDataOffsetValue = 0x2c000 + (headerSize - 8);

    // Actual container size: header + frame table + footer + JPEG data
    // (We don't actually pad to frameDataOffsetValue in our container)
    const actualDataOffset = headerSize + frameTableSize + footerSize;
    const totalSize = actualDataOffset + totalJpegSize;

    const container = Buffer.alloc(totalSize);
    let offset = 0;

    // Write signature "xV4"
    this.SIGNATURE.copy(container, offset);
    offset += 3;

    // Write version 0x12
    container.writeUInt8(this.VERSION, offset);
    offset += 1;

    // Write unknown byte 0x48
    container.writeUInt8(this.UNKNOWN_BYTE, offset);
    offset += 1;

    // Write padding (3 null bytes)
    container.writeUInt8(0x00, offset);
    offset += 1;
    container.writeUInt8(0x00, offset);
    offset += 1;
    container.writeUInt8(0x00, offset);
    offset += 1;

    // Write frame count (u32 LE)
    container.writeUInt32LE(frameCount, offset);
    offset += 4;

    // Write total size field (u32 LE) - this is frame_count * 1000
    container.writeUInt32LE(totalSizeField, offset);
    offset += 4;

    // Write timing string (null-terminated) - no null byte before it!
    timingBuffer.copy(container, offset);
    offset += timingBuffer.length;

    // Write frame data offset (u32 LE) - this is a reference value, not actual offset in our buffer
    container.writeUInt32LE(frameDataOffsetValue, offset);
    offset += 4;

    // Write frame table
    for (const frame of frames) {
      // Write frame name with trailing dot (no null terminator)
      const nameBuffer = Buffer.from(frame.name + ".", "utf-8");
      nameBuffer.copy(container, offset);
      offset += nameBuffer.length;

      // Write frame size (u32 LE)
      container.writeUInt32LE(frame.data.length, offset);
      offset += 4;
    }

    // Write footer (16 bytes)
    // First frame size
    container.writeUInt32LE(frames[0]?.data.length || 0, offset);
    offset += 4;

    // Second frame size (or first if only one frame)
    container.writeUInt32LE(
      frames[1]?.data.length || frames[0]?.data.length || 0,
      offset,
    );
    offset += 4;

    // Unknown value (from capture: seems to be related to header size)
    // In capture it was 0x0b (11) for 3 frames
    container.writeUInt32LE(frameCount + 8, offset);
    offset += 4;

    // Dimensions (u16 LE + u16 LE)
    container.writeUInt16LE(width, offset);
    offset += 2;
    container.writeUInt16LE(height, offset);
    offset += 2;

    // Now offset should be at actualDataOffset (where JPEG data actually starts in our buffer)
    if (offset !== actualDataOffset) {
      throw new Error(
        `Frame data offset calculation error: expected ${actualDataOffset}, got ${offset}`,
      );
    }

    // Write JPEG data
    for (const frame of frames) {
      frame.data.copy(container, offset);
      offset += frame.data.length;
    }

    return container;
  }

  /**
   * Validate that a buffer is a proper xV4 container
   * @param buffer Buffer to validate
   * @returns True if valid xV4 container
   */
  static validate(buffer: Buffer): boolean {
    if (buffer.length < 20) {
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

    // Check unknown byte
    if (buffer.readUInt8(4) !== this.UNKNOWN_BYTE) {
      return false;
    }

    return true;
  }
}
