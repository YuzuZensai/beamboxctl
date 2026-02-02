import { useState, useEffect, useCallback, useRef } from "react";
import { BeamBoxUploader } from "../lib/core/beambox-uploader.ts";
import { logger, LogEventType } from "../lib/utils/logger.ts";
import type { DeviceStatus, ParsedResponse } from "../lib/protocol/interfaces/index.ts";
import type { ConnectionStep } from "../components/index.ts";
import { updateStepStatus } from "../utils/app-utils.ts";
import type { StatusOptions } from "../cli/types.ts";

export function useDeviceStatus(options: StatusOptions) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null);
  const [notifications, setNotifications] = useState<
    Array<{ time: number; data: Buffer; parsed: ParsedResponse }>
  >([]);
  const [connectionSteps, setConnectionSteps] = useState<ConnectionStep[]>([
    { id: "scan", label: "Scanning for device", status: "pending" },
    { id: "connect", label: "Connecting to device", status: "pending" },
    { id: "discover", label: "Discovering characteristics", status: "pending" },
    {
      id: "wait-status",
      label: "Waiting for device status",
      status: "pending",
    },
    {
      id: "notifications",
      label: "Collecting notifications",
      status: "pending",
    },
  ]);
  const hasCalledGetStatus = useRef(false);

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
            updateStepStatus(prev, "wait-status", "complete", "notifications"),
          );
          setTimeout(() => {
            setConnectionSteps((prev) =>
              updateStepStatus(prev, "notifications", "complete"),
            );
          }, 100);
          break;
      }
    });

    return unsubscribe;
  }, []);

  const getStatus = useCallback(async () => {
    let uploader: BeamBoxUploader | null = null;

    try {
      uploader = new BeamBoxUploader(
        options.address,
        undefined,
        undefined,
        undefined,
        undefined,
        options.verbose,
      );

      const result = await uploader.getStatus(10000);

      setDeviceStatus(result.status as DeviceStatus | null);
      setNotifications(result.notifications);
      setLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);

      setConnectionSteps((prev) => {
        const firstPending = prev.find(
          (s) => s.status === "pending" || s.status === "active",
        );
        if (firstPending) {
          return prev.map((step) =>
            step.id === firstPending.id
              ? { ...step, status: "error", error: "Failed" }
              : step,
          );
        }
        return prev;
      });

      setLoading(false);
    }
  }, [options]);

  useEffect(() => {
    if (!hasCalledGetStatus.current) {
      hasCalledGetStatus.current = true;
      getStatus();
    }
  }, [getStatus]);

  return {
    loading,
    error,
    deviceStatus,
    notifications,
    connectionSteps,
  };
}
