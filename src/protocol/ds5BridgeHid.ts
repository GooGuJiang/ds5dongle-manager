import { invoke } from "@tauri-apps/api/core";
import {
  ConfigBody,
  ConfigDecodeError,
  FEATURE_REPORT_PAYLOAD_SIZE,
  decodeConfigBody,
  encodeConfigBody,
} from "./config";

export const SONY_VENDOR_ID = 0x054c;
export const DUALSENSE_PRODUCT_ID = 0x0ce6;
export const DUALSENSE_EDGE_PRODUCT_ID = 0x0df2;
export const SUPPORTED_PRODUCT_IDS = [DUALSENSE_PRODUCT_ID, DUALSENSE_EDGE_PRODUCT_ID] as const;
export const NO_DEVICE_SELECTED_ERROR = "noDeviceSelected";
export const WEBHID_UNAVAILABLE_ERROR = "webHidUnavailable";

const REPORT_SET_CONFIG = 0xf6;
const REPORT_GET_CONFIG = 0xf7;
const REPORT_GET_FIRMWARE_VERSION = 0xf8;
const REPORT_GET_SIGNAL_STRENGTH = 0xf9;
const REPORT_COMMAND = 0x80;
const REPORT_RESULT = 0x81;
const CMD_UPDATE_CONFIG = 0x01;
const CMD_SAVE_TO_FLASH = 0x02;
const CMD_RECONNECT_USB = 0x03;
const DEVICE_SYSTEM = 0x01;
const ACTION_READ_SERIAL_NUMBER = 0x13;
const SERIAL_NUMBER_SIZE = 32;
const FEATURE_REPORT_DEFAULT_PAYLOAD_SIZE = FEATURE_REPORT_PAYLOAD_SIZE;
const FEATURE_REPORT_CHECKSUM_SIZE = 4;
const FEATURE_REPORT_CHECKSUM_PREFIX = 0x53;
const deviceSessionKeyByPath = new Map<string, string>();
let nextDeviceSessionId = 1;

export interface TauriHidDeviceInfo {
  path: string;
  vendorId: number;
  productId: number;
  serialNumber?: string | null;
  manufacturerString?: string | null;
  productName?: string | null;
  releaseNumber?: number;
  interfaceNumber?: number;
  usagePage?: number;
  usage?: number;
}

class TauriHidDevice extends EventTarget {
  opened = false;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly serialNumber?: string;
  readonly collections: HIDCollectionInfo[] = [];

  constructor(readonly info: TauriHidDeviceInfo) {
    super();
    this.vendorId = info.vendorId;
    this.productId = info.productId;
    this.productName = info.productName || "DS5 Bridge";
    this.serialNumber = info.serialNumber || undefined;
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  async sendFeatureReport(reportId: number, data: BufferSource): Promise<void> {
    const bytes = data instanceof DataView
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    try {
      await invoke("ds5_send_feature_report", { path: this.info.path, reportId, data: Array.from(bytes) });
    } catch (cause) {
      this.opened = false;
      throw cause;
    }
  }

  async receiveFeatureReport(reportId: number, length = FEATURE_REPORT_PAYLOAD_SIZE + 1): Promise<DataView> {
    try {
      const bytes = await invoke<number[]>("ds5_read_feature_report", {
        path: this.info.path,
        reportId,
        length,
      });
      return bytesToDataView(bytes);
    } catch (cause) {
      this.opened = false;
      throw cause;
    }
  }

  async readInputReport(timeoutMs: number, length = 64): Promise<DataView | null> {
    try {
      const bytes = await invoke<number[] | null>("ds5_read_input_report", {
        path: this.info.path,
        timeoutMs,
        length,
      });
      return bytes ? bytesToDataView(bytes) : null;
    } catch (cause) {
      this.opened = false;
      throw cause;
    }
  }
}

export class Ds5BridgeHidClient {
  private readonly tauriDevice: TauriHidDevice;

