import { EventEmitter } from "node:events";

EventEmitter.defaultMaxListeners = 20;

import { createBluetooth } from "node-ble";
import type { BLEConfig, ProtocolConfig } from "../protocol/index.ts";
import {
  PacketType,
  PayloadBuilder,
  ResponseParser,
} from "../protocol/index.ts";
import { ConnectionError, DeviceNotFoundError } from "../utils/errors.ts";
import { LogEventType, logger } from "../utils/logger.ts";

/**
 * Handles notifications from the BeamBox device
 */
class NotificationHandler {
  waitingForAck = false;
  packetSuccessCount = 0;
  errorFlag = false;
  lastNotification: Record<string, unknown> | null = null;

  deviceStatus: Record<string, unknown> | null = null;
  deviceReady = false;
  deviceStatusReceived = false;
  allNotifications: Array<{ time: number; data: Buffer; parsed: any }> = [];

  private notificationResolve: (() => void) | null = null;
  private statusResolve: (() => void) | null = null;

  constructor(private verbose: boolean = false) {}

  /**
   * Handle incoming notification data from device
   * @param data Notification data buffer
   */
  public handleNotification(data: Buffer): void {
    try {
      const response = ResponseParser.parse(data);

      // Verbose mode logging
      if (this.verbose) {
        const timestamp = new Date().toISOString();
        this.allNotifications.push({
          time: Date.now(),
          data,
          parsed: response,
        });
        logger.debug(
          `[RECV] ${timestamp} | Bytes: ${data.length} | Hex: ${data.toString("hex")} | Text: ${response.rawText || "(empty)"}`,
        );
        if (response.jsonData) {
          logger.debug(`[RECV] JSON: ${JSON.stringify(response.jsonData)}`);
        }
      }

      if (!response.rawText) {
        return;
      }

      if (ResponseParser.isSuccess(response)) {
        this.packetSuccessCount++;
        logger.info("Device ack received: GetPacketSuccess");
        if (this.waitingForAck && this.notificationResolve) {
          this.notificationResolve();
          this.notificationResolve = null;
        }
        return;
      }

      if (ResponseParser.isFail(response)) {
        logger.warning(`Device reported packet fail: ${response.rawText}`);
        if (this.notificationResolve) {
          this.notificationResolve();
          this.notificationResolve = null;
        }
        return;
      }

      if (ResponseParser.isError(response)) {
        this.errorFlag = true;
        logger.error("Device error flag reported: 1111111111");
        if (this.notificationResolve) {
          this.notificationResolve();
          this.notificationResolve = null;
        }
        return;
      }

      // Handle JSON responses
      if (response.jsonData) {
        this.lastNotification = response.jsonData;

        // Handle PacketType.DEVICE_STATUS messages
        if (response.isStatus) {
          this.deviceStatus = response.jsonData;
          this.deviceReady = true;

          // Only resolve the first time we get status
          if (!this.deviceStatusReceived) {
            this.deviceStatusReceived = true;
            logger.info(
              `Device status received: ${JSON.stringify(response.jsonData)}`,
              LogEventType.STATUS_RECEIVED,
              response.jsonData,
            );
          } else {
            logger.debug("Duplicate status notification, ignoring");
          }

          if (this.statusResolve) {
            this.statusResolve();
            this.statusResolve = null;
          }
        } else {
          logger.debug(
            `Device notification payload: ${JSON.stringify(response.jsonData)}`,
          );
        }

        if (this.notificationResolve) {
          this.notificationResolve();
          this.notificationResolve = null;
        }
        return;
      }

      // Fallback: print raw text if we couldn't parse anything
      logger.debug(`Device notification text: ${response.rawText}`);
      if (this.notificationResolve) {
        this.notificationResolve();
        this.notificationResolve = null;
      }
    } catch (error) {
      logger.error(`Error handling notification: ${error}`);
    }
  }

