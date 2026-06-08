import { createBluetooth } from "node-ble";
import type NodeBle from "node-ble";
import { ConnectionError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";
import type {
  BleBackend,
  BleCharacteristic,
  DiscoveredDevice,
} from "../backend.ts";

const POLL_INTERVAL_MS = 1000;

class DBusCharacteristic implements BleCharacteristic {
  private valueChangedListener: ((buffer: Buffer) => void) | null = null;

  constructor(
    private characteristic: NodeBle.GattCharacteristic,
    public readonly uuid: string,
  ) {}

  async write(data: Buffer, withoutResponse: boolean): Promise<void> {
    if (withoutResponse) {
      await this.characteristic.writeValueWithoutResponse(data);
    } else {
      await this.characteristic.writeValueWithResponse(data);
    }
  }

  async subscribe(onData: (data: Buffer) => void): Promise<void> {
    this.valueChangedListener = onData;
    this.characteristic.on("valuechanged", onData);
    await this.characteristic.startNotifications();
  }

  async unsubscribe(): Promise<void> {
    if (this.valueChangedListener) {
      this.characteristic.removeListener(
        "valuechanged",
        this.valueChangedListener,
      );
      this.valueChangedListener = null;
    }
    await this.characteristic.stopNotifications().catch(() => {});
  }
}

export class DBusBackend implements BleBackend {
  readonly name = "dbus";

  private bluetooth: NodeBle.Bluetooth | null = null;
  private destroy: (() => void) | null = null;
  private adapter: NodeBle.Adapter | null = null;
  private device: NodeBle.Device | null = null;
  private scanning = false;

  async init(): Promise<void> {
    if (this.bluetooth) {
      return;
    }

    const { bluetooth, destroy } = createBluetooth();
    this.bluetooth = bluetooth;
    this.destroy = destroy;

    try {
      this.adapter = await bluetooth.defaultAdapter();
    } catch {
      throw new ConnectionError(
        "No Bluetooth adapter found (is bluetoothd running?)",
      );
    }

    if (!(await this.adapter.isPowered())) {
      throw new ConnectionError("Bluetooth adapter is not powered on");
    }
  }

  private async ensureDiscovering(): Promise<void> {
    if (!this.adapter) {
      throw new ConnectionError("Bluetooth adapter not initialized");
    }
    if (!(await this.adapter.isDiscovering())) {
      await this.adapter.startDiscovery();
    }
    this.scanning = true;
  }

  async scanFor(
    matcher: (device: DiscoveredDevice) => boolean,
    timeoutMs: number,
  ): Promise<DiscoveredDevice | null> {
    if (!this.adapter) {
      throw new ConnectionError("Bluetooth adapter not initialized");
    }

    await this.ensureDiscovering();

    const adapter = this.adapter;

    // Keep re-checking unnamed devices on every poll instead of giving up on first sight.
    // Not sure if this is the best way to handle this.

    const named = new Map<string, string | null>();
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const addresses = await adapter.devices();

      for (const address of addresses) {
        if (named.get(address)) {
          continue;
        }

        let name: string | null = null;
        try {
          const remoteDevice = await adapter.getDevice(address);
          name = await remoteDevice.getName().catch(async () => {
            return await remoteDevice.getAlias().catch(() => null);
          });
        } catch {
          // device vanished mid-scan??
        }

        if (name && named.get(address) !== name) {
          logger.debug(`Discovered device: ${name} (${address})`);
        }
        named.set(address, name);

        const candidate: DiscoveredDevice = { address, name };
        if (matcher(candidate)) {
          await this.stopScan();
          this.device = await adapter.getDevice(address);
          return candidate;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    await this.stopScan();
    return null;
  }

  async stopScan(): Promise<void> {
    if (this.adapter && this.scanning) {
      await this.adapter.stopDiscovery().catch(() => {});
      this.scanning = false;
    }
  }

  async connect(address: string): Promise<void> {
    if (!this.adapter) {
      throw new ConnectionError("Bluetooth adapter not initialized");
    }

    if (!this.device) {
      this.device = await this.adapter.getDevice(address);
    }

    if (await this.device.isConnected().catch(() => false)) {
      await this.device.disconnect().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await this.device.connect();
  }

  onDisconnect(callback: () => void): void {
    this.device?.once("disconnect", callback);
  }

  async discoverCharacteristics(
    writeUUID: string,
    notifyUUID: string,
    normalizeUUID: (uuid: string) => string,
  ): Promise<{ write: BleCharacteristic; notify: BleCharacteristic }> {
    if (!this.device) {
      throw new ConnectionError("Not connected to device");
    }

    const gattServer = await this.device.gatt();
    const serviceUuids = await gattServer.services();

    const normalizedWriteUuid = normalizeUUID(writeUUID);
    const normalizedNotifyUuid = normalizeUUID(notifyUUID);

    let writeChar: { char: NodeBle.GattCharacteristic; uuid: string } | null =
      null;
    let notifyChar: { char: NodeBle.GattCharacteristic; uuid: string } | null =
      null;

    for (const serviceUuid of serviceUuids) {
      const service = await gattServer.getPrimaryService(serviceUuid);
      const charUuids = await service.characteristics();

      for (const charUuid of charUuids) {
        const normalizedCharUuid = normalizeUUID(charUuid);

        if (normalizedCharUuid === normalizedWriteUuid && !writeChar) {
          writeChar = {
            char: await service.getCharacteristic(charUuid),
            uuid: charUuid,
          };
        }
        if (normalizedCharUuid === normalizedNotifyUuid && !notifyChar) {
          notifyChar = {
            char: await service.getCharacteristic(charUuid),
            uuid: charUuid,
          };
        }
      }
    }

    if (!writeChar || !notifyChar) {
      throw new ConnectionError("Could not find required characteristics");
    }

    return {
      write: new DBusCharacteristic(writeChar.char, writeChar.uuid),
      notify: new DBusCharacteristic(notifyChar.char, notifyChar.uuid),
    };
  }

  async disconnect(): Promise<void> {
    try {
      await this.stopScan();

      if (this.device) {
        this.device.removeAllListeners();
        if (await this.device.isConnected().catch(() => false)) {
          await this.device.disconnect().catch(() => {});
        }
        this.device = null;
      }

      this.destroy?.();
      this.destroy = null;
      this.bluetooth = null;
      this.adapter = null;
    } catch {
      // best-effort cleanup
    }
  }
}