  constructor(public readonly device: HIDDevice) {
    this.tauriDevice = device as unknown as TauriHidDevice;
  }

  static isSupportedDevice(device: HIDDevice): boolean {
    return device.vendorId === SONY_VENDOR_ID && SUPPORTED_PRODUCT_IDS.includes(device.productId as 0x0ce6 | 0x0df2);
  }

  static async requestDevice(): Promise<Ds5BridgeHidClient> {
    const devices = await Ds5BridgeHidClient.authorizedDevices();
    const device = devices.find(Ds5BridgeHidClient.isSupportedDevice);
    if (!device) {
      throw new Error(NO_DEVICE_SELECTED_ERROR);
    }

    return new Ds5BridgeHidClient(device);
  }

  static async authorizedDevices(): Promise<HIDDevice[]> {
    const devices = await invoke<TauriHidDeviceInfo[]>("ds5_list_devices");
    return tauriDeviceInfosToHidDevices(devices);
  }

  static devicePath(device: HIDDevice): string | null {
    return (device as unknown as TauriHidDevice).info?.path ?? null;
  }

  async open(): Promise<void> {
    if (!this.tauriDevice.opened) {
      await this.tauriDevice.open();
    }
  }

  async close(): Promise<void> {
    if (this.tauriDevice.opened) {
      await this.tauriDevice.close();
    }
  }

  async readConfig(): Promise<ConfigBody> {
    await this.open();
    const report = await this.tauriDevice.receiveFeatureReport(REPORT_GET_CONFIG);
    debugFeatureReport("readConfig receive", REPORT_GET_CONFIG, report);
    try {
      const config = decodeConfigBody(report);
      debugConfig("readConfig decoded", config);
      return config;
    } catch (cause) {
      if (cause instanceof ConfigDecodeError) {
        debugConfigDecodeError(cause);
      }

      throw cause;
    }
  }

  async applyConfig(config: ConfigBody): Promise<void> {
    await this.open();
    const body = encodeConfigBody(config);
    const report = commandReport(CMD_UPDATE_CONFIG);
    report.set(body, 1);
    await this.tauriDevice.sendFeatureReport(REPORT_SET_CONFIG, report);
  }

  async readFirmwareVersion(): Promise<string> {
    await this.open();
    const report = await this.tauriDevice.receiveFeatureReport(REPORT_GET_FIRMWARE_VERSION);
    debugFeatureReport("readFirmwareVersion receive", REPORT_GET_FIRMWARE_VERSION, report);
    return decodeNullTerminatedText(featureReportPayload(report, REPORT_GET_FIRMWARE_VERSION)) || "--";
  }

  async readSignalStrength(): Promise<number | null> {
    await this.open();
    const report = await this.tauriDevice.receiveFeatureReport(REPORT_GET_SIGNAL_STRENGTH);
    debugFeatureReport("readSignalStrength receive", REPORT_GET_SIGNAL_STRENGTH, report);
    const payload = featureReportPayload(report, REPORT_GET_SIGNAL_STRENGTH);
    return payload.byteLength > 0 ? payload.getInt8(0) : null;
  }

  async readBatteryText(timeoutMs: number): Promise<string | null> {
    await this.open();
    const report = await this.tauriDevice.readInputReport(timeoutMs);
    return report ? parseDualSenseBatteryText(report) : null;
  }

  async saveToFlash(): Promise<void> {
    await this.open();
    await this.tauriDevice.sendFeatureReport(REPORT_SET_CONFIG, commandReport(CMD_SAVE_TO_FLASH));
  }

  async reconnectUsb(): Promise<void> {
    await this.open();
    await this.tauriDevice.sendFeatureReport(REPORT_SET_CONFIG, commandReport(CMD_RECONNECT_USB));
    this.tauriDevice.opened = false;
  }

