import { memo, useCallback, useMemo, type KeyboardEvent } from "react";
import { CircleAlert, Radio } from "lucide-react";
import {
  MdBattery0Bar,
  MdBattery1Bar,
  MdBattery2Bar,
  MdBattery3Bar,
  MdBattery4Bar,
  MdBattery5Bar,
  MdBattery6Bar,
  MdBatteryFull,
} from "react-icons/md";
import { useTranslation } from "react-i18next";
import { Oval } from "react-loader-spinner";
import { Tooltip } from "react-tooltip";
import { Card, CardContent } from "@/components/ui/card";
import { getDeviceKey, getDeviceLabel } from "@/protocol/ds5BridgeHid";

interface DeviceStripProps {
  authorizedDevices: HIDDevice[];
  authorizedDeviceSerialNumber: Record<string, string>;
  authorizedDeviceBatteryText: Record<string, string>;
  authorizedDeviceFirmwareVersion: Record<string, string>;
  authorizedDeviceSignalStrength: Record<string, string>;
  client: { device: HIDDevice } | null;
  batteryText: string;
  firmwareVersion: string;
  signalStrength: string;
  deviceSerialNumber: string;
  deviceLabel: string;
  isBusy: boolean;
  supported: boolean;
  onConnectAuthorized: (device: HIDDevice) => Promise<void> | void;
  onOpenSettings: () => void;
}

