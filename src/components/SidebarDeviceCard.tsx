import { useEffect, useRef, useState } from "react";
import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { BatteryFull, ChevronRight, CircleAlert, CircleArrowUp, LoaderCircle, Radio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getControllerIconSrc, getDeviceKey, getDeviceLabel } from "@/protocol/ds5BridgeHid";

interface SidebarDeviceCardProps {
  authorizedDevices: HIDDevice[];
  authorizedDeviceBatteryText: Record<string, string>;
  authorizedDeviceFirmwareVersion: Record<string, string>;
  authorizedDeviceSignalStrength: Record<string, string>;
  connectedDevice: HIDDevice | null;
  deviceLabel: string;
  batteryText: string;
  firmwareVersion: string;
  signalStrength: string;
  firmwareUpdateAvailable?: boolean;
  firmwareUpdateVersion?: string;
  onFirmwareUpdateClick?: () => void;
  onSelectDevice: (device: HIDDevice) => Promise<void> | void;
}

export function SidebarDeviceCard({
  authorizedDevices,
  authorizedDeviceBatteryText,
  authorizedDeviceFirmwareVersion,
  authorizedDeviceSignalStrength,
  connectedDevice,
  deviceLabel,
  batteryText,
  firmwareVersion,
  signalStrength,
  firmwareUpdateAvailable = false,
  firmwareUpdateVersion,
  onFirmwareUpdateClick,
  onSelectDevice,
}: SidebarDeviceCardProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isPopoverMounted, setIsPopoverMounted] = useState(false);
  const popoverCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [deviceName] = deviceLabel.split(" · ");
  const isSignalLoading = isLoadingValue(signalStrength);
  const isFirmwareLoading = isLoadingValue(firmwareVersion);
  const connectedDeviceKey = connectedDevice ? getDeviceKey(connectedDevice) : null;
  const connectedDeviceIconSrc = getControllerIconSrc(connectedDevice);
  const visibleDevices = connectedDevice && !authorizedDevices.some((device) => getDeviceKey(device) === connectedDeviceKey)
    ? [connectedDevice, ...authorizedDevices]
    : authorizedDevices;
  const popoverDevices = visibleDevices.map((device) => {
    const key = getDeviceKey(device);
    const active = key === connectedDeviceKey;
    const [label] = getDeviceLabel(device).split(" · ");

    return {
      key,
      label: active ? deviceName : label,
      batteryText: active ? batteryText : authorizedDeviceBatteryText[key] ?? "--",
      firmwareVersion: active ? firmwareVersion : authorizedDeviceFirmwareVersion[key] ?? "--",
      signalStrength: active ? signalStrength : authorizedDeviceSignalStrength[key] ?? "--",
      iconSrc: getControllerIconSrc(device),
      active,
      device: active ? null : device,
    };
  });
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "right-start",
    middleware: [offset({ mainAxis: 24, crossAxis: 0 }), flip(), shift({ padding: 10 })],
    whileElementsMounted: autoUpdate,
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: "dialog" });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  useEffect(() => {
    if (popoverCloseTimerRef.current) {
      window.clearTimeout(popoverCloseTimerRef.current);
      popoverCloseTimerRef.current = null;
    }

    if (isOpen) {
      setIsPopoverMounted(true);
      return;
    }

    popoverCloseTimerRef.current = window.setTimeout(() => {
      setIsPopoverMounted(false);
      popoverCloseTimerRef.current = null;
    }, 160);

    return () => {
      if (popoverCloseTimerRef.current) {
        window.clearTimeout(popoverCloseTimerRef.current);
        popoverCloseTimerRef.current = null;
      }
    };
  }, [isOpen]);

  return (
    <>
      <button ref={refs.setReference} type="button" className="settings-device-card-trigger" {...getReferenceProps()}>
        <span className="settings-device-card-icon" aria-hidden="true">
          <img src={connectedDeviceIconSrc} alt="" draggable={false} />
        </span>
        <span className="settings-device-card-copy">
          <span className="settings-device-card-title-row">
            <strong>{deviceName}</strong>
          </span>
          <span className="settings-device-card-meta">
            <span>
              <BatteryFull size={15} aria-hidden="true" />
              <em>{t("device.battery", { battery: batteryText })}</em>
            </span>
            <span>
              {isSignalLoading ? <LoaderCircle className="settings-device-card-loading-icon" size={15} aria-hidden="true" /> : <Radio size={15} aria-hidden="true" />}
              <em>{t("device.signalStrength", { signal: signalStrength })}</em>
            </span>
            <span>
              {isFirmwareLoading ? <LoaderCircle className="settings-device-card-loading-icon" size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
              <em>{t("device.firmwareVersion", { version: firmwareVersion })}</em>
              {firmwareUpdateAvailable && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        role="button"
                        tabIndex={0}
                        className="settings-device-card-update"
                        aria-label={t("device.firmwareUpdateAvailable", { version: firmwareUpdateVersion })}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setIsOpen(false);
                          onFirmwareUpdateClick?.();
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") {
                            return;
                          }

                          event.preventDefault();
                          event.stopPropagation();
                          setIsOpen(false);
                          onFirmwareUpdateClick?.();
                        }}
                      >
                        <CircleArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                      {t("device.firmwareUpdateAvailable", { version: firmwareUpdateVersion })}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </span>
          </span>
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>

      <FloatingPortal>
        {isPopoverMounted && (
          <Card ref={refs.setFloating} className="settings-device-popover" data-state={isOpen ? "open" : "closed"} style={floatingStyles} {...getFloatingProps()}>
            <CardContent className="settings-device-popover-content">
              <div className="settings-device-popover-head">
                <strong>{t("device.selectDevice")}</strong>
                <span>{t("device.authorizedList")}</span>
              </div>
              <div className="settings-device-popover-list">
                {popoverDevices.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`settings-device-popover-item ${item.active ? "is-active" : ""}`}
                    onClick={() => {
                      if (item.device) {
                        void onSelectDevice(item.device);
                      }
                      setIsOpen(false);
                    }}
                    >
                    <span className="settings-device-popover-preview" aria-hidden="true">
                      <img src={item.iconSrc} alt="" draggable={false} />
                    </span>
                    <span className="settings-device-popover-info">
                      <strong>{item.label}</strong>
                      <span className="settings-device-popover-row">
                        {isLoadingValue(item.firmwareVersion) ? <LoaderCircle className="settings-device-card-loading-icon" size={15} aria-hidden="true" /> : <CircleAlert size={15} aria-hidden="true" />}
                        <span>{t("device.firmwareVersion", { version: item.firmwareVersion })}</span>
                      </span>
                      <span className="settings-device-popover-row">
                        {isLoadingValue(item.signalStrength) ? <LoaderCircle className="settings-device-card-loading-icon" size={15} aria-hidden="true" /> : <Radio size={15} aria-hidden="true" />}
                        <span>{t("device.signalStrength", { signal: item.signalStrength })}</span>
                      </span>
                      <span className="settings-device-popover-row">
                        <BatteryFull size={15} aria-hidden="true" />
                        <span>{t("device.battery", { battery: item.batteryText })}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </FloatingPortal>
    </>
  );
}

function isLoadingValue(value: string): boolean {
  return value.trim() === "--";
}
