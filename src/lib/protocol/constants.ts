/**
 * Command type byte used in packet headers (0xF1)
 *
 * This identifies the BeamBox protocol to the device.
 * As observed, all packets sent to the device must start with this command type.
 */
export const CMD_TYPE = 0xf1;

/**
 * Size of the packet header in bytes (8 bytes)
 *
 */
export const HEADER_SIZE = 8;

/**
 * Size of the checksum/trailer in bytes (1 byte)
 *
 * Appended to end of every packet for data integrity verification.
 */
export const CHECKSUM_SIZE = 1;
