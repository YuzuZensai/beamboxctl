import { EventEmitter } from "node:events";
EventEmitter.defaultMaxListeners = 20;

import type { BLEConfig, ProtocolConfig } from "../protocol/index.ts";
import { PacketType } from "../protocol/index.ts";
import { DeviceNotFoundError, ConnectionError } from "../utils/errors.ts";
import { PayloadBuilder, ResponseParser } from "../protocol/index.ts";
import { logger, LogEventType } from "../utils/logger.ts";
import type { BleBackend, BleCharacteristic } from "./backend.ts";
import { resolveBackendType } from "./backend.ts";
import { NobleBackend } from "./backends/noble-backend.ts";
import { DBusBackend } from "./backends/dbus-backend.ts";

function createBackend(): BleBackend {
  const type = resolveBackendType();
  return type === "dbus" ? new DBusBackend() : new NobleBackend();
}

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
  public expectedAckCount = 0;

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
        logger.info(
          `Device ack received: GetPacketSuccess (${this.packetSuccessCount}/${this.expectedAckCount})`,
        );
        if (
          this.waitingForAck &&
          this.notificationResolve &&
          this.packetSuccessCount >= this.expectedAckCount
        ) {
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

  public logSentPacket(packet: Buffer, description: string): void {
    if (this.verbose) {
      const timestamp = new Date().toISOString();
      logger.debug(
        `[SEND] ${timestamp} | Bytes: ${packet.length} | Hex: ${packet.toString("hex")} | ${description}`,
      );
    }
  }

  public getNotifications(): Array<{
    time: number;
    data: Buffer;
    parsed: any;
  }> {
    return this.allNotifications;
  }

  public waitForStatus(): Promise<void> {
    return new Promise((resolve) => {
      if (this.deviceStatusReceived) {
        resolve();
      } else {
        this.statusResolve = resolve;
      }
    });
  }

  public waitForNotification(): Promise<void> {
    return new Promise((resolve) => {
      this.notificationResolve = resolve;
    });
  }

  public reset(): void {
    this.notificationResolve = null;
    this.statusResolve = null;
    this.errorFlag = false;
  }

  public setExpectedAckCount(count: number): void {
    this.expectedAckCount = count;
    this.packetSuccessCount = 0;
  }
}

