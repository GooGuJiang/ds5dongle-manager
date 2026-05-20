import { lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import toast, { Toaster } from "react-hot-toast";
import { useTranslation } from "react-i18next";
import {
  APP_METADATA,
  APP_TOAST_OPTIONS,
  SETTINGS_SIDEBAR_AUTO_COLLAPSE_QUERY,
  type AppView,
} from "./appConfig";
import { AppHeader } from "./components/AppHeader";
import { DeviceStrip } from "./components/DeviceStrip";
import { NoticeList } from "./components/NoticeList";
import { useDs5Bridge } from "./hooks/useDs5Bridge";
import { useTheme } from "./hooks/useTheme";
import { checkFirmwareUpdate, shouldCheckFirmwareUpdate, type FirmwareUpdateCheckResult } from "./lib/firmwareRelease";
import { checkSoftwareUpdate, getSoftwareSystemInfo, type SoftwareSystemInfo, type SoftwareUpdateCheckResult } from "./lib/softwareRelease";

const FirmwareUpdateDialog = lazy(() => import("./components/FirmwareUpdateDialog").then((module) => ({ default: module.FirmwareUpdateDialog })));
const SoftwareUpdateDialog = lazy(() => import("./components/SoftwareUpdateDialog").then((module) => ({ default: module.SoftwareUpdateDialog })));
const SettingsView = lazy(() => import("./components/SettingsView").then((module) => ({ default: module.SettingsView })));

export default function App() {
  const bridge = useDs5Bridge();
  const theme = useTheme();
  const { t } = useTranslation();
  const [view, setView] = useState<AppView>("home");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [firmwareUpdateResult, setFirmwareUpdateResult] = useState<FirmwareUpdateCheckResult | null>(null);
  const [firmwareUpdateDialogOpen, setFirmwareUpdateDialogOpen] = useState(false);
  const [softwareUpdateResult, setSoftwareUpdateResult] = useState<SoftwareUpdateCheckResult | null>(null);
  const [softwareUpdateDialogOpen, setSoftwareUpdateDialogOpen] = useState(false);
  const [softwareSystemInfo, setSoftwareSystemInfo] = useState<SoftwareSystemInfo | null>(null);
  const [deviceSwitching, setDeviceSwitching] = useState(false);
  const deviceSwitchingTimerRef = useRef<number | null>(null);
  const dismissedFirmwareUpdateKeyRef = useRef(readDismissedUpdateKey(FIRMWARE_UPDATE_DISMISSED_KEY));
  const dismissedSoftwareUpdateKeyRef = useRef(readDismissedUpdateKey(SOFTWARE_UPDATE_DISMISSED_KEY));
  const isBusy = bridge.operation !== null;
  const headerIssues = useMemo(() => bridge.issues.map((issue) => t(`validation.${issue.field}`)), [bridge.issues, t]);
  const isSettingsView = view === "settings" || view === "about";
  const handleBackHome = useCallback(() => setView("home"), []);
  const handleOpenSettings = useCallback(() => setView("settings"), []);
  // 进度条完成后不再切换回主页，避免回报率/手柄模式切换时 USB 重枚举造成设置页闪回主页。
  const handleProgressComplete = useCallback(() => {
    if (bridge.shouldReturnHomeRef.current && bridge.client) {
      bridge.clearReturnHome();
    }
  }, [bridge.client, bridge.clearReturnHome, bridge.shouldReturnHomeRef]);

  useEffect(() => {
    if (!bridge.client && (view === "settings" || view === "about") && !bridge.shouldReturnHomeRef.current) {
      setView("home");
    }
  }, [bridge.client, bridge.shouldReturnHome, view]);

  useEffect(() => {
    if (!bridge.error) {
      return;
    }

    toast.error(bridge.error, { id: "bridge-error" });
    bridge.clearError();
  }, [bridge.error, bridge.clearError]);

  useEffect(() => {
    if ((view !== "settings" && view !== "about") || !bridge.client || !shouldCheckFirmwareUpdate(bridge.firmwareVersion)) {
      return;
    }

    const abortController = new AbortController();

    void checkFirmwareUpdate(bridge.firmwareVersion, abortController.signal)
      .then((result) => {
        if (!result?.updateAvailable || abortController.signal.aborted) {
          return;
        }

        const updateKey = firmwareUpdatePromptKey(result);

        setFirmwareUpdateResult(result);

        if (dismissedFirmwareUpdateKeyRef.current !== updateKey) {
          setFirmwareUpdateDialogOpen(true);
        }
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error("Firmware update check failed", error);
        }
      });

    return () => abortController.abort();
  }, [bridge.client, bridge.firmwareVersion, view]);

  useEffect(() => {
    const abortController = new AbortController();

    void Promise.all([checkSoftwareUpdate(abortController.signal), getSoftwareSystemInfo()])
      .then(([result, systemInfo]) => {
        if (abortController.signal.aborted) {
          return;
        }

        setSoftwareSystemInfo(systemInfo);

        if (!result?.updateAvailable) {
          return;
        }

        const updateKey = softwareUpdatePromptKey(result);

        setSoftwareUpdateResult(result);

        if (dismissedSoftwareUpdateKeyRef.current !== updateKey) {
          setSoftwareUpdateDialogOpen(true);
        }
      })
      .catch((error) => {
        if (!abortController.signal.aborted) {
          console.error("Software update check failed", error);
        }
      });

    return () => abortController.abort();
  }, []);

  const handleFirmwareUpdateDialogOpenChange = useCallback((open: boolean) => {
    setFirmwareUpdateDialogOpen(open);

    if (!open && firmwareUpdateResult?.updateAvailable) {
      dismissedFirmwareUpdateKeyRef.current = firmwareUpdatePromptKey(firmwareUpdateResult);
      writeDismissedUpdateKey(FIRMWARE_UPDATE_DISMISSED_KEY, dismissedFirmwareUpdateKeyRef.current);
    }
  }, [firmwareUpdateResult]);

  const handleOpenFirmwareUpdateDialog = useCallback(() => {
    if (firmwareUpdateResult?.updateAvailable) {
      setFirmwareUpdateDialogOpen(true);
    }
  }, [firmwareUpdateResult]);

  const handleSoftwareUpdateDialogOpenChange = useCallback((open: boolean) => {
    setSoftwareUpdateDialogOpen(open);

    if (!open && softwareUpdateResult?.updateAvailable) {
      dismissedSoftwareUpdateKeyRef.current = softwareUpdatePromptKey(softwareUpdateResult);
      writeDismissedUpdateKey(SOFTWARE_UPDATE_DISMISSED_KEY, dismissedSoftwareUpdateKeyRef.current);
    }
  }, [softwareUpdateResult]);

  const handleOpenSoftwareUpdateDialog = useCallback(() => {
    if (softwareUpdateResult?.updateAvailable) {
      setSoftwareUpdateDialogOpen(true);
    }
  }, [softwareUpdateResult]);

  const handleSelectDevice = useCallback(async (device: HIDDevice) => {
    const shouldAnimateSwitch = bridge.client?.device !== device;

    if (!shouldAnimateSwitch) {
      await bridge.connectAuthorized(device);
      return;
    }

    if (deviceSwitchingTimerRef.current !== null) {
      window.clearTimeout(deviceSwitchingTimerRef.current);
      deviceSwitchingTimerRef.current = null;
    }

    setDeviceSwitching(true);

    try {
      await Promise.all([
        bridge.connectAuthorized(device),
        wait(180),
      ]);
    } finally {
      deviceSwitchingTimerRef.current = window.setTimeout(() => {
        setDeviceSwitching(false);
        deviceSwitchingTimerRef.current = null;
      }, 180);
    }
  }, [bridge.client, bridge.connectAuthorized]);

  useEffect(() => () => {
    if (deviceSwitchingTimerRef.current !== null) {
      window.clearTimeout(deviceSwitchingTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(SETTINGS_SIDEBAR_AUTO_COLLAPSE_QUERY);
    const syncSidebarState = () => setSidebarOpen(!mediaQuery.matches);

    syncSidebarState();
    mediaQuery.addEventListener("change", syncSidebarState);

    return () => mediaQuery.removeEventListener("change", syncSidebarState);
  }, []);

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={APP_TOAST_OPTIONS}
      />
      {firmwareUpdateResult?.updateAvailable && (
        <Suspense fallback={null}>
          <FirmwareUpdateDialog
            open={firmwareUpdateDialogOpen}
            result={firmwareUpdateResult}
            onOpenChange={handleFirmwareUpdateDialogOpenChange}
          />
        </Suspense>
      )}
      {softwareUpdateResult?.updateAvailable && (
        <Suspense fallback={null}>
          <SoftwareUpdateDialog
            open={softwareUpdateDialogOpen}
            result={softwareUpdateResult}
            systemInfo={softwareSystemInfo}
            onOpenChange={handleSoftwareUpdateDialogOpenChange}
          />
        </Suspense>
      )}
        <main className={`app-shell ${isSettingsView ? "settings-mode" : ""} ${deviceSwitching ? "is-device-switching" : ""}`}>
        <AppHeader
          theme={theme.theme}
          onThemeChange={theme.setTheme}
          softwareUpdateAvailable={softwareUpdateResult?.updateAvailable}
          softwareUpdateVersion={softwareUpdateResult?.latestRelease.tagName}
          onSoftwareUpdateClick={handleOpenSoftwareUpdateDialog}
          statusText={isSettingsView && bridge.client ? bridge.statusText : undefined}
          issues={headerIssues}
          needsUsbReconnect={bridge.needsUsbReconnect}
          showBackButton={isSettingsView}
          onBack={handleBackHome}
          showDeviceActions={isSettingsView && Boolean(bridge.client)}
          canUseDeviceActions={Boolean(bridge.client)}
          canResetToDefaults={!bridge.isDefaultConfig}
          isBusy={isBusy}
          onReadConfig={bridge.readConfig}
          onResetToDefaults={bridge.resetToDefaults}
          lowBatteryNotificationEnabled={bridge.lowBatteryNotificationEnabled}
          onLowBatteryNotificationEnabledChange={bridge.setLowBatteryNotificationEnabled}
          onTestLowBatteryNotification={bridge.testLowBatteryNotification}
        />
        {view === "home" ? (
          <>
            <NoticeList supported={bridge.supported} />
            <div className="device-stage-wrap">
              <DeviceStrip
                authorizedDevices={bridge.authorizedDevices}
                authorizedDeviceSerialNumber={bridge.authorizedDeviceSerialNumber}
                authorizedDeviceBatteryText={bridge.authorizedDeviceBatteryText}
                authorizedDeviceFirmwareVersion={bridge.authorizedDeviceFirmwareVersion}
                authorizedDeviceSignalStrength={bridge.authorizedDeviceSignalStrength}
                client={bridge.client}
                batteryText={bridge.batteryText}
                firmwareVersion={bridge.firmwareVersion}
                signalStrength={bridge.signalStrength}
                deviceSerialNumber={bridge.deviceSerialNumber}
                deviceLabel={bridge.deviceLabel}
                isBusy={isBusy}
                supported={bridge.supported}
                onConnectAuthorized={handleSelectDevice}
                onOpenSettings={handleOpenSettings}
              />
            </div>
            <span className="app-version-watermark" aria-label={`${t("about.version")} v${APP_METADATA.version}`}>
              v{APP_METADATA.version}
            </span>
          </>
        ) : (
          <Suspense fallback={<section className="panel settings-detail" aria-busy="true" />}>
            <SettingsView
              bridge={bridge}
              firmwareUpdateResult={firmwareUpdateResult}
              sidebarOpen={sidebarOpen}
              view={view}
              onFirmwareUpdateClick={handleOpenFirmwareUpdateDialog}
              onProgressComplete={handleProgressComplete}
              onSelectDevice={handleSelectDevice}
              onSidebarOpenChange={setSidebarOpen}
              onViewChange={setView}
            />
          </Suspense>
        )}

      </main>
    </>
  );
}

const FIRMWARE_UPDATE_DISMISSED_KEY = "firmware-update-dismissed-key";
const SOFTWARE_UPDATE_DISMISSED_KEY = "software-update-dismissed-key";

function firmwareUpdatePromptKey(result: FirmwareUpdateCheckResult): string {
  return `${result.currentVersion}->${result.latestRelease.tagName}`;
}

function softwareUpdatePromptKey(result: SoftwareUpdateCheckResult): string {
  return `${result.currentVersion}->${result.latestRelease.tagName}`;
}

function readDismissedUpdateKey(storageKey: string): string | null {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeDismissedUpdateKey(storageKey: string, updateKey: string): void {
  try {
    localStorage.setItem(storageKey, updateKey);
  } catch {
    // Ignore storage failures; the in-memory ref still prevents repeated prompts in this session.
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
