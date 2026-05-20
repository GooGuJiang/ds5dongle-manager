import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeft, RefreshCw, RotateCcw, Settings, Sparkles } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { VscChromeClose, VscChromeMaximize, VscChromeMinimize } from "react-icons/vsc";
import { Tooltip } from "react-tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { SoftwareSettingsDialog, type ControllerNotificationSoundVolumes } from "./SoftwareSettingsDialog";
import { ThemeSwitcher } from "./ThemeSwitcher";
import type { ThemeMode } from "@/hooks/useTheme";

const headerMotionTransition = {
  type: "tween" as const,
  duration: 0.18,
  ease: "circOut" as const,
};

const headerFadeTransition = {
  type: "tween" as const,
  duration: 0.12,
  ease: "easeOut" as const,
};

interface SoftwareSettingsPayload {
  closeToTray: boolean;
  closeToTrayAsked: boolean;
  lowBatteryNotificationEnabled: boolean;
  controllerNotificationSoundEnabled: boolean;
  controllerNotificationSoundVolumes: ControllerNotificationSoundVolumes;
}

interface AppHeaderProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  softwareUpdateAvailable?: boolean;
  softwareUpdateVersion?: string;
  onSoftwareUpdateClick?: () => void;
  statusText?: string;
  issues?: string[];
  needsUsbReconnect?: boolean;
  showBackButton?: boolean;
  onBack?: () => void;
  showDeviceActions?: boolean;
  canUseDeviceActions?: boolean;
  canResetToDefaults?: boolean;
  isBusy?: boolean;
  onReadConfig?: () => void;
  onResetToDefaults?: () => void;
  lowBatteryNotificationEnabled?: boolean;
  onLowBatteryNotificationEnabledChange?: (enabled: boolean) => Promise<void>;
  controllerNotificationSoundEnabled?: boolean;
  controllerNotificationSoundVolumes: ControllerNotificationSoundVolumes;
  onControllerNotificationSoundEnabledChange?: (enabled: boolean) => Promise<void>;
  onControllerNotificationSoundVolumeChange?: (sound: keyof ControllerNotificationSoundVolumes, volume: number) => Promise<void>;
  onResetControllerNotificationSoundVolumes?: () => Promise<void>;
  onTestLowBatteryNotification?: () => Promise<void>;
  onTestControllerNotificationSound?: (sound: keyof ControllerNotificationSoundVolumes) => Promise<void>;
}