  async readSerialNumber(): Promise<string> {
    await this.open();

    const reportLength = FEATURE_REPORT_DEFAULT_PAYLOAD_SIZE;
    const payload = new Uint8Array(new ArrayBuffer(reportLength));
    payload[0] = DEVICE_SYSTEM;
    payload[1] = ACTION_READ_SERIAL_NUMBER;

    if (isBluetoothFeatureReport(reportLength)) {
      fillFeatureReportChecksum(REPORT_COMMAND, payload);
    }

    await this.tauriDevice.sendFeatureReport(REPORT_COMMAND, payload);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const report = await this.tauriDevice.receiveFeatureReport(REPORT_RESULT);

      if (isSerialNumberResult(report)) {
        return decodeSerialNumber(new DataView(report.buffer, report.byteOffset + 4, SERIAL_NUMBER_SIZE));
      }

      await sleep(10);
    }

    return this.device.serialNumber || "--";
  }
}

export async function startDeviceMonitor(): Promise<void> {
  await invoke("ds5_start_device_monitor");
}

export function tauriDeviceInfosToHidDevices(devices: TauriHidDeviceInfo[]): HIDDevice[] {
  return devices.map((device) => new TauriHidDevice(device) as unknown as HIDDevice);
}

export function webHidAvailable(): boolean {
  return true;
}

export function getDeviceLabel(device: HIDDevice | null): string {
  if (!device) {
    return "No device";
  }

  const productId = device.productId.toString(16).padStart(4, "0").toUpperCase();
  const serialNumber = device.serialNumber?.trim();
  const descriptorSummary = getDeviceDescriptorSummary(device);
  return `${device.productName || "DS5 Bridge"} · 054C:${productId}${serialNumber ? ` · ${serialNumber}` : ""}${descriptorSummary ? ` · ${descriptorSummary}` : ""}`;
}

export function getDeviceKey(device: HIDDevice): string {
  const path = (device as unknown as TauriHidDevice).info?.path;
  if (path) {
    const cachedKey = deviceSessionKeyByPath.get(path);
    if (cachedKey) {
      return cachedKey;
    }
    const key = device.serialNumber?.trim() ? `serial:${device.vendorId}:${device.productId}:${device.serialNumber}` : `path:${path}`;
    deviceSessionKeyByPath.set(path, key);
    return key;
  }

  return `session:${nextDeviceSessionId++}`;
}

