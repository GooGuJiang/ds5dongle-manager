import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "../styles/tray-popup.css";

export function TrayPopup() {
  const { i18n, t } = useTranslation();
  const [batteries, setBatteries] = useState<string[]>([]);

  useEffect(() => {
    const refreshBatteries = () => {
      void invoke<string[]>("ds5_get_tray_batteries")
        .then(setBatteries)
        .catch(() => setBatteries([]));
    };

    refreshBatteries();
    const intervalId = window.setInterval(refreshBatteries, 1_000);
    const unlistenPromise = listen<string[]>("ds5-tray-batteries-changed", (event) => {
      setBatteries(event.payload);
    });

    return () => {
      window.clearInterval(intervalId);
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  useEffect(() => {
    const syncLanguage = () => {
      const storedLanguage = readStoredLanguage();
      if (storedLanguage && storedLanguage !== i18n.resolvedLanguage && storedLanguage !== i18n.language) {
        void i18n.changeLanguage(storedLanguage);
      }
    };

    syncLanguage();
    const intervalId = window.setInterval(syncLanguage, 500);
    window.addEventListener("storage", syncLanguage);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("storage", syncLanguage);
    };
  }, [i18n]);

  const batteryItems = useMemo(() => {
    return batteries.filter((battery) => battery.trim() && battery.trim() !== "--");
  }, [batteries]);

  const batteryText = batteryItems.join(" / ");

  const openMainWindow = () => {
    void invoke("ds5_open_main_window");
  };

  const hidePopup = () => {
    void invoke("ds5_hide_tray_popup");
  };

  const quitApp = () => {
    void invoke("ds5_quit_app");
  };

  return (
    <main className="tray-popup-shell">
      <nav className="tray-popup-menu" aria-label="DS5 Dongle Manager tray menu">
        {batteryItems.length > 0 && (
          <>
            <div className="tray-popup-status" title={batteryText}>
              <div className="tray-popup-status-title">{t("tray.batteryPrefix")}</div>
              <div className="tray-popup-battery-list">
                {batteryItems.slice(0, 2).map((battery, index) => (
                  <div className="tray-popup-battery-row" key={`${battery}-${index}`}>
                    <span>{battery.includes("：") ? battery.split("：").slice(0, -1).join("：") : `#${index + 1}`}</span>
                    <strong>{formatBatteryValue(battery)}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="tray-popup-separator" />
          </>
        )}
        <button className="tray-popup-item" type="button" onClick={openMainWindow}>{t("tray.openWindow")}</button>
        <button className="tray-popup-item" type="button" onClick={quitApp}>{t("tray.quit")}</button>
      </nav>
    </main>
  );
}

function formatBatteryValue(battery: string): string {
  if (!battery.includes("：")) {
    return battery;
  }

  const parts = battery.split("：");
  return parts[parts.length - 1] ?? battery;
}

function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem("i18nextLng");
  } catch {
    return null;
  }
}