  /**
   * Log sent packet in verbose mode
   * @param packet Sent packet buffer
   * @param description Description of the packet
   */
  public logSentPacket(packet: Buffer, description: string): void {
    if (this.verbose) {
      const timestamp = new Date().toISOString();
      logger.debug(
        `[SEND] ${timestamp} | Bytes: ${packet.length} | Hex: ${packet.toString("hex")} | ${description}`,
      );
    }
  }

  /**
   * Get all received notifications
   * @returns Array of notifications with timestamp, data, and parsed content
   */
  public getNotifications(): Array<{
    time: number;
    data: Buffer;
    parsed: any;
  }> {
    return this.allNotifications;
  }

  /**
   * Wait for device status to be received
   * @returns Promise that resolves when status is received
   */
  public waitForStatus(): Promise<void> {
    return new Promise((resolve) => {
      if (this.deviceStatusReceived) {
        resolve();
      } else {
        this.statusResolve = resolve;
      }
    });
  }

  /**
   * Wait for any notification from device
   * @returns Promise that resolves when a notification is received
   */
  public waitForNotification(): Promise<void> {
    return new Promise((resolve) => {
      this.notificationResolve = resolve;
    });
  }

  /**
   * Reset internal state
   */
  public reset(): void {
    this.notificationResolve = null;
    this.statusResolve = null;
    this.errorFlag = false;
  }
}

/**
 * Manages BLE connection and data transfer to BeamBox device
 */
export class BleUploader {
  private bluetooth: any;
  private adapter: any;
  private device: any;
  private gattServer: any;
  private writeCharacteristic: any;
  private notifyCharacteristic: any;
  private notificationHandler: NotificationHandler;
  private payloadBuilder: PayloadBuilder;
  private chunkDelay: number;
  private verbose: boolean = false;

  constructor(
    private deviceAddress: string | null,
    chunkDelay: number | null,
    private bleConfig: BLEConfig,
    private protocolConfig: ProtocolConfig,
    verbose: boolean = false,
  ) {
    this.chunkDelay = chunkDelay ?? protocolConfig.packetDelay;
    this.verbose = verbose;
    this.notificationHandler = new NotificationHandler(verbose);
    this.payloadBuilder = new PayloadBuilder(protocolConfig);
  }

  /**
   * Initialize Bluetooth adapter
   */
  private async initBluetooth(): Promise<void> {
    const { bluetooth, destroy } = createBluetooth();
    this.bluetooth = { bluetooth, destroy };
    this.adapter = await bluetooth.defaultAdapter();

    const isPowered = await this.adapter.isPowered();
    if (!isPowered) {
      throw new ConnectionError("Bluetooth adapter is not powered on");
    }
  }

  /**
   * Scan for the BeamBox device
   * @returns Device address or null if not found
   */
  public async findDevice(): Promise<string | null> {
    if (!this.adapter) {
      await this.initBluetooth();
    }

    logger.info("Starting device scan...", LogEventType.SCAN_START);

    // Start discovery
    if (!(await this.adapter.isDiscovering())) {
      await this.adapter.startDiscovery();
    }

    const startTime = Date.now();
    const timeout = this.bleConfig.scanTimeout * 1000;

    while (Date.now() - startTime < timeout) {
      const devices = await this.adapter.devices();

      for (const deviceAddr of devices) {
        const device = await this.adapter.getDevice(deviceAddr);
        const name = await device.getName().catch(() => null);

        if (
          name &&
          name.toLowerCase().includes(this.bleConfig.deviceName.toLowerCase())
        ) {
          await this.adapter.stopDiscovery();
          logger.info(
            `Found device: ${name} (${deviceAddr})`,
            LogEventType.DEVICE_FOUND,
            { name, address: deviceAddr },
          );
          return deviceAddr;
        }
      }

      await this.sleep(500);
    }

    await this.adapter.stopDiscovery();
    return null;
  }