export function getDevicePortKey(device: HIDDevice): string {
  const info = (device as unknown as TauriHidDevice).info;
  const path = info?.path.toLowerCase();
  if (!path) {
    return getDeviceKey(device);
  }

  const usbInstance = path.match(/vid_[0-9a-f]{4}&pid_[0-9a-f]{4}[^#]*/)?.[0];
  const normalizedInstance = usbInstance?.replace(/&mi_[0-9a-f]{2}.*/, "");
  if (normalizedInstance) {
    return `usb:${device.vendorId}:${device.productId}:${normalizedInstance}`;
  }

  return `path:${path.replace(/&col\d+/, "")}`;
}

export function getControllerIconSrc(device: HIDDevice | null): string {
  return device?.productId === DUALSENSE_EDGE_PRODUCT_ID ? "/images/ps5-controller-edge.webp" : "/svg/ps5-controller-gamepad-seeklogo.svg";
}

function commandReport(command: number): Uint8Array<ArrayBuffer> {
  const report = new Uint8Array(new ArrayBuffer(FEATURE_REPORT_PAYLOAD_SIZE));
  report[0] = command;
  return report;
}

function getDeviceDescriptorSummary(device: HIDDevice): string {
  const info = (device as unknown as TauriHidDevice).info;
  return info?.interfaceNumber !== undefined ? `interface ${info.interfaceNumber}` : "";
}

function isBluetoothFeatureReport(reportLength: number): boolean {
  return reportLength > FEATURE_REPORT_DEFAULT_PAYLOAD_SIZE;
}

function isSerialNumberResult(report: DataView): boolean {
  return (
    report.byteLength >= SERIAL_NUMBER_SIZE + 4 &&
    report.getUint8(0) === REPORT_RESULT &&
    report.getUint8(1) === DEVICE_SYSTEM &&
    report.getUint8(2) === ACTION_READ_SERIAL_NUMBER
  );
}

function featureReportPayload(report: DataView, reportId: number): DataView {
  if (report.byteLength > 0 && report.getUint8(0) === reportId) {
    return new DataView(report.buffer, report.byteOffset + 1, report.byteLength - 1);
  }

  return report;
}

function decodeSerialNumber(data: DataView): string {
  return new TextDecoder("shift_jis").decode(data).replace(/\0/g, "").trim();
}

function decodeNullTerminatedText(data: DataView): string {
  return new TextDecoder().decode(data).replace(/\0/g, "").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function fillFeatureReportChecksum(reportId: number, reportData: Uint8Array): void {
  if (reportData.byteLength <= FEATURE_REPORT_CHECKSUM_SIZE) {
    return;
  }

  const body = new DataView(reportData.buffer, reportData.byteOffset, reportData.byteLength - FEATURE_REPORT_CHECKSUM_SIZE);
  const crc = crc32([FEATURE_REPORT_CHECKSUM_PREFIX, reportId], body);

  reportData[reportData.byteLength - 4] = crc & 0xff;
  reportData[reportData.byteLength - 3] = (crc >>> 8) & 0xff;
  reportData[reportData.byteLength - 2] = (crc >>> 16) & 0xff;
  reportData[reportData.byteLength - 1] = (crc >>> 24) & 0xff;
}

function crc32(prefixBytes: number[], dataView: DataView): number {
  let crc = -1 >>> 0;

  for (const byte of prefixBytes) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }

  for (let i = 0; i < dataView.byteLength; ++i) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ dataView.getUint8(i)) & 0xff];
  }

  return (crc ^ -1) >>> 0;
}

function makeCrcTable(): number[] {
  const table: number[] = [];

  for (let n = 0; n < 256; ++n) {
    let c = n;

    for (let k = 0; k < 8; ++k) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }

    table[n] = c >>> 0;
  }

  return table;
}

const crcTable = makeCrcTable();

function bytesToDataView(bytes: number[]): DataView {
  const buffer = new Uint8Array(bytes).buffer;
  return new DataView(buffer);
}

function parseDualSenseBatteryText(report: DataView): string | null {
  const reportId = report.byteLength > 0 ? report.getUint8(0) : 0;
  const status0Offset = reportId === 0x31 ? 54 : 53;
  if (report.byteLength <= status0Offset) {
    return null;
  }

  const status0 = report.getUint8(status0Offset);
  const chargeStatus = (status0 & 0xf0) >> 4;
  let level = status0 & 0x0f;

  if (chargeStatus === 2) {
    level = 10;
  }

  if (level >= 10) {
    return "100%";
  }

  if (level >= 0) {
    return `${Math.min(level * 10 + 5, 100)}%`;
  }

  return null;
}

function debugFeatureReport(label: string, reportId: number, data: DataView): void {
  if (!import.meta.env.DEV) {
    return;
  }

  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  console.info(`[DS5 Bridge HID] ${label}`, {
    reportId: `0x${reportId.toString(16).padStart(2, "0")}`,
    byteLength: data.byteLength,
    hex: bytesToHex(bytes),
  });
}

function debugConfig(label: string, config: ConfigBody): void {
  if (!import.meta.env.DEV) {
    return;
  }

  console.info(`[DS5 Bridge HID] ${label}`, config);
}

function debugConfigDecodeError(error: ConfigDecodeError): void {
  if (!import.meta.env.DEV) {
    return;
  }

  console.warn("[DS5 Bridge HID] readConfig decode failed", error.values);
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}