export function AppHeader({
  theme,
  onThemeChange,
  softwareUpdateAvailable = false,
  softwareUpdateVersion,
  onSoftwareUpdateClick,
  statusText,
  issues = [],
  needsUsbReconnect = false,
  showBackButton = false,
  onBack,
  showDeviceActions = false,
  canUseDeviceActions = false,
  canResetToDefaults = false,
  isBusy = false,
  onReadConfig,
  onResetToDefaults,
  lowBatteryNotificationEnabled = true,
  onLowBatteryNotificationEnabledChange,
  controllerNotificationSoundEnabled = true,
  controllerNotificationSoundVolumes,
  onControllerNotificationSoundEnabledChange,
  onControllerNotificationSoundVolumeChange,
  onResetControllerNotificationSoundVolumes,
  onTestLowBatteryNotification,
  onTestControllerNotificationSound,
}: AppHeaderProps) {
  const { t } = useTranslation();
  const appWindow = getCurrentWindow();
  const tooltipPortalRef = useRef<HTMLDivElement | null>(null);
  const [tooltipPortalRoot, setTooltipPortalRoot] = useState<HTMLDivElement | null>(null);
  const showControlBar = Boolean(statusText || showDeviceActions);
  const [displayStatusText, setDisplayStatusText] = useState(statusText);
  const [displayIssues, setDisplayIssues] = useState(issues);
  const [displayNeedsUsbReconnect, setDisplayNeedsUsbReconnect] = useState(needsUsbReconnect);
  const [displayShowDeviceActions, setDisplayShowDeviceActions] = useState(showDeviceActions);
  const [softwareSettingsOpen, setSoftwareSettingsOpen] = useState(false);
  const [closeToTray, setCloseToTray] = useState(false);
  const [closeToTrayAsked, setCloseToTrayAsked] = useState(true);
  const [closeBehaviorDialogOpen, setCloseBehaviorDialogOpen] = useState(false);
  const closeToTrayAskedRef = useRef(true);
  const closeToTrayRef = useRef(false);
  const closeBehaviorDialogOpenRef = useRef(false);
  const forceCloseRef = useRef(false);
  const showControlSpacer = showBackButton && !showControlBar;

  useEffect(() => {
    setTooltipPortalRoot(tooltipPortalRef.current);
  }, []);

  useEffect(() => {
    if (showControlBar) {
      setDisplayStatusText(statusText);
      setDisplayIssues(issues);
      setDisplayNeedsUsbReconnect(needsUsbReconnect);
      setDisplayShowDeviceActions(showDeviceActions);
      return;
    }
  }, [issues, needsUsbReconnect, showControlBar, showDeviceActions, statusText]);

  useEffect(() => {
    let disposed = false;

    void invoke<SoftwareSettingsPayload>("ds5_get_software_settings")
      .then((settings) => {
        if (!disposed) {
          setCloseToTray(settings.closeToTray);
          setCloseToTrayAsked(settings.closeToTrayAsked);
          closeToTrayRef.current = settings.closeToTray;
          closeToTrayAskedRef.current = settings.closeToTrayAsked;
        }
      })
      .catch(() => undefined);

    const unlistenPromise = listen<SoftwareSettingsPayload>("ds5-software-settings-changed", (event) => {
      setCloseToTray(event.payload.closeToTray);
      setCloseToTrayAsked(event.payload.closeToTrayAsked);
      closeToTrayRef.current = event.payload.closeToTray;
      closeToTrayAskedRef.current = event.payload.closeToTrayAsked;
    });

    return () => {
      disposed = true;
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    closeBehaviorDialogOpenRef.current = closeBehaviorDialogOpen;
  }, [closeBehaviorDialogOpen]);

  useEffect(() => {
    const unlistenPromise = appWindow.onCloseRequested((event) => {
      if (forceCloseRef.current) {
        return;
      }

      if (closeToTrayAskedRef.current && closeToTrayRef.current) {
        event.preventDefault();
        void appWindow.hide();
        return;
      }

      if (closeToTrayAskedRef.current || closeBehaviorDialogOpenRef.current) {
        return;
      }

      event.preventDefault();
      setCloseBehaviorDialogOpen(true);
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, [appWindow]);

  const updateCloseToTray = (checked: boolean) => {
    setCloseToTray(checked);
    closeToTrayRef.current = checked;
    void invoke("ds5_set_close_to_tray", { closeToTray: checked }).catch(() => setCloseToTray(!checked));
  };

  const chooseCloseBehavior = async (useTray: boolean) => {
    setCloseBehaviorDialogOpen(false);
    setCloseToTray(useTray);
    setCloseToTrayAsked(true);
    closeToTrayRef.current = useTray;
    closeToTrayAskedRef.current = true;

    try {
      await invoke("ds5_set_close_to_tray", { closeToTray: useTray });
    } catch {
      setCloseToTray(!useTray);
      setCloseToTrayAsked(false);
      closeToTrayRef.current = !useTray;
      closeToTrayAskedRef.current = false;
      return;
    }

    if (useTray) {
      await appWindow.hide();
      return;
    }

    forceCloseRef.current = true;
    await appWindow.destroy();
  };

  const requestWindowClose = () => {
    if (!closeToTrayAskedRef.current) {
      setCloseBehaviorDialogOpen(true);
      return;
    }

    if (closeToTrayRef.current) {
      void appWindow.hide();
      return;
    }

    void appWindow.close();
  };

  return (
    <header className="app-header" data-tauri-drag-region>
      <LayoutGroup>
      <motion.div className="brand-lockup" layout transition={headerMotionTransition} data-tauri-drag-region>
        <AnimatePresence initial={false}>
          {showBackButton && (
            <motion.div
              key="header-back-button"
              layout
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 38, opacity: 1, x: 0, scale: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={headerMotionTransition}
              className="header-back-motion-slot"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="header-back-button"
                onClick={onBack}
                aria-label={t("settings.backToHome")}
                title={t("settings.backToHome")}
              >
                <ArrowLeft size={18} />
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        <motion.div className="brand-main" layout transition={headerMotionTransition} data-tauri-drag-region>
          <img className="app-icon" src="/pwa-icon.svg" alt="" aria-hidden="true" />
          <h1>{t("app.title")}</h1>
          {softwareUpdateAvailable && (
            <button
              type="button"
              className="brand-update-button"
              onClick={onSoftwareUpdateClick}
              aria-label={t("app.updateAvailable", { version: softwareUpdateVersion })}
              data-tooltip-id="header-device-actions-tooltip"
              data-tooltip-content={t("app.updateAvailable", { version: softwareUpdateVersion })}
              data-tooltip-place="bottom"
            >
              <Sparkles size={15} aria-hidden="true" />
              <span>{t("app.updateBadge", { version: softwareUpdateVersion })}</span>
            </button>
          )}
        </motion.div>
      </motion.div>
      <motion.div className="header-drag-spacer" layout transition={headerMotionTransition} data-tauri-drag-region />
      <motion.div className="header-actions" layout transition={headerMotionTransition}>
        <motion.div layout transition={headerMotionTransition} className="header-action-slot">
          <LanguageSwitcher />
        </motion.div>
        <motion.div layout transition={headerMotionTransition} className="header-action-slot">
          <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />
        </motion.div>
        <motion.div layout transition={headerMotionTransition} className="header-action-slot">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="header-software-settings-button"
            onClick={() => setSoftwareSettingsOpen(true)}
            aria-label={t("softwareSettings.title")}
            data-tooltip-id="header-device-actions-tooltip"
            data-tooltip-content={t("softwareSettings.title")}
            data-tooltip-place="bottom"
          >
            <Settings size={17} />
          </Button>
        </motion.div>
        <AnimatePresence initial={false} mode="popLayout">
          {(showControlBar || showControlSpacer) && (
            <motion.div
              key={showControlBar ? "header-device-control-bar" : "header-device-control-spacer"}
              className={`header-device-control-motion-slot ${showControlSpacer ? "is-spacer" : ""}`}
              layout
              initial={{ maxWidth: 0, opacity: 0 }}
              animate={{ maxWidth: showControlSpacer ? 0 : 720, opacity: showControlSpacer ? 0 : 1 }}
              exit={{ maxWidth: 0, opacity: 0 }}
              transition={headerMotionTransition}
            >
              {showControlBar && (
                <motion.div
                  className="header-device-control-bar"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={headerFadeTransition}
                >
                  {displayStatusText && (
                    <div className="header-status" role="status" aria-live="polite">
                      <span className="header-status-label">{t("actions.state")}</span>
                      <strong>{displayStatusText}</strong>
                      {displayIssues.length > 0 && <span className="header-status-error">{displayIssues.join(" / ")}</span>}
                      {displayNeedsUsbReconnect && <span className="header-status-warning">{t("actions.reconnectRequired")}</span>}
                    </div>
                  )}
                  {displayShowDeviceActions && (
                    <div className="header-device-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="header-device-action-button"
                        onClick={onReadConfig}
                        disabled={!canUseDeviceActions || isBusy}
                        aria-label={t("actions.read")}
                        data-tooltip-id="header-device-actions-tooltip"
                        data-tooltip-content={t("actions.readTitle")}
                        data-tooltip-place="bottom"
                      >
                        <RefreshCw size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="header-device-action-button"
                        onClick={onResetToDefaults}
                        disabled={!canUseDeviceActions || isBusy || !canResetToDefaults}
                        aria-label={t("actions.reset")}
                        data-tooltip-id="header-device-actions-tooltip"
                        data-tooltip-content={t("actions.resetTitle")}
                        data-tooltip-place="bottom"
                      >
                        <RotateCcw size={16} />
                      </Button>
                    </div>
                  )}
                </motion.div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      </LayoutGroup>
      <div className="window-controls" aria-label="Window controls">
        <button
          type="button"
          className="window-control-button"
          onClick={() => void appWindow.minimize()}
          aria-label="Minimize"
          title="Minimize"
        >
          <VscChromeMinimize aria-hidden="true" />
        </button>
        <button
          type="button"
          className="window-control-button"
          onClick={async () => {
            const maximized = await appWindow.isMaximized();
            if (maximized) {
              await appWindow.unmaximize();
            } else {
              await appWindow.maximize();
            }
          }}
          aria-label="Maximize"
          title="Maximize"
        >
          <VscChromeMaximize aria-hidden="true" />
        </button>
        <button
          type="button"
          className="window-control-button is-close"
          onClick={(event) => {
            event.currentTarget.blur();
            requestWindowClose();
          }}
          aria-label="Close"
          title="Close"
        >
          <VscChromeClose aria-hidden="true" />
        </button>
      </div>
      <div ref={tooltipPortalRef} />
      <Tooltip id="header-device-actions-tooltip" place="bottom" positionStrategy="fixed" portalRoot={tooltipPortalRoot} />
      <SoftwareSettingsDialog
        open={softwareSettingsOpen}
        closeToTray={closeToTray}
        lowBatteryNotificationEnabled={lowBatteryNotificationEnabled}
        controllerNotificationSoundEnabled={controllerNotificationSoundEnabled}
        controllerNotificationSoundVolumes={controllerNotificationSoundVolumes}
        onOpenChange={setSoftwareSettingsOpen}
        onCloseToTrayChange={updateCloseToTray}
        onLowBatteryNotificationEnabledChange={onLowBatteryNotificationEnabledChange}
        onControllerNotificationSoundEnabledChange={onControllerNotificationSoundEnabledChange}
        onControllerNotificationSoundVolumeChange={onControllerNotificationSoundVolumeChange}
        onResetControllerNotificationSoundVolumes={onResetControllerNotificationSoundVolumes}
        onTestLowBatteryNotification={onTestLowBatteryNotification}
        onTestControllerNotificationSound={onTestControllerNotificationSound}
      />
      <Dialog open={closeBehaviorDialogOpen} onOpenChange={setCloseBehaviorDialogOpen}>
        <DialogContent className="software-settings-dialog" data-no-drag>
          <DialogHeader>
            <DialogTitle>{t("softwareSettings.closeBehaviorPromptTitle")}</DialogTitle>
            <DialogDescription>{t("softwareSettings.closeBehaviorPromptDescription")}</DialogDescription>
          </DialogHeader>
          <div className="software-settings-option-actions close-behavior-actions">
            <Button type="button" variant="ghost" onClick={() => void chooseCloseBehavior(false)}>
              {t("softwareSettings.closeBehaviorExit")}
            </Button>
            <Button type="button" onClick={() => void chooseCloseBehavior(true)}>
              {t("softwareSettings.closeBehaviorTray")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
