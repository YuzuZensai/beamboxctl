import { useState, useRef } from "react";
import type { DiscoveredDevice } from "../components/index.ts";

export function useDeviceScanner() {
  const [scannedDevices, setScannedDevices] = useState<DiscoveredDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const selectResolveRef = useRef<((device: DiscoveredDevice) => void) | null>(
    null,
  );

  const onDeviceSelected = (device: DiscoveredDevice) => {
    selectResolveRef.current?.(device);
    selectResolveRef.current = null;
  };

  const scanAndSelect = async (uploader: {
    scanForDevices: (
      cb: (d: DiscoveredDevice) => void,
      signal: AbortSignal,
    ) => Promise<DiscoveredDevice[]>;
    setDeviceAddress: (a: string) => void;
  }): Promise<DiscoveredDevice | null> => {
    const scanAbort = new AbortController();

    const selectionPromise = new Promise<DiscoveredDevice>((resolve) => {
      selectResolveRef.current = resolve;
    });

    setScanning(true);

    const scanPromise = uploader.scanForDevices((device) => {
      setScannedDevices((prev) => {
        if (prev.some((d) => d.address === device.address)) return prev;
        return [...prev, device];
      });
    }, scanAbort.signal);

    const chosen = await Promise.race([
      selectionPromise.then((device) => {
        scanAbort.abort();
        return device;
      }),
      scanPromise.then((devices) => {
        setScanning(false);
        if (devices.length === 0) return null;
        if (devices.length === 1) return devices[0]!;
        return selectionPromise;
      }),
    ]);

    setScanning(false);
    selectResolveRef.current = null;

    if (chosen) {
      uploader.setDeviceAddress(chosen.address);
    }

    return chosen;
  };

  return { scannedDevices, scanning, onDeviceSelected, scanAndSelect };
}