  /**
   * Connect to the BeamBox device and wait for device status
   * @returns True if connected successfully
   */
  public async connect(): Promise<boolean> {
    try {
      await this.initBluetooth();

      if (!this.deviceAddress) {
        logger.info("Scanning for device...", LogEventType.SCAN_START);
        this.deviceAddress = await this.findDevice();
        if (!this.deviceAddress) {
          throw new DeviceNotFoundError(
            `Could not find '${this.bleConfig.deviceName}'`,
          );
        }
      }

      // Get device
      this.device = await this.adapter.getDevice(this.deviceAddress);

      // Connect to device
      logger.info("Connecting to device...", LogEventType.CONNECT_START);
      await this.device.connect();
      logger.info("Connected to device", LogEventType.CONNECTED);

      // Get GATT server
      this.gattServer = await this.device.gatt();

      // Find the service and characteristics
      await this.discoverCharacteristics();

      // Setup notifications
      if (this.notifyCharacteristic) {
        await this.notifyCharacteristic.startNotifications();

        // Listen for value changes
        this.notifyCharacteristic.on("valuechanged", (buffer: Buffer) => {
          this.notificationHandler.handleNotification(buffer);
        });
      }

      // Wait for device status (PacketType.DEVICE_STATUS) to be received
      logger.info("Waiting for device status...", LogEventType.STATUS_WAIT);
      const statusPromise = this.notificationHandler.waitForStatus();
      const timeoutPromise = this.sleep(5000);

      await Promise.race([statusPromise, timeoutPromise]);

      if (this.notificationHandler.deviceReady) {
        logger.info("Device status received", LogEventType.STATUS_RECEIVED);
      } else {
        logger.warning(
          "Device status not received within timeout, proceeding anyway",
        );
      }

      return true;
    } catch (error) {
      logger.error(`Connection error: ${error}`);
      return false;
    }
  }

  /**
   * Discover required characteristics on the device
   */
  private async discoverCharacteristics(): Promise<void> {
    // Get all services
    const services = await this.gattServer.services();

    for (const serviceUuid of services) {
      const service = await this.gattServer.getPrimaryService(serviceUuid);
      const characteristics = await service.characteristics();

      for (const charUuid of characteristics) {
        const char = await service.getCharacteristic(charUuid);

        // Match normalized UUIDs
        const normalizedCharUuid = charUuid.replace(/-/g, "").toLowerCase();
        const normalizedWriteUuid = this.bleConfig.writeCharacteristicUUID
          .replace(/-/g, "")
          .toLowerCase();
        const normalizedNotifyUuid = this.bleConfig.notifyCharacteristicUUID
          .replace(/-/g, "")
          .toLowerCase();

        if (normalizedCharUuid === normalizedWriteUuid) {
          this.writeCharacteristic = char;
          logger.debug(
            `Found write characteristic: ${charUuid}`,
            LogEventType.DISCOVER_CHAR,
            { type: "write", uuid: charUuid },
          );
        }
        if (normalizedCharUuid === normalizedNotifyUuid) {
          this.notifyCharacteristic = char;
          logger.debug(
            `Found notify characteristic: ${charUuid}`,
            LogEventType.DISCOVER_CHAR,
            { type: "notify", uuid: charUuid },
          );
        }
      }
    }

    if (!this.writeCharacteristic || !this.notifyCharacteristic) {
      throw new ConnectionError("Could not find required characteristics");
    }
  }

  /**
   * Disconnect from the device
   */
  public async disconnect(): Promise<void> {
    try {
      if (this.device) {
        await this.device.disconnect();
      }
      if (this.bluetooth) {
        this.bluetooth.destroy();
      }
    } catch (error) {
      logger.warning(`Error during disconnect: ${error}`);
    }
  }

