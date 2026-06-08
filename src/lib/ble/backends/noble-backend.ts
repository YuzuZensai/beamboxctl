import noble from "@stoprocent/noble";
import type { Peripheral, Characteristic } from "@stoprocent/noble";
import { ConnectionError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";
import type {
  BleBackend,
  BleCharacteristic,
  DiscoveredDevice,
} from "../backend.ts";

class NobleCharacteristic implements BleCharacteristic {
  constructor(private characteristic: Characteristic) {}

  get uuid(): string {
    return this.characteristic.uuid;
  }

  async write(data: Buffer, withoutResponse: boolean): Promise<void> {
    await this.characteristic.writeAsync(data, withoutResponse);
  }

  async subscribe(onData: (data: Buffer) => void): Promise<void> {
    await this.characteristic.subscribeAsync();
    this.characteristic.on("data", onData);
  }

  async unsubscribe(): Promise<void> {
    this.characteristic.removeAllListeners();
    await this.characteristic.unsubscribeAsync().catch(() => {});
  }
}

export class NobleBackend implements BleBackend {
  readonly name = "noble";

  private peripheral: Peripheral | null = null;
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new ConnectionError("Bluetooth adapter initialization timeout"));
      }, 10000);

      const checkState = (state: string) => {
        if (state === "poweredOn") {
          clearTimeout(timeout);
          this.initialized = true;
          resolve();
        } else if (state === "poweredOff") {
          clearTimeout(timeout);
          reject(new ConnectionError("Bluetooth adapter is not powered on"));
        } else if (state === "unsupported") {
          clearTimeout(timeout);
          reject(
            new ConnectionError("Bluetooth is not supported on this device"),
          );
        } else if (state === "unauthorized") {
          clearTimeout(timeout);
          reject(new ConnectionError("Bluetooth access not authorized"));
        }
      };

      if ((noble as any).state === "poweredOn") {
        clearTimeout(timeout);
        this.initialized = true;
        resolve();
        return;
      }

      noble.on("stateChange", checkState);
    });
  }

  async scanFor(
    matcher: (device: DiscoveredDevice) => boolean,
    timeoutMs: number,
  ): Promise<DiscoveredDevice | null> {
    return new Promise((resolve) => {
      let found = false;

      const timeoutId = setTimeout(async () => {
        if (!found) {
          await this.stopScan();
          noble.removeListener("discover", onDiscover);
          resolve(null);
        }
      }, timeoutMs);

      const onDiscover = async (peripheral: Peripheral) => {
        const device: DiscoveredDevice = {
          address: peripheral.address || peripheral.id,
          name: peripheral.advertisement.localName ?? null,
        };

        logger.debug(
          `Discovered device: ${device.name ?? "(unnamed)"} (${device.address})`,
        );

        if (matcher(device)) {
          found = true;
          clearTimeout(timeoutId);
          await this.stopScan();
          noble.removeListener("discover", onDiscover);
          this.peripheral = peripheral;
          resolve(device);
        }
      };

      noble.on("discover", onDiscover);

      noble.startScanningAsync([], false).catch((err: Error) => {
        clearTimeout(timeoutId);
        noble.removeListener("discover", onDiscover);
        resolve(null);
      });
    });
  }

  async stopScan(): Promise<void> {
    await noble.stopScanningAsync().catch(() => {});
  }

  async connect(address: string): Promise<void> {
    if (!this.peripheral) {
      throw new ConnectionError(`No discovered peripheral for ${address}`);
    }

    if (
      this.peripheral.state === "connected" ||
      this.peripheral.state === "connecting"
    ) {
      await this.peripheral.disconnectAsync().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await this.peripheral.connectAsync();
  }

  onDisconnect(callback: () => void): void {
    this.peripheral?.once("disconnect", callback);
  }

  async discoverCharacteristics(
    writeUUID: string,
    notifyUUID: string,
    normalizeUUID: (uuid: string) => string,
  ): Promise<{ write: BleCharacteristic; notify: BleCharacteristic }> {
    if (!this.peripheral) {
      throw new ConnectionError("Not connected to device");
    }

    const { services } =
      await this.peripheral.discoverAllServicesAndCharacteristicsAsync();

    const normalizedWriteUuid = normalizeUUID(writeUUID);
    const normalizedNotifyUuid = normalizeUUID(notifyUUID);

    let writeChar: Characteristic | null = null;
    let notifyChar: Characteristic | null = null;

    for (const service of services) {
      for (const char of service.characteristics) {
        const normalizedCharUuid = normalizeUUID(char.uuid);
        if (normalizedCharUuid === normalizedWriteUuid) {
          writeChar = char;
        }
        if (normalizedCharUuid === normalizedNotifyUuid) {
          notifyChar = char;
        }
      }
    }

    if (!writeChar || !notifyChar) {
      throw new ConnectionError("Could not find required characteristics");
    }

    return {
      write: new NobleCharacteristic(writeChar),
      notify: new NobleCharacteristic(notifyChar),
    };
  }

  async disconnect(): Promise<void> {
    try {
      if (this.peripheral) {
        this.peripheral.removeAllListeners();
        await this.peripheral.disconnectAsync().catch(() => {});
        this.peripheral = null;
      }

      noble.removeAllListeners();
      await noble.stopScanningAsync().catch(() => {});
    } catch {
      // best-effort cleanup
    }
  }
}
