import { useState, useEffect, useCallback } from "react";
import { BeamBoxUploader } from "../lib/core/beambox-uploader.ts";
import { logger, LogEventType } from "../lib/utils/logger.ts";
import { BeamBoxError } from "../lib/utils/errors.ts";
import type { ConnectionStep } from "../components/index.ts";
import { basename } from "node:path";
import { updateStepStatus } from "../utils/app-utils.ts";
import type { UploadOptions } from "../cli/types.ts";

export function useUpload(options: UploadOptions, verbose: boolean) {
  const [status, setStatus] = useState<
    "connecting" | "uploading" | "success" | "error"
  >("connecting");
  const [message, setMessage] = useState<string>("Initializing...");
  const [progress, setProgress] = useState<number>(0);
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(0);
  const [totalFiles, setTotalFiles] = useState<number>(1);

  const [uploadSteps, setUploadSteps] = useState<ConnectionStep[]>([
    { id: "image-info", label: "Sending image info", status: "pending" },
    { id: "data", label: "Transferring image data", status: "pending" },
    { id: "complete", label: "Finalizing", status: "pending" },
  ]);

  const [connectionSteps, setConnectionSteps] = useState<ConnectionStep[]>([
    { id: "scan", label: "Scanning for device", status: "pending" },
    { id: "connect", label: "Connecting to device", status: "pending" },
    { id: "discover", label: "Discovering characteristics", status: "pending" },
    {
      id: "wait-status",
      label: "Waiting for device status",
      status: "pending",
    },
  ]);

  useEffect(() => {
    const unsubscribe = logger.onLog((entry) => {
      const eventType = entry.eventType;

      switch (eventType) {
        case LogEventType.SCAN_START:
          setConnectionSteps((prev) =>
            updateStepStatus(prev, "scan", "active"),
          );
          break;

        case LogEventType.DEVICE_FOUND:
          setConnectionSteps((prev) =>
            updateStepStatus(prev, "scan", "complete", "connect"),
          );
          break;

        case LogEventType.CONNECT_START:
          setConnectionSteps((prev) =>
            updateStepStatus(prev, "connect", "active"),
          );
          break;

        case LogEventType.CONNECTED:
          setConnectionSteps((prev) =>
            updateStepStatus(prev, "connect", "complete", "discover"),
          );
          break;

        case LogEventType.DISCOVER_CHAR:
          setConnectionSteps((prev) =>
            updateStepStatus(prev, "discover", "complete", "wait-status"),
          );
          break;

        case LogEventType.STATUS_WAIT:
          setConnectionSteps((prev) =>
            updateStepStatus(prev, "wait-status", "active"),
          );
          break;

        case LogEventType.STATUS_RECEIVED:
          setConnectionSteps((prev) =>
            updateStepStatus(prev, "wait-status", "complete"),
          );
          break;

        case LogEventType.IMAGE_INFO_SEND:
          setUploadSteps((prev) =>
            updateStepStatus(prev, "image-info", "active"),
          );
          break;

        case LogEventType.DATA_SEND_START:
          setUploadSteps((prev) =>
            updateStepStatus(prev, "image-info", "complete", "data"),
          );
          break;

        case LogEventType.DATA_SEND_COMPLETE:
          setUploadSteps((prev) =>
            updateStepStatus(prev, "data", "complete", "complete"),
          );
          break;
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const runUpload = async () => {
      let uploader: BeamBoxUploader | null = null;

      try {
        const [width, height] = options.size.split("x").map(Number);
        const targetSize: [number, number] = [width!, height!];
        const packetDelaySeconds = options.packetDelay / 1000.0;

        const isBulk =
          options.isBulk && options.images && options.images.length > 1;
        const imagesToUpload = isBulk ? options.images! : [];

        if (isBulk) {
          setTotalFiles(imagesToUpload.length);
        }

        uploader = new BeamBoxUploader(
          options.address,
          packetDelaySeconds,
          undefined,
          undefined,
          undefined,
          verbose,
        );

        setStatus("connecting");
        setMessage("Connecting to BeamBox device...");

        const connected = await uploader.connect();
        if (!connected) {
          throw new Error("Failed to connect to device");
        }

        setMessage("Connected successfully!");
        await new Promise((resolve) => setTimeout(resolve, 500));

        setStatus("uploading");

        if (isBulk) {
          for (let i = 0; i < imagesToUpload.length; i++) {
            const imagePath = imagesToUpload[i];
            if (!imagePath) continue;

            const fileName = basename(imagePath);

            setCurrentFileIndex(i + 1);
            setMessage(
              `Uploading ${i + 1}/${imagesToUpload.length}: ${fileName}`,
            );

            setUploadSteps([
              {
                id: "image-info",
                label: "Sending image info",
                status: "pending",
              },
              {
                id: "data",
                label: "Transferring image data",
                status: "pending",
              },
              { id: "complete", label: "Finalizing", status: "pending" },
            ]);
            setProgress(0);

            const success = await uploader.uploadImageFromFile(
              imagePath,
              targetSize,
              (prog) => setProgress(prog),
            );

            if (!success) {
              throw new Error(`Failed to upload ${fileName}`);
            }

            setUploadSteps((prev) =>
              updateStepStatus(prev, "complete", "complete"),
            );

            if (i < imagesToUpload.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));
          setStatus("success");
          setMessage(
            `All ${imagesToUpload.length} images uploaded successfully!`,
          );
        } else {
          setMessage("Preparing upload...");

          let success: boolean;
          if (options.test) {
            setMessage("Uploading image...");
            success = await uploader.uploadCheckerboard(targetSize, 8, (prog) =>
              setProgress(prog),
            );
          } else if (options.image) {
            setMessage("Uploading image...");
            success = await uploader.uploadImageFromFile(
              options.image,
              targetSize,
              (prog) => setProgress(prog),
            );
          } else {
            throw new Error("No image provided");
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));

          if (success) {
            setUploadSteps((prev) =>
              updateStepStatus(prev, "complete", "complete"),
            );
            setStatus("success");
            setMessage("Upload completed successfully!");
          } else {
            setStatus("error");
            setMessage("Upload failed");
          }
        }
      } catch (error) {
        setStatus("error");
        if (error instanceof BeamBoxError) {
          setMessage(`Upload failed: ${error.message}`);
        } else {
          setMessage(`Upload failed: ${error}`);
        }
      } finally {
        if (uploader) {
          await uploader.disconnect();
        }
      }
    };

    runUpload();
  }, [options, verbose]);

  return {
    status,
    message,
    progress,
    currentFileIndex,
    totalFiles,
    uploadSteps,
    connectionSteps,
  };
}