export const DeviceStrip = memo(function DeviceStrip({
  authorizedDevices,
  authorizedDeviceSerialNumber,
  authorizedDeviceBatteryText,
  authorizedDeviceFirmwareVersion,
  authorizedDeviceSignalStrength,
  client,
  batteryText,
  firmwareVersion,
  signalStrength,
  deviceSerialNumber,
  deviceLabel,
  isBusy,
  supported,
  onConnectAuthorized,
  onOpenSettings,
}: DeviceStripProps) {
  const { t } = useTranslation();
  const connectedDeviceKey = useMemo(() => client ? getDeviceKey(client.device) : null, [client]);
  const pairedDevices = useMemo(() => {
    const connectedDevice = client
      ? [{ key: connectedDeviceKey ?? deviceLabel, label: deviceLabel, batteryText, firmwareVersion, signalStrength, serialNumber: deviceSerialNumber, connected: true, device: null }]
      : [];
    const authorizedDeviceCards = authorizedDevices
      .filter((device) => getDeviceKey(device) !== connectedDeviceKey)
      .map((device) => {
        const deviceKey = getDeviceKey(device);

        return {
          key: deviceKey,
          label: getDeviceLabel(device),
          batteryText: authorizedDeviceBatteryText[deviceKey] ?? "--",
          firmwareVersion: authorizedDeviceFirmwareVersion[deviceKey] ?? "--",
          signalStrength: authorizedDeviceSignalStrength[deviceKey] ?? "--",
          serialNumber: authorizedDeviceSerialNumber[deviceKey] ?? "--",
          connected: false,
          device,
        };
      });

    return [...connectedDevice, ...authorizedDeviceCards];
  }, [
    authorizedDeviceBatteryText,
    authorizedDeviceFirmwareVersion,
    authorizedDeviceSerialNumber,
    authorizedDeviceSignalStrength,
    authorizedDevices,
    batteryText,
    client,
    connectedDeviceKey,
    deviceLabel,
    deviceSerialNumber,
    firmwareVersion,
    signalStrength,
  ]);
  const hasPairedDevice = pairedDevices.length > 0;
  const hasMultiplePairedDevices = pairedDevices.length > 1;

  const openSettingsFromCard = useCallback(() => {
    if (client) {
      onOpenSettings();
    }
  }, [client, onOpenSettings]);

  const openSettingsFromKeyboard = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!client || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    onOpenSettings();
  }, [client, onOpenSettings]);

  const openAuthorizedDevice = useCallback(async (device: HIDDevice) => {
    if (!supported || isBusy) {
      return;
    }

    await onConnectAuthorized(device);
    onOpenSettings();
  }, [isBusy, onConnectAuthorized, onOpenSettings, supported]);

  const openAuthorizedDeviceFromKeyboard = useCallback((event: KeyboardEvent<HTMLDivElement>, device: HIDDevice) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    void openAuthorizedDevice(device);
  }, [openAuthorizedDevice]);

  return (
    <section className="device-stage" aria-label={t("device.label")}>
      <div className={`device-card-grid ${hasMultiplePairedDevices ? "has-multiple-devices" : ""}`}>
        {hasPairedDevice ? (
          pairedDevices.map((item) => {
            const [deviceName] = item.label.split(" · ");
            const isEdge = deviceName.includes("Edge");
            const controllerImage = isEdge
              ? { src: "/images/ps5-controller-edge.webp", width: 1240, height: 916 }
              : { src: "/svg/ps5-controller-gamepad-seeklogo.svg", width: undefined, height: undefined };
            return (
              <Card
                key={item.key}
                className={`device-strip-card connected is-clickable`}
                role="button"
                tabIndex={0}
                onClick={item.connected ? openSettingsFromCard : () => item.device && void openAuthorizedDevice(item.device)}
                onKeyDown={
                  item.connected
                    ? openSettingsFromKeyboard
                    : (event) => item.device && openAuthorizedDeviceFromKeyboard(event, item.device)
                }
              >
                <CardContent className="device-strip">
                  <div className="device-preview" aria-hidden="true">
                    <div className="device-hero connected-device-hero">
                      <img src={controllerImage.src} alt="" aria-hidden="true" draggable={false} width={controllerImage.width} height={controllerImage.height} />
                    </div>
                  </div>
                  <div className="device-info-panel">
                    <div>
                      <strong>
                        <span>{deviceName}</span>
                      </strong>
                      {!item.connected && <p>{t("device.selectToConnect")}</p>}
                    </div>
                    <div className="device-status-icons">
                      <span
                        className="device-meta-icon"
                        data-tooltip-id="device-info-tooltip"
                        data-tooltip-content={t("device.firmwareVersion", { version: item.firmwareVersion })}
                        data-tooltip-place="top"
                      >
                        <CircleAlert size={18} />
                      </span>
                      <span
                        className="device-meta-icon"
                        data-tooltip-id="device-info-tooltip"
                        data-tooltip-content={t("device.signalStrength", { signal: item.signalStrength })}
                        data-tooltip-place="top"
                      >
                        <Radio size={18} />
                      </span>
                      <span
                        className="device-battery"
                        data-battery-level={batteryLevelState(item.batteryText)}
                      >
                        <BatteryIcon batteryText={item.batteryText} />
                        <span>{item.batteryText}</span>
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card className="device-discovery-message" role="status" aria-live="polite">
            <CardContent className="device-discovery-content">
              <div className="device-discovery-loader" aria-hidden="true">
                <Oval
                  visible
                  height={72}
                  width={72}
                  color="currentColor"
                  secondaryColor="currentColor"
                  strokeWidth={3}
                  strokeWidthSecondary={3}
                  ariaLabel={t("device.autoDetect")}
                  wrapperClass="device-discovery-spinner"
                />
              </div>
              <strong>{t("device.autoDetect")}</strong>
              <p>{t("device.autoDetectHint")}</p>
            </CardContent>
          </Card>
        )}
      </div>
      {!supported && <p className="device-hint">{t("notice.webHidUnsupported")}</p>}
      <Tooltip id="device-info-tooltip" place="top" positionStrategy="fixed" />
    </section>
  );
});

function BatteryIcon({ batteryText }: { batteryText: string }) {
  const level = batteryLevelFromText(batteryText);
  const iconProps = { size: 22, className: "device-battery-icon", focusable: false } as const;

  if (level === null) {
    return <MdBattery0Bar {...iconProps} />;
  }

  if (level >= 95) {
    return <MdBatteryFull {...iconProps} />;
  }

  if (level >= 82) {
    return <MdBattery6Bar {...iconProps} />;
  }

  if (level >= 68) {
    return <MdBattery5Bar {...iconProps} />;
  }

  if (level >= 54) {
    return <MdBattery4Bar {...iconProps} />;
  }

  if (level >= 40) {
    return <MdBattery3Bar {...iconProps} />;
  }

  if (level >= 26) {
    return <MdBattery2Bar {...iconProps} />;
  }

  if (level >= 12) {
    return <MdBattery1Bar {...iconProps} />;
  }

  return <MdBattery0Bar {...iconProps} />;
}

function batteryLevelFromText(text: string): number | null {
  const value = Number.parseInt(text, 10);

  if (Number.isNaN(value)) {
    return null;
  }

  return Math.min(Math.max(value, 0), 100);
}

function batteryLevelState(text: string): "unknown" | "low" | "medium" | "high" {
  const level = batteryLevelFromText(text);

  if (level === null) {
    return "unknown";
  }

  if (level <= 20) {
    return "low";
  }

  if (level <= 60) {
    return "medium";
  }

  return "high";
}
