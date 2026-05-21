import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition, LogicalSize, currentMonitor } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
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
import "../styles/controller-notification-popup.css";

interface ControllerNotificationPayload {
  kind: "connected" | "disconnected" | "lowBattery";
  deviceLabel: string;
  iconSrc: string;
  batteryText: string;
  batteryTexts?: string[];
  durationMs?: number;
}

const FALLBACK_PAYLOAD: ControllerNotificationPayload = {
  kind: "connected",
  deviceLabel: "DualSense Controller",
  iconSrc: "/svg/ps5-controller-gamepad-seeklogo.svg",
  batteryText: "--",
  batteryTexts: [],
};

const FINAL_WIDTH = 284;
const HEIGHT = 82;
const MARGIN_RIGHT = 18;
const MARGIN_TOP = 18;
const COLLAPSED_WIDTH = 1;
const ANIMATION_MS = 130;
const VISIBLE_MS = 4_000;
const WINDOW_ANIMATION_STEPS = 5;
const THEME_STORAGE_KEY = "ds5bridge-theme";
const THEME_QUERY = "(prefers-color-scheme: dark)";

export function ControllerNotificationPopup() {
  const { i18n, t } = useTranslation();
  const [payload, setPayload] = useState<ControllerNotificationPayload>(FALLBACK_PAYLOAD);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  const animationTokenRef = useRef(0);

  useEffect(() => {
    const syncSettings = () => {
      applyStoredTheme();
      syncStoredLanguage(i18n);
    };

    syncSettings();
    const mediaQuery = window.matchMedia(THEME_QUERY);
    const intervalId = window.setInterval(syncSettings, 500);
    mediaQuery.addEventListener("change", syncSettings);
    window.addEventListener("storage", syncSettings);

    return () => {
      window.clearInterval(intervalId);
      mediaQuery.removeEventListener("change", syncSettings);
      window.removeEventListener("storage", syncSettings);
    };
  }, [i18n]);

  useEffect(() => {
    const unlistenPromise = listen<ControllerNotificationPayload>("ds5-controller-notification", (event) => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }

      setPayload(normalizePayload(event.payload));
      const animationToken = animationTokenRef.current + 1;
      animationTokenRef.current = animationToken;
      setVisible(true);
      void prepareInputSafeWindow().then(() => animateWindowWidth(FINAL_WIDTH, animationToken, animationTokenRef));

      hideTimerRef.current = window.setTimeout(() => {
        const hideToken = animationTokenRef.current + 1;
        animationTokenRef.current = hideToken;
        setVisible(false);
        void animateWindowWidth(COLLAPSED_WIDTH, hideToken, animationTokenRef).then(() => {
          if (animationTokenRef.current === hideToken) {
            void invoke("ds5_hide_controller_notification").catch(() => undefined);
          }
        });
      }, normalizeDurationMs(event.payload?.durationMs));
    });

    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  const batteryItems = normalizeBatteryItems(payload);
  const showBattery = batteryItems.length > 0;

  return (
    <main className="controller-notification-shell" aria-live="polite">
      <section
        className={`controller-notification-card ${visible ? "is-visible" : ""}`}
      >
        <img
          className="controller-notification-controller-icon"
          src={payload.iconSrc || FALLBACK_PAYLOAD.iconSrc}
          alt=""
          aria-hidden="true"
          draggable={false}
        />
        <div className="controller-notification-content">
          <strong className="controller-notification-title">
            {t(payload.kind === "lowBattery" ? "controllerNotification.lowBattery" : payload.kind === "disconnected" ? "controllerNotification.disconnected" : "controllerNotification.connected")}
          </strong>
          {showBattery && (
            <div className="controller-notification-battery-list">
              {batteryItems.map((battery, index) => (
                <span
                  className="controller-notification-battery"
                  data-battery-level={batteryLevelState(battery)}
                  key={`${battery}-${index}`}
                >
                  <BatteryIcon batteryText={battery} />
                  <span>{formatBatteryValue(battery)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

async function animateWindowWidth(targetWidth: number, token: number, tokenRef: RefObject<number>) {
  const win = getCurrentWindow();
  const monitor = await currentMonitor();

  if (!monitor) {
    return;
  }

  const scaleFactor = await win.scaleFactor().catch(() => 1);
  const startSize = await win.innerSize().catch(() => ({ width: COLLAPSED_WIDTH, height: HEIGHT }));
  const startWidth = Math.max(COLLAPSED_WIDTH, Math.round(startSize.width / scaleFactor));
  const screenX = monitor.position.x / scaleFactor;
  const screenY = monitor.position.y / scaleFactor;
  const screenW = monitor.size.width / scaleFactor;
  const right = screenX + screenW - MARGIN_RIGHT;
  const top = screenY + MARGIN_TOP;
  const start = performance.now();
  let previousWidth = startWidth;

  await win.setSize(new LogicalSize(startWidth, HEIGHT));
  await win.setPosition(new LogicalPosition(right - startWidth, top));
  await win.show();

  return new Promise<void>((resolve) => {
    const frame = (now: number) => {
      if (tokenRef.current !== token) {
        resolve();
        return;
      }

      const progress = Math.min((now - start) / ANIMATION_MS, 1);

      const step = progress >= 1 ? WINDOW_ANIMATION_STEPS : Math.floor(progress * WINDOW_ANIMATION_STEPS);
      const steppedProgress = step / WINDOW_ANIMATION_STEPS;
      const eased = easeOutQuint(steppedProgress);
      const width = Math.max(COLLAPSED_WIDTH, Math.round(startWidth + (targetWidth - startWidth) * eased));

      if (progress < 1 && width === previousWidth) {
        window.requestAnimationFrame(frame);
        return;
      }

      previousWidth = width;
      void Promise.all([
        win.setSize(new LogicalSize(width, HEIGHT)),
        win.setPosition(new LogicalPosition(right - width, top)),
      ]);

      if (progress < 1) {
        window.requestAnimationFrame(frame);
      } else {
        resolve();
      }
    };

    window.requestAnimationFrame(frame);
  });
}

async function prepareInputSafeWindow() {
  const win = getCurrentWindow();

  await Promise.all([
    invoke("ds5_make_controller_notification_input_safe").catch(() => undefined),
    win.setFocusable(false).catch(() => undefined),
    win.setIgnoreCursorEvents(true).catch(() => undefined),
  ]);
}

function easeOutQuint(value: number): number {
  return 1 - Math.pow(1 - value, 5);
}

function applyStoredTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  const mode = storedTheme === "light" || storedTheme === "dark" || storedTheme === "system" ? storedTheme : "system";
  const resolvedTheme = mode === "system"
    ? (window.matchMedia(THEME_QUERY).matches ? "dark" : "light")
    : mode;

  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = resolvedTheme;
}

function normalizePayload(payload: ControllerNotificationPayload | null | undefined): ControllerNotificationPayload {
  return {
    kind: payload?.kind === "lowBattery" ? "lowBattery" : payload?.kind === "disconnected" ? "disconnected" : "connected",
    deviceLabel: payload?.deviceLabel?.trim() || FALLBACK_PAYLOAD.deviceLabel,
    iconSrc: payload?.iconSrc?.trim() || FALLBACK_PAYLOAD.iconSrc,
    batteryText: payload?.batteryText?.trim() || "--",
    batteryTexts: payload?.batteryTexts ?? [],
    durationMs: normalizeDurationMs(payload?.durationMs),
  };
}

function normalizeDurationMs(durationMs: number | null | undefined): number {
  return Number.isFinite(durationMs) ? Math.max(2_000, Math.min(15_000, Number(durationMs))) : VISIBLE_MS;
}

function syncStoredLanguage(i18n: ReturnType<typeof useTranslation>["i18n"]) {
  const storedLanguage = localStorage.getItem("i18nextLng");

  if (storedLanguage && storedLanguage !== i18n.resolvedLanguage && storedLanguage !== i18n.language) {
    void i18n.changeLanguage(storedLanguage);
  }
}

function normalizeBatteryItems(payload: ControllerNotificationPayload): string[] {
  const values = payload.batteryTexts?.length ? payload.batteryTexts : splitBatteryText(payload.batteryText);
  const normalized = values
    .flatMap(splitBatteryText)
    .map((item) => item.trim())
    .filter((item) => item && item !== "--");

  return normalized.slice(0, 4);
}

function splitBatteryText(value: string): string[] {
  return value.split(/[\/|\n\r]+/).map((item) => item.trim()).filter(Boolean);
}

function formatBatteryValue(battery: string): string {
  const parts = battery.split("：");
  const value = parts[parts.length - 1]?.trim() || battery.trim();
  const percent = Number.parseInt(value, 10);

  if (Number.isNaN(percent)) {
    return value;
  }

  return `${Math.min(Math.max(percent, 0), 100)}%`;
}

function BatteryIcon({ batteryText }: { batteryText: string }) {
  const level = batteryLevelFromText(batteryText);
  const iconProps = { size: 22, className: "controller-notification-battery-icon", focusable: false } as const;

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
  const value = Number.parseInt(formatBatteryValue(text), 10);

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
