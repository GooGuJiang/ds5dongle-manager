import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, ChevronLeft, ChevronRight, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

type SettingsPage = "root" | "notifications";
type ControllerNotificationSound = "connected" | "disconnected" | "lowBattery";

export interface ControllerNotificationSoundVolumes {
  connected: number;
  disconnected: number;
  lowBattery: number;
}

interface SoftwareSettingsDialogProps {
  open: boolean;
  closeToTray: boolean;
  lowBatteryNotificationEnabled: boolean;
  controllerConnectionPopupEnabled: boolean;
  controllerLowBatteryPopupEnabled: boolean;
  controllerNotificationPopupDurationMs: number;
  controllerNotificationSoundEnabled: boolean;
  controllerNotificationSoundVolumes: ControllerNotificationSoundVolumes;
  onOpenChange: (open: boolean) => void;
  onCloseToTrayChange: (enabled: boolean) => void;
  onLowBatteryNotificationEnabledChange?: (enabled: boolean) => Promise<void>;
  onControllerConnectionPopupEnabledChange?: (enabled: boolean) => Promise<void>;
  onControllerLowBatteryPopupEnabledChange?: (enabled: boolean) => Promise<void>;
  onControllerNotificationPopupDurationMsChange?: (durationMs: number) => Promise<void>;
  onControllerNotificationSoundEnabledChange?: (enabled: boolean) => Promise<void>;
  onControllerNotificationSoundVolumeChange?: (sound: ControllerNotificationSound, volume: number) => Promise<void>;
  onResetControllerNotificationSoundVolumes?: () => Promise<void>;
  onTestLowBatteryNotification?: () => Promise<void>;
  onTestControllerNotificationSound?: (sound: ControllerNotificationSound) => Promise<void>;
}

