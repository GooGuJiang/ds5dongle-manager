import { Info, Settings } from "lucide-react";
import { FaGithub } from "react-icons/fa";
import { useTranslation } from "react-i18next";
import {
  APP_METADATA,
  SETTINGS_SIDEBAR_PROVIDER_STYLE,
  type AppView,
} from "@/appConfig";
import { ConfigPanel } from "@/components/ConfigPanel";
import { SidebarDeviceCard } from "@/components/SidebarDeviceCard";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { FirmwareUpdateCheckResult } from "@/lib/firmwareRelease";
import type { UseDs5BridgeResult } from "@/hooks/useDs5Bridge";

const SETTINGS_NAV_ITEMS = [
  { icon: Settings, labelKey: "settings.nav.settings", view: "settings" },
  { icon: Info, labelKey: "settings.nav.about", view: "about" },
] as const satisfies ReadonlyArray<{
  icon: typeof Settings;
  labelKey: string;
  view: Exclude<AppView, "home">;
}>;

interface SettingsViewProps {
  bridge: UseDs5BridgeResult;
  firmwareUpdateResult: FirmwareUpdateCheckResult | null;
  sidebarOpen: boolean;
  view: AppView;
  onFirmwareUpdateClick: () => void;
  onProgressComplete: () => void;
  onSelectDevice: (device: HIDDevice) => Promise<void>;
  onSidebarOpenChange: (open: boolean) => void;
  onViewChange: (view: AppView) => void;
}

export function SettingsView({
  bridge,
  firmwareUpdateResult,
  sidebarOpen,
  view,
  onFirmwareUpdateClick,
  onProgressComplete,
  onSelectDevice,
  onSidebarOpenChange,
  onViewChange,
}: SettingsViewProps) {
  const { t } = useTranslation();

  return (
    <SidebarProvider className="settings-page" style={SETTINGS_SIDEBAR_PROVIDER_STYLE} open={sidebarOpen} onOpenChange={onSidebarOpenChange}>
      <Sidebar className="settings-sidebar" collapsible="icon" aria-label={t("settings.navigation")}>
        <SidebarContent className="settings-sidebar-content">
          <SidebarDeviceCard
            authorizedDevices={bridge.authorizedDevices}
            authorizedDeviceBatteryText={bridge.authorizedDeviceBatteryText}
            authorizedDeviceFirmwareVersion={bridge.authorizedDeviceFirmwareVersion}
            authorizedDeviceSignalStrength={bridge.authorizedDeviceSignalStrength}
            connectedDevice={bridge.client?.device ?? null}
            deviceLabel={bridge.deviceLabel}
            batteryText={bridge.batteryText}
            firmwareVersion={bridge.firmwareVersion}
            signalStrength={bridge.signalStrength}
            firmwareUpdateAvailable={Boolean(firmwareUpdateResult?.updateAvailable)}
            firmwareUpdateVersion={firmwareUpdateResult?.latestRelease.tagName}
            onFirmwareUpdateClick={onFirmwareUpdateClick}
            onSelectDevice={onSelectDevice}
          />
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {SETTINGS_NAV_ITEMS.map((item) => {
                  const label = t(item.labelKey);

                  return (
                    <SidebarMenuItem key={item.labelKey}>
                      <SidebarMenuButton type="button" isActive={view === item.view} tooltip={label} onClick={() => onViewChange(item.view)}>
                        <item.icon />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarTrigger className="settings-sidebar-trigger" />
      </Sidebar>

      <SidebarInset className="settings-detail">
        <div key={view} className="settings-view-transition">
          {view === "settings" ? (
            <ConfigPanel bridge={bridge} onProgressComplete={onProgressComplete} />
          ) : (
            <section className="panel about-panel" aria-labelledby="about-title">
              <div className="panel-title about-panel-title">
                <Info size={18} />
                <h2 id="about-title">{t("about.title")}</h2>
              </div>

              <div className="about-info-grid">
                <a className="config-section about-github-card" href={APP_METADATA.githubUrl} target="_blank" rel="noreferrer">
                  <FaGithub aria-hidden="true" />
                  <span>
                    <span className="about-info-label">{t("about.github")}</span>
                    <strong>{APP_METADATA.githubUrl}</strong>
                  </span>
                </a>
              </div>
            </section>
          )}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
