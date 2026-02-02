/**
 * Base error class for all BeamBox-related errors
 */
export class BeamBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeamBoxError";
    Object.setPrototypeOf(this, BeamBoxError.prototype);
  }
}

/**
 * Error thrown when a device cannot be found or accessed
 */
export class DeviceNotFoundError extends BeamBoxError {
  constructor(message: string = "Device not found") {
    super(message);
    this.name = "DeviceNotFoundError";
    Object.setPrototypeOf(this, DeviceNotFoundError.prototype);
  }
}

/**
 * Error thrown when a connection to the device fails
 */
export class ConnectionError extends BeamBoxError {
  constructor(message: string = "Connection failed") {
    super(message);
    this.name = "ConnectionError";
    Object.setPrototypeOf(this, ConnectionError.prototype);
  }
}

/**
 * Error thrown when image processing operations fail
 */
export class ImageProcessingError extends BeamBoxError {
  constructor(message: string) {
    super(message);
    this.name = "ImageProcessingError";
    Object.setPrototypeOf(this, ImageProcessingError.prototype);
  }
}

/**
 * Error thrown when uploading data to the device fails
 */
export class UploadError extends BeamBoxError {
  constructor(message: string) {
    super(message);
    this.name = "UploadError";
    Object.setPrototypeOf(this, UploadError.prototype);
  }
}

/**
 * Error thrown when the device returns an unexpected or invalid response
 */
export class DeviceResponseError extends BeamBoxError {
  constructor(message: string) {
    super(message);
    this.name = "DeviceResponseError";
    Object.setPrototypeOf(this, DeviceResponseError.prototype);
  }
}