export function SoftwareSettingsDialog({
  open,
  closeToTray,
  lowBatteryNotificationEnabled,
  controllerConnectionPopupEnabled,
  controllerLowBatteryPopupEnabled,
  controllerNotificationPopupDurationMs,
  controllerNotificationSoundEnabled,
  controllerNotificationSoundVolumes,
  onOpenChange,
  onCloseToTrayChange,
  onLowBatteryNotificationEnabledChange,
  onControllerConnectionPopupEnabledChange,
  onControllerLowBatteryPopupEnabledChange,
  onControllerNotificationPopupDurationMsChange,
  onControllerNotificationSoundEnabledChange,
  onControllerNotificationSoundVolumeChange,
  onResetControllerNotificationSoundVolumes,
  onTestLowBatteryNotification,
  onTestControllerNotificationSound,
}: SoftwareSettingsDialogProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState<SettingsPage>("root");
  const [localVolumes, setLocalVolumes] = useState(controllerNotificationSoundVolumes);
  const [localPopupDurationMs, setLocalPopupDurationMs] = useState(controllerNotificationPopupDurationMs);
  const volumeCommitTimersRef = useRef<Partial<Record<ControllerNotificationSound, number>>>({});
  const popupDurationCommitTimerRef = useRef<number | null>(null);
  const notificationEnabled = lowBatteryNotificationEnabled || controllerConnectionPopupEnabled || controllerLowBatteryPopupEnabled || controllerNotificationSoundEnabled;
  const popupDurationSeconds = Math.round(localPopupDurationMs / 1000);

  useEffect(() => {
    setLocalVolumes(controllerNotificationSoundVolumes);
  }, [controllerNotificationSoundVolumes]);

  useEffect(() => {
    setLocalPopupDurationMs(controllerNotificationPopupDurationMs);
  }, [controllerNotificationPopupDurationMs]);

  useEffect(() => {
    return () => {
      Object.values(volumeCommitTimersRef.current).forEach((timerId) => {
        if (typeof timerId === "number") {
          window.clearTimeout(timerId);
        }
      });
      if (popupDurationCommitTimerRef.current !== null) {
        window.clearTimeout(popupDurationCommitTimerRef.current);
      }
    };
  }, []);

  const updateSoundVolume = (sound: ControllerNotificationSound, value: number) => {
    const volume = value / 100;
    setLocalVolumes((current) => ({ ...current, [sound]: volume }));

    const previousTimer = volumeCommitTimersRef.current[sound];
    if (typeof previousTimer === "number") {
      window.clearTimeout(previousTimer);
    }

    volumeCommitTimersRef.current[sound] = window.setTimeout(() => {
      volumeCommitTimersRef.current[sound] = undefined;
      void onControllerNotificationSoundVolumeChange?.(sound, volume);
    }, 120);
  };

  const updatePopupDuration = (seconds: number) => {
    const durationMs = Math.max(2, Math.min(15, seconds)) * 1000;
    setLocalPopupDurationMs(durationMs);

    if (popupDurationCommitTimerRef.current !== null) {
      window.clearTimeout(popupDurationCommitTimerRef.current);
    }

    popupDurationCommitTimerRef.current = window.setTimeout(() => {
      popupDurationCommitTimerRef.current = null;
      void onControllerNotificationPopupDurationMsChange?.(durationMs);
    }, 160);
  };

  const soundControls = useMemo(
    () => [
      {
        sound: "connected" as const,
        label: t("softwareSettings.soundConnected"),
        volume: localVolumes.connected,
      },
      {
        sound: "disconnected" as const,
        label: t("softwareSettings.soundDisconnected"),
        volume: localVolumes.disconnected,
      },
      {
        sound: "lowBattery" as const,
        label: t("softwareSettings.soundLowBattery"),
        volume: localVolumes.lowBattery,
      },
    ],
    [localVolumes.connected, localVolumes.disconnected, localVolumes.lowBattery, t],
  );

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      window.setTimeout(() => setPage("root"), 180);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="software-settings-dialog" data-no-drag>
        {page === "root" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("softwareSettings.title")}</DialogTitle>
              <DialogDescription>{t("softwareSettings.description")}</DialogDescription>
            </DialogHeader>
            <div className="software-settings-page-stack">
              <div className="software-settings-option">
                <div>
                  <strong>{t("softwareSettings.closeToTray")}</strong>
                  <p>{t("softwareSettings.closeToTrayDescription")}</p>
                </div>
                <Switch checked={closeToTray} onCheckedChange={onCloseToTrayChange} aria-label={t("softwareSettings.closeToTray")} />
              </div>
              <button type="button" className="software-settings-entry" onClick={() => setPage("notifications")}>
                <span className="software-settings-entry-icon" aria-hidden="true">
                  <Bell size={18} />
                </span>
                <span className="software-settings-entry-copy">
                  <strong>{t("softwareSettings.notificationSettings")}</strong>
                  <small>{notificationEnabled ? t("softwareSettings.notificationSettingsEnabled") : t("softwareSettings.notificationSettingsDisabled")}</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="software-settings-subpage-header">
              <Button type="button" variant="ghost" size="icon-sm" className="software-settings-back-button" onClick={() => setPage("root")}>
                <ChevronLeft size={18} />
                <span className="sr-only">{t("softwareSettings.back")}</span>
              </Button>
              <div>
                <DialogTitle>{t("softwareSettings.notificationSettings")}</DialogTitle>
                <DialogDescription>{t("softwareSettings.notificationSettingsDescription")}</DialogDescription>
              </div>
            </DialogHeader>
            <div className="software-settings-page-stack">
              <div className="software-settings-option">
                <div>
                  <strong>{t("softwareSettings.lowBatteryNotification")}</strong>
                  <p>{t("softwareSettings.lowBatteryNotificationDescription")}</p>
                </div>
                <div className="software-settings-option-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="software-settings-test-notification-button"
                    onClick={() => void onTestLowBatteryNotification?.()}
                    disabled={!lowBatteryNotificationEnabled && !controllerNotificationSoundEnabled}
                  >
                    {t("softwareSettings.testNotification")}
                  </Button>
                  <Switch
                    checked={lowBatteryNotificationEnabled}
                    onCheckedChange={(checked) => void onLowBatteryNotificationEnabledChange?.(checked)}
                    aria-label={t("softwareSettings.lowBatteryNotification")}
                  />
                </div>
              </div>
              <div className="software-settings-option">
                <div>
                  <strong>{t("softwareSettings.controllerConnectionPopup")}</strong>
                  <p>{t("softwareSettings.controllerConnectionPopupDescription")}</p>
                </div>
                <Switch
                  checked={controllerConnectionPopupEnabled}
                  onCheckedChange={(checked) => void onControllerConnectionPopupEnabledChange?.(checked)}
                  aria-label={t("softwareSettings.controllerConnectionPopup")}
                />
              </div>
              <div className="software-settings-option">
                <div>
                  <strong>{t("softwareSettings.controllerLowBatteryPopup")}</strong>
                  <p>{t("softwareSettings.controllerLowBatteryPopupDescription")}</p>
                </div>
                <Switch
                  checked={controllerLowBatteryPopupEnabled}
                  onCheckedChange={(checked) => void onControllerLowBatteryPopupEnabledChange?.(checked)}
                  aria-label={t("softwareSettings.controllerLowBatteryPopup")}
                />
              </div>
              <div className="software-settings-option software-settings-option-column">
                <div className="software-settings-option-head">
                  <span>
                    <strong>{t("softwareSettings.controllerPopupDuration")}</strong>
                    <p>{t("softwareSettings.controllerPopupDurationDescription")}</p>
                  </span>
                  <span className="software-settings-duration-value">
                    {t("softwareSettings.controllerPopupDurationValue", { seconds: popupDurationSeconds })}
                  </span>
                </div>
                <Slider
                  min={2}
                  max={15}
                  step={1}
                  value={[popupDurationSeconds]}
                  onValueChange={([value]) => updatePopupDuration(value)}
                  aria-label={t("softwareSettings.controllerPopupDuration")}
                />
              </div>
              <div className="software-settings-option software-settings-option-column">
                <div className="software-settings-option-head">
                  <span>
                    <strong>{t("softwareSettings.controllerNotificationSound")}</strong>
                    <p>{t("softwareSettings.controllerNotificationSoundDescription")}</p>
                  </span>
                  <Switch
                    checked={controllerNotificationSoundEnabled}
                    onCheckedChange={(checked) => void onControllerNotificationSoundEnabledChange?.(checked)}
                    aria-label={t("softwareSettings.controllerNotificationSound")}
                  />
                </div>
                <div className="software-settings-sound-list" data-disabled={!controllerNotificationSoundEnabled}>
                  {soundControls.map((item) => (
                    <div className="software-settings-sound-row" key={item.sound}>
                      <div className="software-settings-sound-label">
                        <Volume2 size={16} aria-hidden="true" />
                        <strong>{item.label}</strong>
                        <span>{Math.round(item.volume * 100)}%</span>
                      </div>
                      <Slider
                        min={0}
                        max={100}
                        step={1}
                        value={[Math.round(item.volume * 100)]}
                        disabled={!controllerNotificationSoundEnabled}
                        onValueChange={([value]) => updateSoundVolume(item.sound, value)}
                        aria-label={item.label}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={!controllerNotificationSoundEnabled}
                        onClick={() => void onTestControllerNotificationSound?.(item.sound)}
                      >
                        {t("softwareSettings.testSound")}
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="software-settings-sound-footer">
                  <Button type="button" variant="outline" size="sm" onClick={() => void onResetControllerNotificationSoundVolumes?.()}>
                    {t("softwareSettings.resetSoundVolumes")}
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