export class BleUploader {
  private backend: BleBackend;
  private writeCharacteristic: BleCharacteristic | null = null;
  private notifyCharacteristic: BleCharacteristic | null = null;
  private notificationHandler: NotificationHandler;
  private payloadBuilder: PayloadBuilder;
  private chunkDelay: number;
  private verbose: boolean = false;
  private isInitialized: boolean = false;
  private connectedAddress: string | null = null;
  private alreadyScanned: boolean = false;

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
    this.backend = createBackend();
    logger.debug(`Using BLE backend: ${this.backend.name}`);
  }

  private async initBluetooth(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.backend.init();
    this.isInitialized = true;
  }

  private normalizeUUID(uuid: string): string {
    const cleaned = uuid.replace(/-/g, "").toLowerCase();
    // Strip Bluetooth Base UUID wrapper: 0000XXXX-0000-1000-8000-00805f9b34fb → XXXX
    const match = cleaned.match(/^0000([0-9a-f]{4})00001000800000805f9b34fb$/);
    if (match && match[1]) return match[1];
    if (cleaned.length <= 4) return cleaned.padStart(4, "0");
    return cleaned;
  }

  public setDeviceAddress(address: string): void {
    this.deviceAddress = address;
    this.alreadyScanned = true;
  }

  public async scanForDevices(
    onDeviceFound?: (device: { name: string | null; address: string }) => void,
    signal?: AbortSignal,
  ): Promise<Array<{ name: string | null; address: string }>> {
    await this.initBluetooth();

    logger.info("Starting device scan...", LogEventType.SCAN_START);

    const targetName = this.bleConfig.deviceName.toLowerCase();
    const timeout = this.bleConfig.scanTimeout * 1000;

    const devices = await this.backend.scanForAll(
      (device) =>
        !!device.name && device.name.toLowerCase().includes(targetName),
      timeout,
      onDeviceFound,
      signal,
    );

    logger.info(
      `Scan complete, found ${devices.length} device(s)`,
      LogEventType.DEVICES_FOUND,
      { devices },
    );

    return devices;
  }

  public async findDevice(): Promise<string | null> {
    await this.initBluetooth();

    logger.info("Starting device scan...", LogEventType.SCAN_START);

    const targetName = this.bleConfig.deviceName.toLowerCase();
    const timeout = this.bleConfig.scanTimeout * 1000;

    const found = await this.backend.scanFor((device) => {
      return !!device.name && device.name.toLowerCase().includes(targetName);
    }, timeout);

    if (!found) {
      return null;
    }

    logger.info(
      `Found device: ${found.name} (${found.address})`,
      LogEventType.DEVICE_FOUND,
      { name: found.name, address: found.address },
    );

    return found.address;
  }

  /**
   * Connect to the BeamBox device and wait for device status
   * @returns True if connected successfully
   */
  public async connect(): Promise<boolean> {
    try {
      await this.initBluetooth();

      if (!this.connectedAddress) {
        if (this.alreadyScanned && this.deviceAddress) {
          logger.info(
            `Using previously scanned device: ${this.deviceAddress}`,
            LogEventType.DEVICE_FOUND,
            { address: this.deviceAddress },
          );
        } else if (!this.deviceAddress) {
          logger.info("Scanning for device...", LogEventType.SCAN_START);
          const address = await this.findDevice();
          if (!address) {
            throw new DeviceNotFoundError(
              `Could not find '${this.bleConfig.deviceName}'`,
            );
          }
          this.deviceAddress = address;
        } else {
          logger.info(
            "Scanning for device by address...",
            LogEventType.SCAN_START,
          );

          const targetAddress = this.deviceAddress.toLowerCase();
          const timeout = this.bleConfig.scanTimeout * 1000;

          const found = await this.backend.scanFor(
            (device) => device.address.toLowerCase() === targetAddress,
            timeout,
          );

          if (!found) {
            throw new DeviceNotFoundError(
              `Could not find device with address '${this.deviceAddress}'`,
            );
          }
        }
      }

      await this.backend.stopScan();

      // Connect to device
      logger.info("Connecting to device...", LogEventType.CONNECT_START);
      const connectStartTime = Date.now();

      await this.backend.connect(this.deviceAddress!);
      this.connectedAddress = this.deviceAddress;

      const connectDuration = Date.now() - connectStartTime;
      logger.info(
        `Connected to device (took ${connectDuration}ms)`,
        LogEventType.CONNECTED,
      );

      // Handle disconnect events
      this.backend.onDisconnect(() => {
        logger.info("Device disconnected");
        this.connectedAddress = null;
        this.writeCharacteristic = null;
        this.notifyCharacteristic = null;
      });

      // Discover services and characteristics
      await this.discoverCharacteristics();

      // Setup notifications
      if (this.notifyCharacteristic) {
        await this.notifyCharacteristic.subscribe((data: Buffer) => {
          this.notificationHandler.handleNotification(data);
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

      await this.disconnect();
      return false;
    }
  }

  /**
   * Discover required characteristics on the device
   */
  private async discoverCharacteristics(): Promise<void> {
    const normalizedWriteUuid = this.normalizeUUID(
      this.bleConfig.writeCharacteristicUUID,
    );
    const normalizedNotifyUuid = this.normalizeUUID(
      this.bleConfig.notifyCharacteristicUUID,
    );

    logger.debug(`Looking for write UUID: ${normalizedWriteUuid}`);
    logger.debug(`Looking for notify UUID: ${normalizedNotifyUuid}`);

    const { write, notify } = await this.backend.discoverCharacteristics(
      this.bleConfig.writeCharacteristicUUID,
      this.bleConfig.notifyCharacteristicUUID,
      (uuid) => this.normalizeUUID(uuid),
    );

    this.writeCharacteristic = write;
    this.notifyCharacteristic = notify;

    logger.debug(
      `Found write characteristic: ${write.uuid}`,
      LogEventType.DISCOVER_CHAR,
      { type: "write", uuid: write.uuid },
    );
    logger.debug(
      `Found notify characteristic: ${notify.uuid}`,
      LogEventType.DISCOVER_CHAR,
      { type: "notify", uuid: notify.uuid },
    );
  }

  /**
   * Disconnect from the device
   */
  public async disconnect(): Promise<void> {
    try {
      if (this.notifyCharacteristic) {
        await this.notifyCharacteristic.unsubscribe();
      }

      await this.backend.disconnect();
      this.connectedAddress = null;
      this.writeCharacteristic = null;
      this.notifyCharacteristic = null;
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

    // Write without response
    await this.writeCharacteristic.write(packet, true);
    await this.sleep(this.protocolConfig.imageInfoDelay * 1000);
  }

  /**
   * Send image data packets to device with batched acknowledgment waiting
   * @param fullData Complete image data payload
   * @param packetType Packet type for header
   * @param onProgress Progress callback with (sendProgress 0-100, confirmProgress 0-100, status)
   * @returns True if successful
   */
  public async sendData(
    fullData: Buffer,
    packetType: PacketType,
    onProgress?: (
      sendProgress: number,
      confirmProgress: number,
      status?: string,
    ) => void,
  ): Promise<boolean> {
    if (!this.writeCharacteristic) {
      throw new ConnectionError("BLE client not connected");
    }

    const totalSize = fullData.length;
    const chunkSize = this.protocolConfig.chunkSize;
    const totalChunks = Math.ceil(totalSize / chunkSize);
    const batchSize = 10; // Send 10 packets then wait for acks

    // Set expected acknowledgment count before sending
    this.notificationHandler.setExpectedAckCount(totalChunks);

    logger.info(
      `Starting data transfer: ${totalChunks} packets in batches of ${batchSize}`,
      LogEventType.DATA_SEND_START,
      { totalChunks, totalSize, batchSize },
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
        packetType,
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

      // Write without response
      await this.writeCharacteristic.write(packet, true);

      if (this.notificationHandler.errorFlag) {
        logger.error("Device error flag set; aborting send.");
        return false;
      }

      // Report progress
      if (onProgress) {
        const sendProgress = ((i + 1) / totalChunks) * 100;
        const confirmProgress =
          (this.notificationHandler.packetSuccessCount / totalChunks) * 100;
        onProgress(
          sendProgress,
          confirmProgress,
          `Sending: (${i + 1}/${totalChunks} packets)`,
        );
      }

      await this.sleep(this.chunkDelay * 1000);

      // Wait for acks every batchSize packets or at the end
      if ((i + 1) % batchSize === 0 || i === totalChunks - 1) {
        const expectedAcksAtThisPoint = i + 1;
        const ackTimeout = 5.0; // 5 seconds to wait for batch acks
        const startTime = Date.now();

        logger.info(`Waiting for acknowledgments up to packet ${i + 1}...`);

        while (
          this.notificationHandler.packetSuccessCount < expectedAcksAtThisPoint
        ) {
          if ((Date.now() - startTime) / 1000 > ackTimeout) {
            logger.warning(
              `Ack timeout: expected ${expectedAcksAtThisPoint}, received ${this.notificationHandler.packetSuccessCount}`,
            );
            break;
          }

          if (onProgress) {
            const sendProgress = ((i + 1) / totalChunks) * 100;
            const confirmProgress =
              (this.notificationHandler.packetSuccessCount / totalChunks) * 100;
            onProgress(
              sendProgress,
              confirmProgress,
              `Sending: (${this.notificationHandler.packetSuccessCount}/${totalChunks} packets)`,
            );
          }

          await this.sleep(100);
        }
      }
    }

    logger.info("Data transfer complete", LogEventType.DATA_SEND_COMPLETE);

    return !this.notificationHandler.errorFlag;
  }

  /**
   * Wait for all remaining device acknowledgments after upload
   * @param onProgress Optional progress callback
   * @returns True if all acks received without error
   */
  public async waitForResponse(
    onProgress?: (
      sendProgress: number,
      confirmProgress: number,
      status?: string,
    ) => void,
  ): Promise<boolean> {
    this.notificationHandler.waitingForAck = true;

    // Dynamic timeout: 0.1s per expected packet, minimum 5s, maximum 30s
    const dynamicTimeout = Math.min(
      Math.max(this.notificationHandler.expectedAckCount * 0.1, 5.0),
      30.0,
    );

    logger.info(
      `Waiting for final acknowledgments (${this.notificationHandler.packetSuccessCount}/${this.notificationHandler.expectedAckCount}), timeout: ${dynamicTimeout.toFixed(1)}s`,
    );

    const startTime = Date.now();

    while (
      this.notificationHandler.packetSuccessCount <
      this.notificationHandler.expectedAckCount
    ) {
      if ((Date.now() - startTime) / 1000 > dynamicTimeout) {
        logger.warning(
          `Timeout waiting for acks: received ${this.notificationHandler.packetSuccessCount}/${this.notificationHandler.expectedAckCount}`,
        );
        break;
      }

      if (onProgress) {
        const confirmProgress =
          (this.notificationHandler.packetSuccessCount /
            this.notificationHandler.expectedAckCount) *
          100;
        onProgress(
          100,
          confirmProgress,
          `Confirming: (${this.notificationHandler.packetSuccessCount}/${this.notificationHandler.expectedAckCount} packets)`,
        );
      }

      await this.sleep(100); // Check every 100ms
    }

    const success =
      !this.notificationHandler.errorFlag &&
      this.notificationHandler.packetSuccessCount >=
        this.notificationHandler.expectedAckCount;

    if (success) {
      logger.info("All acknowledgments received");
      if (onProgress) {
        onProgress(100, 100, "Upload complete");
      }
    } else if (
      this.notificationHandler.packetSuccessCount <
      this.notificationHandler.expectedAckCount
    ) {
      logger.warning(
        `Incomplete acknowledgments: received ${this.notificationHandler.packetSuccessCount}/${this.notificationHandler.expectedAckCount}`,
      );
    }

    this.notificationHandler.waitingForAck = false;
    this.notificationHandler.reset();

    return success;
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
