import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import {
  ConfigBody,
  ConfigDecodeError,
  DEFAULT_CONFIG,
  ConfigValidationIssue,
  configsEqual,
  normalizeConfig,
  validateConfig,
} from "../protocol/config";
import {
  Ds5BridgeHidClient,
  NO_DEVICE_SELECTED_ERROR,
  TauriHidDeviceInfo,
  WEBHID_UNAVAILABLE_ERROR,
  getDeviceLabel,
  getDeviceKey,
  startDeviceMonitor,
  tauriDeviceInfosToHidDevices,
  webHidAvailable,
} from "../protocol/ds5BridgeHid";

type Operation = "connecting" | "reading" | "applying" | "saving" | "reconnecting" | null;
type SaveState = "idle" | "dirty" | "applied" | "saved";
type UsbEffectiveConfig = Pick<ConfigBody, "pollingRateMode" | "controllerMode">;
const BATTERY_REFRESH_INTERVAL_MS = 15_000;
const DEVICE_DISCOVERY_INTERVAL_MS = 2_000;
const PICO_INFO_REFRESH_INTERVAL_MS = 5_000;
const BATTERY_LISTEN_TIMEOUT_MS = 1_200;
const LOW_BATTERY_THRESHOLD_PERCENT = 15;

export interface UseDs5BridgeResult {
  supported: boolean;
  client: Ds5BridgeHidClient | null;
  deviceLabel: string;
  deviceSerialNumber: string;
  batteryText: string;
  firmwareVersion: string;
  signalStrength: string;
  authorizedDeviceSerialNumber: Record<string, string>;
  authorizedDeviceBatteryText: Record<string, string>;
  authorizedDeviceFirmwareVersion: Record<string, string>;
  authorizedDeviceSignalStrength: Record<string, string>;
  authorizedDevices: HIDDevice[];
  config: ConfigBody | null;
  draft: ConfigBody;
  issues: ConfigValidationIssue[];
  saveState: SaveState;
  operation: Operation;
  error: string | null;
  statusText: string;
  shouldReturnHome: boolean;
  shouldReturnHomeRef: RefObject<boolean>;
  isConnected: boolean;
  isDirty: boolean;
  isDefaultConfig: boolean;
  needsUsbReconnect: boolean;
  lowBatteryNotificationEnabled: boolean;
  setDraftField: <Key extends keyof ConfigBody>(field: Key, value: ConfigBody[Key]) => void;
  setLowBatteryNotificationEnabled: (enabled: boolean) => Promise<void>;
  testLowBatteryNotification: () => Promise<void>;
  refreshAuthorizedDevices: () => Promise<void>;
  connect: () => Promise<void>;
  connectAuthorized: (device: HIDDevice) => Promise<void>;
  readConfig: () => Promise<void>;
  saveToFlash: () => Promise<void>;
  reconnectUsb: () => Promise<void>;
  resetToDefaults: () => Promise<void>;
  clearReturnHome: () => void;
  clearError: () => void;
}

