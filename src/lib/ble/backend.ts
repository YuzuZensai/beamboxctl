export interface DiscoveredDevice {
  address: string;
  name: string | null;
}

export interface BleCharacteristic {
  uuid: string;
  write(data: Buffer, withoutResponse: boolean): Promise<void>;
  subscribe(onData: (data: Buffer) => void): Promise<void>;
  unsubscribe(): Promise<void>;
}

export interface BleBackend {
  readonly name: string;

  init(): Promise<void>;

  scanFor(
    matcher: (device: DiscoveredDevice) => boolean,
    timeoutMs: number,
  ): Promise<DiscoveredDevice | null>;

  stopScan(): Promise<void>;

  connect(address: string): Promise<void>;

  onDisconnect(callback: () => void): void;

  discoverCharacteristics(
    writeUUID: string,
    notifyUUID: string,
    normalizeUUID: (uuid: string) => string,
  ): Promise<{ write: BleCharacteristic; notify: BleCharacteristic }>;

  disconnect(): Promise<void>;
}

export type BleBackendType = "noble" | "dbus";

/**
 * Uses dbus on Linux and noble on other platforms.
 * You can override with BEAMBOXCTL_BLE_BACKEND=noble|dbus.
 */
export function resolveBackendType(): BleBackendType {
  const override = process.env.BEAMBOXCTL_BLE_BACKEND?.toLowerCase().trim();
  if (override === "noble" || override === "dbus") {
    return override;
  }

  return process.platform === "linux" ? "dbus" : "noble";
}
