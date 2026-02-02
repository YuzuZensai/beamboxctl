import { describe, test, expect } from "bun:test";
import {
  BeamBoxError,
  DeviceNotFoundError,
  ConnectionError,
  ImageProcessingError,
  UploadError,
  DeviceResponseError,
} from "./errors.ts";

describe("Error Classes", () => {
  describe("error hierarchy", () => {
    test("BeamBoxError extends Error", () => {
      const error = new BeamBoxError("test");
      expect(error instanceof Error).toBe(true);
    });

    test("all custom errors extend BeamBoxError", () => {
      expect(new DeviceNotFoundError() instanceof BeamBoxError).toBe(true);
      expect(new ConnectionError() instanceof BeamBoxError).toBe(true);
      expect(new ImageProcessingError("test") instanceof BeamBoxError).toBe(true);
      expect(new UploadError("test") instanceof BeamBoxError).toBe(true);
      expect(new DeviceResponseError("test") instanceof BeamBoxError).toBe(true);
    });

    test("instanceof works correctly", () => {
      const error = new DeviceNotFoundError();
      expect(error instanceof DeviceNotFoundError).toBe(true);
      expect(error instanceof BeamBoxError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("error names", () => {
    test("BeamBoxError.name === 'BeamBoxError'", () => {
      const error = new BeamBoxError("test");
      expect(error.name).toBe("BeamBoxError");
    });

    test("DeviceNotFoundError.name === 'DeviceNotFoundError'", () => {
      const error = new DeviceNotFoundError();
      expect(error.name).toBe("DeviceNotFoundError");
    });

    test("ConnectionError.name === 'ConnectionError'", () => {
      const error = new ConnectionError();
      expect(error.name).toBe("ConnectionError");
    });

    test("ImageProcessingError.name === 'ImageProcessingError'", () => {
      const error = new ImageProcessingError("test");
      expect(error.name).toBe("ImageProcessingError");
    });

    test("UploadError.name === 'UploadError'", () => {
      const error = new UploadError("test");
      expect(error.name).toBe("UploadError");
    });

    test("DeviceResponseError.name === 'DeviceResponseError'", () => {
      const error = new DeviceResponseError("test");
      expect(error.name).toBe("DeviceResponseError");
    });
  });

  describe("default messages", () => {
    test("DeviceNotFoundError default: 'Device not found'", () => {
      const error = new DeviceNotFoundError();
      expect(error.message).toBe("Device not found");
    });

    test("ConnectionError default: 'Connection failed'", () => {
      const error = new ConnectionError();
      expect(error.message).toBe("Connection failed");
    });
  });

  describe("custom messages", () => {
    test("BeamBoxError accepts custom message", () => {
      const error = new BeamBoxError("custom error");
      expect(error.message).toBe("custom error");
    });

    test("DeviceNotFoundError accepts custom message", () => {
      const error = new DeviceNotFoundError("specific device not found");
      expect(error.message).toBe("specific device not found");
    });

    test("ConnectionError accepts custom message", () => {
      const error = new ConnectionError("timeout connecting");
      expect(error.message).toBe("timeout connecting");
    });

    test("ImageProcessingError requires message", () => {
      const error = new ImageProcessingError("failed to resize");
      expect(error.message).toBe("failed to resize");
    });

    test("UploadError requires message", () => {
      const error = new UploadError("upload interrupted");
      expect(error.message).toBe("upload interrupted");
    });

    test("DeviceResponseError requires message", () => {
      const error = new DeviceResponseError("invalid response");
      expect(error.message).toBe("invalid response");
    });
  });

  describe("error throwing and catching", () => {
    test("can throw and catch BeamBoxError", () => {
      expect(() => {
        throw new BeamBoxError("test");
      }).toThrow(BeamBoxError);
    });

    test("can catch specific error type", () => {
      try {
        throw new DeviceNotFoundError("custom");
      } catch (e) {
        expect(e instanceof DeviceNotFoundError).toBe(true);
        expect((e as DeviceNotFoundError).message).toBe("custom");
      }
    });

    test("can catch as base BeamBoxError", () => {
      try {
        throw new ImageProcessingError("test");
      } catch (e) {
        if (e instanceof BeamBoxError) {
          expect(e.message).toBe("test");
        } else {
          throw new Error("Should be BeamBoxError");
        }
      }
    });

    test("can catch as Error", () => {
      try {
        throw new UploadError("test");
      } catch (e) {
        expect(e instanceof Error).toBe(true);
      }
    });
  });
});