export function useDs5Bridge(): UseDs5BridgeResult {
  const { t, i18n } = useTranslation();
  const supported = webHidAvailable();
  const [client, setClient] = useState<Ds5BridgeHidClient | null>(null);
  const [authorizedDevices, setAuthorizedDevices] = useState<HIDDevice[]>([]);
  const [config, setConfig] = useState<ConfigBody | null>(null);
  const [draft, setDraft] = useState<ConfigBody>(DEFAULT_CONFIG);
  const [operation, setOperation] = useState<Operation>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsUsbReconnect, setNeedsUsbReconnect] = useState(false);
  const [lowBatteryNotificationEnabled, setLowBatteryNotificationEnabledState] = useState(true);
  const [shouldReturnHome, setShouldReturnHome] = useState(false);
  const shouldReturnHomeRef = useRef(false);
  const [batteryText, setBatteryText] = useState("--");
  const [firmwareVersion, setFirmwareVersion] = useState("--");
  const [signalStrength, setSignalStrength] = useState("--");
  const [deviceSerialNumber, setDeviceSerialNumber] = useState("--");
  const [authorizedDeviceSerialNumber, setAuthorizedDeviceSerialNumber] = useState<Record<string, string>>({});
  const [authorizedDeviceBatteryText, setAuthorizedDeviceBatteryText] = useState<Record<string, string>>({});
  const [authorizedDeviceFirmwareVersion, setAuthorizedDeviceFirmwareVersion] = useState<Record<string, string>>({});
  const [authorizedDeviceSignalStrength, setAuthorizedDeviceSignalStrength] = useState<Record<string, string>>({});
  const [settledStatusText, setSettledStatusText] = useState(t("status.ready"));
  const clientRef = useRef<Ds5BridgeHidClient | null>(null);
  const configRef = useRef<ConfigBody | null>(null);
  const draftRef = useRef<ConfigBody>(DEFAULT_CONFIG);
  const usbEffectiveConfigRef = useRef<UsbEffectiveConfig | null>(null);
  const applyingRef = useRef(false);
  const applyQueuedRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const savedStatusTimerRef = useRef<number | null>(null);
  const expectedUsbDisconnectRef = useRef(false);
  const requireManualSelectionRef = useRef(false);
  const autoConnectDeviceKeyRef = useRef<string | null>(null);
  const authorizedDeviceInfoScanIdRef = useRef(0);
  const pendingChangedFieldsRef = useRef<Set<keyof ConfigBody>>(new Set());
  const lowBatteryNotificationEnabledRef = useRef(true);
  const lowBatteryNotifiedKeyRef = useRef<Set<string>>(new Set());

  const issues = useMemo(() => validateConfig(draft), [draft]);
  const isConnected = Boolean(client?.device.opened);
  const isDirty = !configsEqual(config, draft);
  const isDefaultConfig = configsEqual(draft, DEFAULT_CONFIG);
  const deviceLabel = getDeviceLabel(client?.device ?? null);

  const statusText = useMemo(() => {
    if (!supported) {
      return t("status.webHidUnavailable");
    }
    if (operation) {
      return operationLabel(operation, t);
    }
    if (!client) {
      return t("status.ready");
    }
    if (saveState === "applied") {
      return t("status.applied");
    }
    if (saveState === "saved") {
      return t("status.saved");
    }
    return t("status.connected");
  }, [client, operation, saveState, supported, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledStatusText(statusText), 120);
    return () => window.clearTimeout(timer);
  }, [statusText]);

  const refreshAuthorizedDevices = useCallback(async () => {
    if (!supported) {
      setAuthorizedDevices([]);
      return;
    }

    setAuthorizedDevices(await Ds5BridgeHidClient.authorizedDevices());
  }, [supported]);

  const scanAuthorizedDeviceInfo = useCallback(async (devices: HIDDevice[]) => {
    const scanId = authorizedDeviceInfoScanIdRef.current + 1;
    authorizedDeviceInfoScanIdRef.current = scanId;

    const entries = await Promise.all(
      devices.map(async (device) => {
        if (clientRef.current?.device === device) {
          return [getDeviceKey(device), { batteryText, serialNumber: deviceSerialNumber, firmwareVersion, signalStrength }] as const;
        }

        const nextClient = new Ds5BridgeHidClient(device);
        try {
          const [nextBatteryText, nextSerialNumber, nextFirmwareVersion, nextSignalStrength] = await Promise.all([
            nextClient.readBatteryText(900).catch(() => null),
            nextClient.readSerialNumber().catch(() => "--"),
            nextClient.readFirmwareVersion().catch(() => "--"),
            nextClient.readSignalStrength().then(formatSignalStrength).catch(() => "--"),
          ]);
          await nextClient.close();
          return [
            getDeviceKey(device),
            {
              batteryText: nextBatteryText ?? "--",
              serialNumber: nextSerialNumber || "--",
              firmwareVersion: nextFirmwareVersion || "--",
              signalStrength: nextSignalStrength,
            },
          ] as const;
        } catch {
          return [getDeviceKey(device), { batteryText: "--", serialNumber: "--", firmwareVersion: "--", signalStrength: "--" }] as const;
        }
      }),
    );

    if (authorizedDeviceInfoScanIdRef.current !== scanId) {
      return;
    }

    setAuthorizedDeviceBatteryText(Object.fromEntries(entries.map(([key, value]) => [key, value.batteryText])));
    setAuthorizedDeviceSerialNumber(Object.fromEntries(entries.map(([key, value]) => [key, value.serialNumber])));
    setAuthorizedDeviceFirmwareVersion(Object.fromEntries(entries.map(([key, value]) => [key, value.firmwareVersion])));
    setAuthorizedDeviceSignalStrength(Object.fromEntries(entries.map(([key, value]) => [key, value.signalStrength])));
  }, [batteryText, deviceSerialNumber, firmwareVersion, signalStrength]);

  const readConfigWithClient = useCallback(async (nextClient: Ds5BridgeHidClient, syncUsbEffectiveConfig = false) => {
    setOperation("reading");
    try {
      const nextConfig = normalizeConfig(await nextClient.readConfig());
      configRef.current = nextConfig;
      draftRef.current = nextConfig;
      if (syncUsbEffectiveConfig) {
        usbEffectiveConfigRef.current = pickUsbEffectiveConfig(nextConfig);
        setNeedsUsbReconnect(false);
      }
      setConfig(nextConfig);
      setDraft(nextConfig);
      setSaveState("idle");
      setError(null);
    } finally {
      setOperation(null);
    }
  }, []);

  const clearConnectedDevice = useCallback(() => {
    clientRef.current = null;
    configRef.current = null;
    draftRef.current = DEFAULT_CONFIG;
    usbEffectiveConfigRef.current = null;
    setClient(null);
    setConfig(null);
    setDraft(DEFAULT_CONFIG);
    setNeedsUsbReconnect(false);
    setSaveState("idle");
    setBatteryText("--");
    setFirmwareVersion("--");
    setSignalStrength("--");
    setDeviceSerialNumber("--");
  }, []);

  const setLowBatteryNotificationEnabled = useCallback(async (enabled: boolean) => {
    lowBatteryNotificationEnabledRef.current = enabled;
    setLowBatteryNotificationEnabledState(enabled);

    if (!enabled) {
      lowBatteryNotifiedKeyRef.current.clear();
    }

    await invoke("ds5_set_low_battery_notification_enabled", { enabled });
  }, []);

  const notifyLowBatteryIfNeeded = useCallback((device: HIDDevice, nextBatteryText: string) => {
    if (!lowBatteryNotificationEnabledRef.current) {
      return;
    }

    const percent = parseBatteryPercent(nextBatteryText);
    const deviceKey = getDeviceKey(device);

    if (percent === null || percent > LOW_BATTERY_THRESHOLD_PERCENT) {
      lowBatteryNotifiedKeyRef.current.delete(deviceKey);
      return;
    }

    if (lowBatteryNotifiedKeyRef.current.has(deviceKey)) {
      return;
    }

    lowBatteryNotifiedKeyRef.current.add(deviceKey);
    void enqueueLowBatteryNotification(
      t("notifications.lowBatteryTitle"),
      t("notifications.lowBatteryBody", { device: getDeviceLabel(device), battery: nextBatteryText }),
    );
  }, [t]);

  const testLowBatteryNotification = useCallback(async () => {
    await enqueueLowBatteryNotification(
      t("notifications.lowBatteryTitle"),
      t("notifications.lowBatteryBody", { device: t("notifications.testDevice"), battery: "20%" }),
    );
  }, [t]);

  const handleConnectedDeviceDisconnected = useCallback((expectedDisconnect = false) => {
    if (!expectedDisconnect) {
      shouldReturnHomeRef.current = false;
      setShouldReturnHome(false);
      setError(t("errors.disconnected"));
    }

    expectedUsbDisconnectRef.current = false;
    clearConnectedDevice();
  }, [clearConnectedDevice, t]);

  const attachClient = useCallback(
    async (nextClient: Ds5BridgeHidClient) => {
      setOperation("connecting");
      const previousClient = clientRef.current;
      try {
        if (previousClient && previousClient.device !== nextClient.device) {
          await previousClient.close().catch(() => undefined);
        }
        await nextClient.open();
        clientRef.current = nextClient;
        setClient(nextClient);
        shouldReturnHomeRef.current = false;
        setShouldReturnHome(false);
        requireManualSelectionRef.current = false;
        setError(null);
      } finally {
        setOperation(null);
      }
      await readConfigWithClient(nextClient, true);
      try {
        setDeviceSerialNumber((await nextClient.readSerialNumber()) || "--");
      } catch {
        setDeviceSerialNumber("--");
      }

      const nextBatteryText = await nextClient.readBatteryText(BATTERY_LISTEN_TIMEOUT_MS).catch(() => null);
      if (nextBatteryText) {
        setBatteryText(nextBatteryText);
        notifyLowBatteryIfNeeded(nextClient.device, nextBatteryText);
      }
      await refreshPicoInfo(nextClient, setFirmwareVersion, setSignalStrength);
    },
    [notifyLowBatteryIfNeeded, readConfigWithClient],
  );

  const connectDeviceSilently = useCallback(async (device: HIDDevice) => {
    try {
      await attachClient(new Ds5BridgeHidClient(device));
    } catch (cause) {
      if (autoConnectDeviceKeyRef.current === getDeviceKey(device)) {
        autoConnectDeviceKeyRef.current = null;
      }

      setError(errorMessage(cause, t));
      setOperation(null);
    }
  }, [attachClient, t]);

  const connect = useCallback(async () => {
    try {
      requireManualSelectionRef.current = false;
      await attachClient(await Ds5BridgeHidClient.requestDevice());
      await refreshAuthorizedDevices();
    } catch (cause) {
      if (isNoDeviceSelectedError(cause)) {
        setOperation(null);
        return;
      }

      setError(errorMessage(cause, t));
      setOperation(null);
    }
  }, [attachClient, refreshAuthorizedDevices, t]);

  const connectAuthorized = useCallback(
    async (device: HIDDevice) => {
      await connectDeviceSilently(device);
    },
    [connectDeviceSilently],
  );

  const readConfig = useCallback(async () => {
    if (!client) {
      return;
    }

    try {
      await readConfigWithClient(client);
    } catch (cause) {
      if (!client.device.opened) {
        handleConnectedDeviceDisconnected(expectedUsbDisconnectRef.current);
        return;
      }

      setError(errorMessage(cause, t));
      setOperation(null);
    }
  }, [client, handleConnectedDeviceDisconnected, readConfigWithClient, t]);

  const applyLatestDraft = useCallback(async (): Promise<boolean> => {
    if (applyingRef.current) {
      applyQueuedRef.current = true;
      return false;
    }

    applyingRef.current = true;
    setOperation("applying");
    try {
      while (true) {
        applyQueuedRef.current = false;

        const nextClient = clientRef.current;
        if (!nextClient) {
          break;
        }

        const nextDraft = normalizeConfig(preservePollingRateForControllerOnlyChange(draftRef.current, pendingChangedFieldsRef.current, configRef.current));
        if (validateConfig(nextDraft).length > 0 || configsEqual(configRef.current, nextDraft)) {
          pendingChangedFieldsRef.current.clear();
          break;
        }

        await nextClient.applyConfig(nextDraft);
        pendingChangedFieldsRef.current.clear();
        configRef.current = nextDraft;
        setConfig(nextDraft);
        const currentUsbEffectiveConfig = usbEffectiveConfigRef.current;
        const pollingRateChanged = currentUsbEffectiveConfig?.pollingRateMode !== nextDraft.pollingRateMode;
        const controllerModeChanged = currentUsbEffectiveConfig?.controllerMode !== nextDraft.controllerMode;
        const needsReconnect = pollingRateChanged || controllerModeChanged;
        setSaveState("applied");
        setError(null);

        if (needsReconnect) {
          expectedUsbDisconnectRef.current = true;
          requireManualSelectionRef.current = true;
          // 先设置 shouldReturnHome（ref 同步 + state 异步）作为 USB 重枚举期间的设置页保活标记，
          // 防止 disconnect 事件中 clearConnectedDevice 将 client 设为 null 后 App.tsx 的 useEffect 提前切换到主页。
          // 设备重新连接成功后会在 attachClient 中清理该标记，不再强制回到主页，避免设置页闪动。
          shouldReturnHomeRef.current = true;
          setShouldReturnHome(true);
          try {
            await nextClient.reconnectUsb();
          } catch {
            // The device can close immediately after the reconnect command is sent.
            // This is expected for polling-rate or controller-mode changes, so keep the UI quiet and
            // require the user to select the device again manually.
          }
          clearConnectedDevice();
          break;
        } else {
          setNeedsUsbReconnect(false);
        }

        if (configsEqual(draftRef.current, nextDraft)) {
          draftRef.current = nextDraft;
          setDraft(nextDraft);
        }

        if (!applyQueuedRef.current && configsEqual(configRef.current, draftRef.current)) {
          break;
        }
      }
    } catch (cause) {
      setError(errorMessage(cause, t));
      return false;
    } finally {
      applyingRef.current = false;
      setOperation(null);
    }

    return true;
  }, [clearConnectedDevice, t]);

  const saveToFlash = useCallback(async () => {
    const nextClient = clientRef.current;
    if (!nextClient || !configsEqual(configRef.current, draftRef.current)) {
      return;
    }

    setOperation("saving");
    try {
      await nextClient.saveToFlash();
      setSaveState("saved");
      if (savedStatusTimerRef.current !== null) {
        window.clearTimeout(savedStatusTimerRef.current);
      }
      savedStatusTimerRef.current = window.setTimeout(() => {
        setSaveState("idle");
        savedStatusTimerRef.current = null;
      }, 900);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setOperation(null);
    }
  }, [t]);

  const scheduleAutoSave = useCallback(() => {
    if (autoSaveTimerRef.current !== null) {
      window.clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = window.setTimeout(async () => {
      autoSaveTimerRef.current = null;
      const applied = await applyLatestDraft();
      if (applied && configsEqual(configRef.current, draftRef.current)) {
        await saveToFlash();
      }
    }, 180);
  }, [applyLatestDraft, saveToFlash]);

  const reconnectUsb = useCallback(async () => {
    if (!client) {
      return;
    }

    setOperation("reconnecting");
    try {
      await client.reconnectUsb();
      usbEffectiveConfigRef.current = pickUsbEffectiveConfig(configRef.current ?? draftRef.current);
      setNeedsUsbReconnect(false);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setOperation(null);
    }
  }, [client, t]);

  const setDraftField = useCallback(
    <Key extends keyof ConfigBody>(field: Key, value: ConfigBody[Key]) => {
      const nextDraft = { ...draftRef.current, [field]: value };
      pendingChangedFieldsRef.current.add(field);
      draftRef.current = nextDraft;
      setDraft(nextDraft);
      setSaveState("dirty");
      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  const resetToDefaults = useCallback(async () => {
    const nextClient = clientRef.current;
    if (!nextClient) {
      return;
    }

    draftRef.current = DEFAULT_CONFIG;
    pendingChangedFieldsRef.current = new Set(Object.keys(DEFAULT_CONFIG) as Array<keyof ConfigBody>);
    setDraft(DEFAULT_CONFIG);
    setSaveState("dirty");

    const applied = await applyLatestDraft();
    if (!applied || !configsEqual(configRef.current, DEFAULT_CONFIG)) {
      return;
    }

    setOperation("saving");
    try {
      await nextClient.saveToFlash();
      setSaveState("saved");
      if (savedStatusTimerRef.current !== null) {
        window.clearTimeout(savedStatusTimerRef.current);
      }
      savedStatusTimerRef.current = window.setTimeout(() => {
        setSaveState("idle");
        savedStatusTimerRef.current = null;
      }, 900);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setOperation(null);
    }
  }, [applyLatestDraft, t]);

  useEffect(() => {
    void refreshAuthorizedDevices();
  }, [refreshAuthorizedDevices]);

  useEffect(() => {
    void invoke<boolean>("ds5_get_low_battery_notification_enabled")
      .then((enabled) => {
        lowBatteryNotificationEnabledRef.current = enabled;
        setLowBatteryNotificationEnabledState(enabled);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!supported) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    void startDeviceMonitor().catch(() => undefined);
    void listen<TauriHidDeviceInfo[]>("ds5-devices-changed", (event) => {
      if (!disposed) {
        const nextDevices = tauriDeviceInfosToHidDevices(event.payload);
        setAuthorizedDevices(nextDevices);

        const connectedClient = clientRef.current;
        if (connectedClient && !deviceListIncludes(nextDevices, connectedClient.device)) {
          handleConnectedDeviceDisconnected(expectedUsbDisconnectRef.current);
        }
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
      } else {
        unlisten = nextUnlisten;
      }
    });

    const intervalId = window.setInterval(() => {
      void refreshAuthorizedDevices();
    }, DEVICE_DISCOVERY_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      unlisten?.();
    };
  }, [handleConnectedDeviceDisconnected, refreshAuthorizedDevices, supported]);

  useEffect(() => {
    const connectedClient = clientRef.current;
    if (!connectedClient || deviceListIncludes(authorizedDevices, connectedClient.device)) {
      return;
    }

    handleConnectedDeviceDisconnected(expectedUsbDisconnectRef.current);
  }, [authorizedDevices, handleConnectedDeviceDisconnected]);

  useEffect(() => {
    if (authorizedDevices.length === 0) {
      autoConnectDeviceKeyRef.current = null;
      setAuthorizedDeviceBatteryText({});
      setAuthorizedDeviceSerialNumber({});
      setAuthorizedDeviceFirmwareVersion({});
      setAuthorizedDeviceSignalStrength({});
      return;
    }

    void scanAuthorizedDeviceInfo(authorizedDevices);
  }, [authorizedDevices, scanAuthorizedDeviceInfo]);

  useEffect(() => {
    if (!supported || clientRef.current || operation) {
      return;
    }

    const nextDevice = authorizedDevices.find(Ds5BridgeHidClient.isSupportedDevice);
    if (!nextDevice) {
      autoConnectDeviceKeyRef.current = null;
      return;
    }

    const nextDeviceKey = getDeviceKey(nextDevice);
    if (autoConnectDeviceKeyRef.current === nextDeviceKey) {
      return;
    }

    autoConnectDeviceKeyRef.current = nextDeviceKey;
    void connectDeviceSilently(nextDevice);
  }, [authorizedDevices, connectDeviceSilently, operation, supported]);

  useEffect(() => {
    if (!supported) {
      return;
    }

    const refreshBatteryInfo = () => {
      void refreshAuthorizedDevices();

      const connectedClient = clientRef.current;
      if (connectedClient?.device.opened) {
        void connectedClient.readBatteryText(BATTERY_LISTEN_TIMEOUT_MS).then((nextBatteryText) => {
          if (nextBatteryText && clientRef.current === connectedClient) {
            setBatteryText(nextBatteryText);
            notifyLowBatteryIfNeeded(connectedClient.device, nextBatteryText);
          }
        }).catch(() => {
          if (clientRef.current === connectedClient && !connectedClient.device.opened) {
            handleConnectedDeviceDisconnected(expectedUsbDisconnectRef.current);
          }
        });
      }
    };

    const intervalId = window.setInterval(refreshBatteryInfo, BATTERY_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [handleConnectedDeviceDisconnected, notifyLowBatteryIfNeeded, refreshAuthorizedDevices, supported]);

  useEffect(() => {
    const batteries = authorizedDevices.map((device, index) => {
      const deviceKey = getDeviceKey(device);
      return {
        label: t("tray.controllerLabel", { index: index + 1 }),
        batteryText: clientRef.current?.device === device ? batteryText : (authorizedDeviceBatteryText[deviceKey] ?? "--"),
      };
    });

    if (batteries.length === 0) {
      batteries.push({ label: "", batteryText: batteryText || "--" });
    }

    void invoke("ds5_update_tray_batteries", { batteries }).catch(() => undefined);
  }, [authorizedDeviceBatteryText, authorizedDevices, batteryText, t]);

  useEffect(() => {
    const syncTrayLabels = () => {
      void invoke("ds5_update_tray_labels", {
        labels: {
          openWindow: t("tray.openWindow"),
          quit: t("tray.quit"),
          batteryPrefix: t("tray.batteryPrefix"),
        },
      }).catch(() => undefined);
    };

    syncTrayLabels();
    i18n.on("languageChanged", syncTrayLabels);
    return () => {
      i18n.off("languageChanged", syncTrayLabels);
    };
  }, [i18n, t]);

  useEffect(() => {
    if (!supported) {
      return;
    }

    const refreshConnectedPicoInfo = () => {
      const currentClient = clientRef.current;
      if (currentClient?.device.opened) {
        void refreshPicoInfo(currentClient, setFirmwareVersion, setSignalStrength).catch(() => {
          if (clientRef.current === currentClient && !currentClient.device.opened) {
            handleConnectedDeviceDisconnected(expectedUsbDisconnectRef.current);
          }
        });
      }
    };

    refreshConnectedPicoInfo();
    const intervalId = window.setInterval(refreshConnectedPicoInfo, PICO_INFO_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [handleConnectedDeviceDisconnected, supported]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current !== null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
      if (savedStatusTimerRef.current !== null) {
        window.clearTimeout(savedStatusTimerRef.current);
      }
    };
  }, []);

  return {
    supported,
    client,
    deviceLabel,
    deviceSerialNumber,
    batteryText,
    firmwareVersion,
    signalStrength,
    authorizedDeviceSerialNumber,
    authorizedDeviceBatteryText,
    authorizedDeviceFirmwareVersion,
    authorizedDeviceSignalStrength,
    authorizedDevices,
    config,
    draft,
    issues,
    saveState,
    operation,
    error,
    statusText: settledStatusText,
    shouldReturnHome,
    shouldReturnHomeRef,
    isConnected,
    isDirty,
    isDefaultConfig,
    needsUsbReconnect,
    lowBatteryNotificationEnabled,
    setDraftField,
    setLowBatteryNotificationEnabled,
    testLowBatteryNotification,
    refreshAuthorizedDevices,
    connect,
    connectAuthorized,
    readConfig,
    saveToFlash,
    reconnectUsb,
    resetToDefaults,
    clearReturnHome: () => {
      shouldReturnHomeRef.current = false;
      setShouldReturnHome(false);
    },
    clearError: () => setError(null),
  };
}

function parseBatteryPercent(batteryText: string): number | null {
  const match = batteryText.match(/(\d{1,3})\s*%/);
  if (!match) {
    return null;
  }

  return Math.max(0, Math.min(100, Number(match[1])));
}

async function enqueueLowBatteryNotification(title: string, body: string): Promise<void> {
  try {
    const granted = (await isPermissionGranted()) || (await requestPermission()) === "granted";
    if (granted) {
      sendNotification({ title, body });
    }
  } catch {
    // Notifications are best-effort only.
  }
}

async function refreshPicoInfo(
  client: Ds5BridgeHidClient,
  setFirmwareVersion: (value: string) => void,
  setSignalStrength: (value: string) => void,
): Promise<void> {
  const [nextFirmwareVersion, nextSignalStrength] = await Promise.all([
    client.readFirmwareVersion().catch(() => "--"),
    client.readSignalStrength().then(formatSignalStrength).catch(() => "--"),
  ]);

  setFirmwareVersion(nextFirmwareVersion || "--");
  setSignalStrength(nextSignalStrength);
}

function formatSignalStrength(rssi: number | null): string {
  return typeof rssi === "number" ? `${rssi} dBm` : "--";
}

function operationLabel(operation: Exclude<Operation, null>, t: (key: string) => string): string {
  switch (operation) {
    case "connecting":
      return t("status.connecting");
    case "reading":
      return t("status.reading");
    case "applying":
      return t("status.applying");
    case "saving":
      return t("status.saving");
    case "reconnecting":
      return t("status.reconnecting");
  }
}

function pickUsbEffectiveConfig(config: ConfigBody): UsbEffectiveConfig {
  return {
    pollingRateMode: config.pollingRateMode,
    controllerMode: config.controllerMode,
  };
}

function preservePollingRateForControllerOnlyChange(
  draft: ConfigBody,
  pendingChangedFields: Set<keyof ConfigBody>,
  currentConfig: ConfigBody | null,
): ConfigBody {
  if (
    !currentConfig ||
    !pendingChangedFields.has("controllerMode") ||
    pendingChangedFields.has("pollingRateMode")
  ) {
    return draft;
  }

  return {
    ...draft,
    pollingRateMode: currentConfig.pollingRateMode,
  };
}

function deviceListIncludes(devices: HIDDevice[], target: HIDDevice): boolean {
  const targetKey = getDeviceKey(target);
  return devices.some((device) => getDeviceKey(device) === targetKey);
}

function usbEffectiveConfigChanged(current: UsbEffectiveConfig | null, next: ConfigBody): boolean {
  if (!current) {
    return false;
  }

  return current.pollingRateMode !== next.pollingRateMode || current.controllerMode !== next.controllerMode;
}

function errorMessage(cause: unknown, t: (key: string, values?: Record<string, unknown>) => string): string {
  if (cause instanceof ConfigDecodeError) {
    if (cause.code === "invalidConfig") {
      const fields = Array.isArray(cause.values.issues) ? cause.values.issues : [];
      const issues = fields.map((field) => t(`validation.${String(field)}`)).join("; ");

      return t("errors.invalidConfig", { issues });
    }

    return t("errors.invalidBytes", cause.values);
  }

  if (cause instanceof Error) {
    if (cause.message === NO_DEVICE_SELECTED_ERROR) {
      return t("errors.noDeviceSelected");
    }

    if (cause.message === WEBHID_UNAVAILABLE_ERROR) {
      return t("errors.webHidUnavailable");
    }

    return cause.message;
  }

  return t("errors.unexpectedWebHid");
}

function isNoDeviceSelectedError(cause: unknown): boolean {
  return cause instanceof Error && cause.message === NO_DEVICE_SELECTED_ERROR;
}
