import type { CSSProperties } from "react";
import packageJson from "../package.json";

export type AppView = "home" | "settings" | "about";

export const APP_METADATA = {
  version: packageJson.version,
  githubRepo: "GooGuJiang/ds5dongle-manager",
  githubUrl: "https://github.com/GooGuJiang/ds5dongle-manager",
  firmwareGithubRepo: "awalol/DS5Dongle",
  firmwareGithubUrl: "https://github.com/awalol/DS5Dongle",
  firmwareUpdateApiUrl: "https://ds5-update.g0v0.top/api/firmware/update",
  softwareUpdateApiUrl: "https://ds5-update.g0v0.top/api/software/update",
} as const;

export const APP_TOAST_OPTIONS = {
  className: "app-toast",
  duration: 4200,
  style: {
    background: "var(--card)",
    color: "var(--card-foreground)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "0 16px 42px rgba(16, 24, 40, 0.12)",
  },
  error: {
    iconTheme: {
      primary: "var(--destructive)",
      secondary: "var(--card)",
    },
  },
} as const;

export const SETTINGS_SIDEBAR_PROVIDER_STYLE = {
  "--sidebar-width": "300px",
  "--sidebar-width-icon": "80px",
} as CSSProperties;

export const SETTINGS_SIDEBAR_AUTO_COLLAPSE_QUERY = "(max-width: 1120px)";
