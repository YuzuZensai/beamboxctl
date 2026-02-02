/**
 * IMB (Image Binary) header builder
 *
 * The IMB header is exactly 36 bytes and contains information about the image:
 * - Signature: 'IMB' (3 bytes)
 * - Null byte: 0x00 (1 byte)
 * - Header size: 36 (4 bytes, little-endian)
 * - Total size: JPEG size + 36 (4 bytes, little-endian)
 * - Format: 11 (1 byte) + 0x00 (1 byte)
 * - Reserved: 0x0000 (2 bytes, little-endian)
 * - Width: image width (2 bytes, little-endian)
 * - Height: image height (2 bytes, little-endian)
 * - Header size repeat: 36 (4 bytes, little-endian)
 * - JPEG size: size of JPEG data (4 bytes, little-endian)
 * - Reserved: 0x00000000 0x00000000 (8 bytes, little-endian)
 */

export class IMBHeaderBuilder {
  private static readonly HEADER_SIZE = 36;
  private static readonly FORMAT_VALUE = 11;
  private static readonly SIGNATURE = Buffer.from("IMB");

  /**
   * Build a 36-byte IMB header for image data
   * @param jpegSize Size of the JPEG data in bytes
   * @param width Image width in pixels
   * @param height Image height in pixels
   * @returns 36 bytes of IMB header data
   */
  static build(jpegSize: number, width: number, height: number): Buffer {
    const header = Buffer.alloc(this.HEADER_SIZE);
    let offset = 0;

    // 1. IMB signature (3 bytes)
    this.SIGNATURE.copy(header, offset);
    offset += 3;

    // 2. One zero byte (1 byte)
    header.writeUInt8(0x00, offset);
    offset += 1;

    // 3. Header size: 36 as int32_LE (4 bytes)
    header.writeUInt32LE(this.HEADER_SIZE, offset);
    offset += 4;

    // 4. Total size: jpegSize + 36 as int32_LE (4 bytes)
    const totalSize = jpegSize + this.HEADER_SIZE;
    header.writeUInt32LE(totalSize, offset);
    offset += 4;

    // 5. Format: 11 (1 byte) + zero byte (1 byte)
    header.writeUInt8(this.FORMAT_VALUE, offset);
    offset += 1;
    header.writeUInt8(0x00, offset);
    offset += 1;

    // 6. Reserved: zero as int16_LE (2 bytes)
    header.writeUInt16LE(0, offset);
    offset += 2;

    // 7. Width as int16_LE (2 bytes)
    header.writeUInt16LE(width, offset);
    offset += 2;

    // 8. Height as int16_LE (2 bytes)
    header.writeUInt16LE(height, offset);
    offset += 2;

    // 9. Header size repeat: 36 as int32_LE (4 bytes)
    header.writeUInt32LE(this.HEADER_SIZE, offset);
    offset += 4;

    // 10. JPEG size as int32_LE (4 bytes)
    header.writeUInt32LE(jpegSize, offset);
    offset += 4;

    // 11. Reserved: two zero int32_LE values (8 bytes)
    header.writeUInt32LE(0, offset);
    offset += 4;
    header.writeUInt32LE(0, offset);
    offset += 4;

    if (header.length !== this.HEADER_SIZE) {
      throw new Error(
        `IMB header must be exactly ${this.HEADER_SIZE} bytes, got ${header.length}`,
      );
    }

    return header;
  }

  /**
   * Validate that a header is a proper IMB header
   * @param header Header bytes to validate
   * @returns True if valid IMB header
   */
  static validate(header: Buffer): boolean {
    if (header.length !== this.HEADER_SIZE) {
      return false;
    }

    // Check signature
    if (!header.subarray(0, 3).equals(this.SIGNATURE)) {
      return false;
    }

    // Check null byte
    if (header.readUInt8(3) !== 0) {
      return false;
    }

    // Check header size fields
    const headerSize1 = header.readUInt32LE(4);
    const headerSize2 = header.readUInt32LE(20);

    if (headerSize1 !== this.HEADER_SIZE || headerSize2 !== this.HEADER_SIZE) {
      return false;
    }

    return true;
  }
}
