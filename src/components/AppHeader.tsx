import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeft, RefreshCw, RotateCcw, Settings, Sparkles } from "lucide-react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { VscChromeClose, VscChromeMaximize, VscChromeMinimize } from "react-icons/vsc";
import { Tooltip } from "react-tooltip";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { LanguageSwitcher } from "./LanguageSwitcher";
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

interface AppHeaderProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  pwaUpdateAvailable?: boolean;
  pwaUpdateVersion?: string;
  onPwaUpdateClick?: () => void;
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
  onTestLowBatteryNotification?: () => Promise<void>;
}

export function AppHeader({
  theme,
  onThemeChange,
  pwaUpdateAvailable = false,
  pwaUpdateVersion,
  onPwaUpdateClick,
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
  onTestLowBatteryNotification,
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
    void invoke<boolean>("ds5_get_close_to_tray").then(setCloseToTray).catch(() => undefined);
  }, []);

  const updateCloseToTray = (checked: boolean) => {
    setCloseToTray(checked);
    void invoke("ds5_set_close_to_tray", { closeToTray: checked }).catch(() => setCloseToTray(!checked));
  };

  const updateLowBatteryNotification = (checked: boolean) => {
    void onLowBatteryNotificationEnabledChange?.(checked);
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
          {pwaUpdateAvailable && (
            <button
              type="button"
              className="brand-update-button"
              onClick={onPwaUpdateClick}
              aria-label={t("app.updateAvailable", { version: pwaUpdateVersion })}
              data-tooltip-id="header-device-actions-tooltip"
              data-tooltip-content={t("app.updateAvailable", { version: pwaUpdateVersion })}
              data-tooltip-place="bottom"
            >
              <Sparkles size={15} aria-hidden="true" />
              <span>{t("app.updateBadge", { version: pwaUpdateVersion })}</span>
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
            void appWindow.close();
          }}
          aria-label="Close"
          title="Close"
        >
          <VscChromeClose aria-hidden="true" />
        </button>
      </div>
      <div ref={tooltipPortalRef} />
      <Tooltip id="header-device-actions-tooltip" place="bottom" positionStrategy="fixed" portalRoot={tooltipPortalRoot} />
      <Dialog open={softwareSettingsOpen} onOpenChange={setSoftwareSettingsOpen}>
        <DialogContent className="software-settings-dialog" data-no-drag>
          <DialogHeader>
            <DialogTitle>{t("softwareSettings.title")}</DialogTitle>
            <DialogDescription>{t("softwareSettings.description")}</DialogDescription>
          </DialogHeader>
          <div className="software-settings-option">
            <div>
              <strong>{t("softwareSettings.closeToTray")}</strong>
              <p>{t("softwareSettings.closeToTrayDescription")}</p>
            </div>
            <Switch checked={closeToTray} onCheckedChange={updateCloseToTray} aria-label={t("softwareSettings.closeToTray")} />
          </div>
          <div className="software-settings-option">
            <div>
              <strong>{t("softwareSettings.lowBatteryNotification")}</strong>
              <p>{t("softwareSettings.lowBatteryNotificationDescription")}</p>
            </div>
            <div className="software-settings-option-actions">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void onTestLowBatteryNotification?.()}
                disabled={!lowBatteryNotificationEnabled}
              >
                {t("softwareSettings.testNotification")}
              </Button>
              <Switch
                checked={lowBatteryNotificationEnabled}
                onCheckedChange={updateLowBatteryNotification}
                aria-label={t("softwareSettings.lowBatteryNotification")}
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </header>
  );
}
