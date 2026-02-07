/**
 * Packet type identifiers
 *
 * These values appear in the "type" field of JSON payloads and indicate
 * the purpose/content of the packet.
 *
 * ## Overview
 *
 * The protocol uses a BLE-based communication system where:
 * - Client sends commands/data to device via write characteristic
 * - Device responds with status messages via notify characteristic
 * - All payloads are wrapped in 8-byte headers with checksums
 *
 */
export enum PacketType {
  /**
   * 0x05: DYNAMIC_AMBIENCE (Client to Device)
   *
   * Used for ALL animated content: videos, GIFs, and image gallery mode.
   *
   * ## Upload Process (Two-Step)
   *
   * Step 1 - Send info packet (uses Type 6):
   * ```json
   * {"type":6,"number":1}
   * ```
   *
   * Step 2 - Send animation data:
   * ```json
   * {"type":5,"data":<xV4_ANIMATION_DATA>}
   * ```
   *
   * ## xV4 Animation Format
   *
   * The data payload is an xV4 container containing:
   * - 32-byte header with signature "xV4" + version 0x12
   * - Frame table with offsets to each frame's metadata
   * - Per-frame data: 32-byte metadata + JPEG data
   * - Looping: last frame's next_offset points back to first frame
   *
   * Frame requirements:
   * - Size: 360x360 pixels
   * - Format: JPEG with JFIF APP0 marker
   * - Quality: 75
   * - Chroma: 4:4:4 (no subsampling)
   *
   * For more information, go see xv4-header.ts
   *
   * ## Use Cases
   *
   * - Video upload: Extract frames from video file
   * - GIF upload: Separate animated GIF into frames
   * - Gallery/slideshow: Convert multiple images to animation with interval
   */
  DYNAMIC_AMBIENCE = 0x05,

  /**
   * 0x06: IMAGE (Client to Device)
   *
   * Used for uploading static SINGLE images to the device.
   *
   * ## Upload Process (Two-Step)
   *
   * Step 1 - Send image info:
   * ```json
   * {"type":6,"number":1}
   * ```
   * - Announces that 1 image is coming
   * - Device responds with DEVICE_STATUS (type 13)
   *
   * Step 2 - Send image data:
   * ```
   * {"type":6,"data":<IMB_HEADER><JPEG_BINARY>}
   * ```
   * - IMB header: 14 bytes (signature + size + dimensions + padding)
   * - JPEG data: Raw binary JPEG file
   * - Sent in chunks (0x1F0 (496) bytes per chunk)
   * - Device responds "GetPacketSuccess" for each chunk
   *
   * ## Image Requirements from official app
   *
   * - Size: 368x368 pixels
   * - Format: JPEG with JFIF APP0 marker
   * - Quality: 80
   * - Chroma: 4:2:0 subsampling
   *
   * ## Important Notes
   * - For multiple images: repeat the 2-step process sequentially
   * - For IMB header format, see IMBHeaderBuilder in imb-header.ts
   * - Gallery/slideshow mode uses DYNAMIC_AMBIENCE (Type 5), not this
   */
  IMAGE = 0x06,

  /**
   * 0x0C: PHOTO_ALBUM_COUNT (Client to Device)
   *
   * Would announce number of images in gallery/album mode.
   * Not used in current implementation, may be for other models.
   */
  PHOTO_ALBUM_COUNT = 0x0c,

  /**
   * 0x0D: DEVICE_STATUS (Device to Client)
   *
   * Device response containing storage and capability information.
   *
   * ## Format
   *
   * ```json
   * {
   *   "type": 13,
   *   "allspace": 16384,     // Total storage in KB
   *   "freespace": 13892,    // Free storage in KB
   *   "devname": "",         // Device name (usually empty)
   *   "size": "368,368",     // Display resolution (width,height)
   *   "brand": 0             // Brand/model identifier
   * }
   * ```
   *
   * ## When Sent
   *
   * Device sends this in response to:
   * - Image info packet (Type 6)
   * - Used to check available storage before upload
   */
  DEVICE_STATUS = 0x0d,
}
