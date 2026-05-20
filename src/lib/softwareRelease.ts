import { invoke } from "@tauri-apps/api/core";
import { APP_METADATA } from "../appConfig";

const UNKNOWN_VERSION = "--";
const SOFTWARE_UPDATE_CACHE_PREFIX = "software-update-cache:";
const SOFTWARE_UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SOFTWARE_UPDATE_TIMEOUT_MS = import.meta.env.DEV ? 30_000 : 15_000;

export interface SoftwareReleaseAsset {
  name: string;
  downloadUrl: string;
}

export interface SoftwareLocalizedBlock {
  title: string;
  summary: string;
  highlights: string[];
  upgradeNotice: string;
}

export interface SoftwareLocalizedNotes {
  zh_CN: SoftwareLocalizedBlock;
  en_US: SoftwareLocalizedBlock;
  aiGenerated?: boolean;
}

export interface SoftwareReleaseInfo {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  commitSha: string | null;
  assets: SoftwareReleaseAsset[];
  localizedNotes?: SoftwareLocalizedNotes;
}

export interface SoftwareUpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  currentRelease: SoftwareReleaseInfo | null;
  latestRelease: SoftwareReleaseInfo;
}

export interface SoftwareSystemInfo {
  os: "windows" | "macos" | "linux" | string;
  arch: "x86_64" | "aarch64" | string;
}

export interface RecommendedSoftwareAsset extends SoftwareReleaseAsset {
  priority: number;
  kind: string;
}

export async function checkSoftwareUpdate(signal?: AbortSignal): Promise<SoftwareUpdateCheckResult | null> {
  const currentVersion = normalizeSoftwareVersion(APP_METADATA.version);

  if (!shouldCheckSoftwareUpdate(currentVersion)) {
    return null;
  }

  const cachedResult = readCachedSoftwareUpdate(currentVersion);

  if (cachedResult) {
    void refreshSoftwareUpdateCache(currentVersion);
    return cachedResult;
  }

  return fetchSoftwareUpdate(currentVersion, signal);
}

export function shouldCheckSoftwareUpdate(currentVersion = APP_METADATA.version): boolean {
  return Boolean(
    typeof window !== "undefined" &&
      navigator.onLine &&
      currentVersion &&
      currentVersion.trim() !== "" &&
      currentVersion.trim() !== UNKNOWN_VERSION,
  );
}

export async function getSoftwareSystemInfo(): Promise<SoftwareSystemInfo> {
  try {
    return await invoke<SoftwareSystemInfo>("ds5_get_system_info");
  } catch {
    return inferBrowserSystemInfo();
  }
}

export function selectRecommendedSoftwareAssets(
  assets: SoftwareReleaseAsset[],
  systemInfo: SoftwareSystemInfo | null,
): RecommendedSoftwareAsset[] {
  const scored = assets
    .map((asset) => scoreSoftwareAsset(asset, systemInfo))
    .filter((asset): asset is RecommendedSoftwareAsset => asset.priority > 0)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));

  return scored.length > 0 ? scored : assets.map((asset) => ({ ...asset, priority: 1, kind: "package" }));
}

function softwareUpdateUrl(currentVersion: string): string {
  const url = new URL(APP_METADATA.softwareUpdateApiUrl);
  url.searchParams.set("currentVersion", currentVersion);
  return url.toString();
}

async function fetchSoftwareUpdate(currentVersion: string, signal?: AbortSignal): Promise<SoftwareUpdateCheckResult> {
  const result = await fetchJson<SoftwareUpdateCheckResult>(softwareUpdateUrl(currentVersion), mergeWithTimeout(signal));
  writeCachedSoftwareUpdate(currentVersion, result);
  return result;
}

function refreshSoftwareUpdateCache(currentVersion: string): void {
  if (!navigator.onLine) {
    return;
  }

  void fetchSoftwareUpdate(currentVersion).catch((error) => {
    console.debug("Software update cache refresh failed", error);
  });
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Software update check failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function scoreSoftwareAsset(asset: SoftwareReleaseAsset, systemInfo: SoftwareSystemInfo | null): RecommendedSoftwareAsset {
  const name = asset.name.toLowerCase();
  const os = systemInfo?.os ?? inferBrowserSystemInfo().os;
  const arch = systemInfo?.arch ?? inferBrowserSystemInfo().arch;
  let priority = 0;
  let kind = "package";

  if (os === "windows" && /\.(msi|exe)$/.test(name)) {
    priority = name.endsWith(".msi") ? 90 : 80;
    kind = name.endsWith(".msi") ? "msi" : "setup";
  } else if (os === "macos" && /\.(dmg|app\.tar\.gz)$/.test(name)) {
    priority = name.endsWith(".dmg") ? 90 : 70;
    kind = name.endsWith(".dmg") ? "dmg" : "app archive";
  } else if (os === "linux" && /\.(appimage|deb|rpm)$/.test(name)) {
    priority = name.endsWith(".appimage") ? 90 : name.endsWith(".deb") ? 80 : 70;
    kind = name.endsWith(".appimage") ? "appimage" : name.endsWith(".deb") ? "deb" : "rpm";
  }

  if (priority > 0 && isAssetArchitectureMatch(name, arch)) {
    priority += 10;
  }

  return { ...asset, priority, kind };
}

function isAssetArchitectureMatch(name: string, arch: string): boolean {
  if (arch === "aarch64" || arch === "arm64") {
    return name.includes("aarch64") || name.includes("arm64");
  }

  if (arch === "x86_64" || arch === "x64" || arch === "amd64") {
    return name.includes("x64") || name.includes("x86_64") || name.includes("amd64");
  }

  return false;
}

function inferBrowserSystemInfo(): SoftwareSystemInfo {
  const platform = navigator.platform.toLowerCase();
  const userAgent = navigator.userAgent.toLowerCase();

  if (platform.includes("win") || userAgent.includes("windows")) {
    return { os: "windows", arch: "x86_64" };
  }

  if (platform.includes("mac") || userAgent.includes("mac os")) {
    return { os: "macos", arch: userAgent.includes("arm") ? "aarch64" : "x86_64" };
  }

  return { os: "linux", arch: userAgent.includes("aarch64") || userAgent.includes("arm64") ? "aarch64" : "x86_64" };
}

function normalizeSoftwareVersion(version: string): string {
  const normalized = version.trim();

  if (/^\d+\.\d+\.\d+/.test(normalized)) {
    return `v${normalized}`;
  }

  return normalized;
}

function cacheKey(currentVersion: string): string {
  return `${SOFTWARE_UPDATE_CACHE_PREFIX}${currentVersion}`;
}

function readCachedSoftwareUpdate(currentVersion: string): SoftwareUpdateCheckResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(currentVersion));

    if (!raw) {
      return null;
    }

    const cached = JSON.parse(raw) as { savedAt?: number; result?: SoftwareUpdateCheckResult };

    if (!cached.savedAt || !cached.result || Date.now() - cached.savedAt > SOFTWARE_UPDATE_CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(currentVersion));
      return null;
    }

    return cached.result;
  } catch {
    return null;
  }
}

function writeCachedSoftwareUpdate(currentVersion: string, result: SoftwareUpdateCheckResult): void {
  try {
    localStorage.setItem(cacheKey(currentVersion), JSON.stringify({ savedAt: Date.now(), result }));
  } catch {
    // Ignore storage quota or private-mode failures; the live response is still usable.
  }
}

function mergeWithTimeout(signal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SOFTWARE_UPDATE_TIMEOUT_MS);

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
  }

  controller.signal.addEventListener("abort", () => window.clearTimeout(timeoutId), { once: true });
  return controller.signal;
}