  /**
   * Send image info packet to device
   * Tells device how many images to expect
   * @param payload Image info payload bytes (e.g., {"type":6,"number":1})
   */
  public async sendImageInfo(payload: Buffer): Promise<void> {
    if (!this.writeCharacteristic) {
      throw new ConnectionError("BLE client not connected");
    }

    if (!this.notificationHandler.deviceReady) {
      logger.warning("Device status not received, but proceeding with upload");
    }

    const packet = this.payloadBuilder.createPacket(
      payload,
      0,
      0,
      PacketType.IMAGE,
    );

    logger.debug(
      `Sending image info packet (type ${PacketType.IMAGE}): ${payload.length} bytes`,
      LogEventType.IMAGE_INFO_SEND,
      { size: payload.length },
    );

    if (this.verbose) {
      const imageInfoHex = packet.toString("hex");
      logger.debug(
        `Full image info packet hex (${packet.length} bytes): ${imageInfoHex}`,
      );
    }

    this.notificationHandler.logSentPacket(packet, "Image info packet");

    await this.writeCharacteristic.writeValue(packet, { type: "command" });
    await this.sleep(this.protocolConfig.imageInfoDelay * 1000);
  }

  /**
   * Send image data packets to device
   * @param fullData Complete image data payload
   * @returns True if successful
   */
  public async sendData(
    fullData: Buffer,
    onProgress?: (progress: number) => void,
  ): Promise<boolean> {
    if (!this.writeCharacteristic) {
      throw new ConnectionError("BLE client not connected");
    }

    const totalSize = fullData.length;
    const chunkSize = this.protocolConfig.chunkSize;
    const totalChunks = Math.ceil(totalSize / chunkSize);

    logger.info(
      `Starting data transfer: ${totalChunks} packets`,
      LogEventType.DATA_SEND_START,
      { totalChunks, totalSize },
    );

    if (this.verbose) {
      const firstChunkPreview = fullData
        .subarray(0, Math.min(64, fullData.length))
        .toString("hex");
      logger.debug(`First 64 bytes of payload: ${firstChunkPreview}`);
    }

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalSize);
      const chunk = fullData.subarray(start, end);

      const remainingPackets = totalChunks - 1 - i;

      const packet = this.payloadBuilder.createPacket(
        chunk,
        totalChunks,
        remainingPackets,
        this.protocolConfig.cmdSubtype,
      );

      logger.info(
        `Sending packet ${i + 1}/${totalChunks} (remaining=${remainingPackets}, bytes=${chunk.length})`,
        LogEventType.DATA_SEND_PROGRESS,
        { current: i + 1, total: totalChunks, remaining: remainingPackets },
      );

      if (this.verbose) {
        this.notificationHandler.logSentPacket(
          packet,
          `Data packet ${i + 1}/${totalChunks}`,
        );

        if (i === 0) {
          const headerHex = packet.subarray(0, 8).toString("hex");
          const checksumHex = packet[packet.length - 1]
            ?.toString(16)
            .padStart(2, "0");
          logger.debug(`First packet header: ${headerHex}`);
          logger.debug(`First packet checksum: ${checksumHex}`);
        }
      }

      await this.writeCharacteristic.writeValue(packet, { type: "command" });

      if (this.notificationHandler.errorFlag) {
        logger.error("Device error flag set; aborting send.");
        return false;
      }

      // Report progress
      if (onProgress) {
        const progress = ((i + 1) / totalChunks) * 100;
        onProgress(progress);
      }

      await this.sleep(this.chunkDelay * 1000);
    }

    logger.info("Data transfer complete", LogEventType.DATA_SEND_COMPLETE);

    return !this.notificationHandler.errorFlag;
  }

  /**
   * Wait for device response after upload
   * @param timeout Timeout in seconds
   * @returns True if response received without error
   */
  public async waitForResponse(timeout: number = 5.0): Promise<boolean> {
    const responsePromise = this.notificationHandler.waitForNotification();
    const timeoutPromise = this.sleep(timeout * 1000);

    await Promise.race([responsePromise, timeoutPromise]);
    this.notificationHandler.reset();

    return !this.notificationHandler.errorFlag;
  }

  public hasError(): boolean {
    return this.notificationHandler.errorFlag;
  }

  public isDeviceReady(): boolean {
    return this.notificationHandler.deviceReady;
  }

  public getDeviceStatus(): Record<string, unknown> | null {
    return this.notificationHandler.deviceStatus;
  }

  public getNotifications(): Array<{
    time: number;
    data: Buffer;
    parsed: any;
  }> {
    return this.notificationHandler.getNotifications();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
