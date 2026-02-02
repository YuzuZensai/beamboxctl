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
   * Used for ALL animated content: videos, GIFs, and image gallery mode
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
   * ## Animation Data Format
   *
   * The data payload contains:
   * TODO: Validate this format more thoroughly
   * - Signature: "xV4" (0x78 0x56 0x34), custom animation format?
   * - Frame timing: "output/50ms" interval between frames
   * - Frame references: "frame_00001", "frame_00002", etc.
   * - Multiple JPEG frames embedded in single payload
   *
   * ## How Content is Converted to Animation
   *
   * TODO: Implement using ffmpeg to extract frames and build xV4 format?
   *
   * ```bash
   * # Get video info
   * ffprobe -v quiet -show_entries format=duration -of csv=p=0 input.mp4
   * ffprobe -v quiet -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 input.mp4
   *
   * # Extract frames
   * ffmpeg -i input.mp4 output/frame_%05d.jpg
   * ```
   *
   * ## Use Cases
   *
   * - Video upload: Extract frames from video file
   * - GIF upload: Separate animated GIF into frames
   * - Gallery/slideshow Mode: Convert multiple images to animation with interval (the official app does this)
   *
   * TODO: Full implementation pending
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
   * TODO: Validate if "number" means image count
   * - Announces that 1 image is coming? (Always observed as 1, even for multiple images, so might be something else)
   * - Device responds with DEVICE_STATUS (type 13)
   *
   * Step 2 - Send image data:
   * ```
   * {"type":6,"data":<IMB_HEADER><JPEG_BINARY>}
   * ```
   * - IMB header: 36 bytes (contains size, dimensions)
   * - JPEG data: Raw binary JPEG file
   * - Sent in chunks (0x1F0 (496) bytes per chunk)
   * - Device responds "GetPacketSuccess" for each chunk
   *
   * ## Important Notes
   * - For multiple images: repeat the 2-step process sequentially
   * - For IMB header format, see IMBHeaderBuilder in src/lib/protocol/imb-header.ts
   * - Gallery/slideshow mode on the official app does NOT use this, uses DYNAMIC_AMBIENCE (Type 5) and preprocessing instead
   *
   * The official app's "Image Gallery" feature works by:
   * 1. Converting multiple images into animation using FFmpeg
   * 2. Creating frame sequence: frame_00001.jpg, frame_00002.jpg, etc.
   * 3. Sending as Type 5 (DYNAMIC_AMBIENCE) with embedded timing
   *
   */
  IMAGE = 0x06,

  /**
   * 0x0C: PHOTO_ALBUM_COUNT (Client to Device)
   *
   * Would announce number of images in gallery/album mode??
   * TODO: Does not seem to be used or might be used on another model, needs further investigation
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
   * - Image info packet (Type)
   * - Used to check available storage before upload
   *
   */
  DEVICE_STATUS = 0x0d,
}
