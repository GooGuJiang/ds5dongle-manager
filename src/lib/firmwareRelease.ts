import { APP_METADATA } from "../appConfig";

const UNKNOWN_VERSION = "--";
const FIRMWARE_UPDATE_CACHE_PREFIX = "firmware-update-cache:";
const FIRMWARE_UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FIRMWARE_UPDATE_TIMEOUT_MS = import.meta.env.DEV ? 30_000 : 15_000;

export interface FirmwareReleaseAsset {
  name: string;
  downloadUrl: string;
}

export interface FirmwareReleaseInfo {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  commitSha: string | null;
  assets: FirmwareReleaseAsset[];
  localizedNotes?: FirmwareLocalizedNotes;
}

export interface FirmwareUpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  currentRelease: FirmwareReleaseInfo | null;
  latestRelease: FirmwareReleaseInfo;
}

export interface FirmwareLocalizedNotes {
  zh_CN: FirmwareLocalizedBlock;
  en_US: FirmwareLocalizedBlock;
}

export interface FirmwareLocalizedBlock {
  title: string;
  summary: string;
  highlights: string[];
  upgradeNotice: string;
}

export async function checkFirmwareUpdate(currentVersion: string, signal?: AbortSignal): Promise<FirmwareUpdateCheckResult | null> {
  if (!shouldCheckFirmwareUpdate(currentVersion)) {
    return null;
  }

  const normalizedVersion = normalizeCurrentVersion(currentVersion);
  const cachedResult = readCachedFirmwareUpdate(normalizedVersion);

  if (cachedResult) {
    void refreshFirmwareUpdateCache(normalizedVersion);
    return cachedResult;
  }

  return fetchFirmwareUpdate(normalizedVersion, signal);
}

export function shouldCheckFirmwareUpdate(currentVersion: string): boolean {
  return Boolean(
    typeof window !== "undefined" &&
      navigator.onLine &&
      currentVersion &&
      currentVersion.trim() !== "" &&
      currentVersion.trim() !== UNKNOWN_VERSION,
  );
}

function firmwareUpdateUrl(currentVersion: string): string {
  const url = new URL(APP_METADATA.firmwareUpdateApiUrl);
  url.searchParams.set("currentVersion", currentVersion);
  return url.toString();
}

async function fetchFirmwareUpdate(currentVersion: string, signal?: AbortSignal): Promise<FirmwareUpdateCheckResult> {
  const result = await fetchJson<FirmwareUpdateCheckResult>(firmwareUpdateUrl(currentVersion), mergeWithTimeout(signal));
  writeCachedFirmwareUpdate(currentVersion, result);
  return result;
}

function refreshFirmwareUpdateCache(currentVersion: string): void {
  if (!navigator.onLine) {
    return;
  }

  void fetchFirmwareUpdate(currentVersion).catch((error) => {
    console.debug("Firmware update cache refresh failed", error);
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
    throw new Error(`Firmware update check failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function normalizeCurrentVersion(version: string): string {
  const normalized = version.trim();

  if (/^\d{3}$/.test(normalized)) {
    return `v${Number(normalized[0])}.${Number(normalized[1])}.${Number(normalized[2])}`;
  }

  if (/^\d+\.\d+\.\d+/.test(normalized)) {
    return `v${normalized}`;
  }

  return normalized;
}

function cacheKey(currentVersion: string): string {
  return `${FIRMWARE_UPDATE_CACHE_PREFIX}${currentVersion}`;
}

function readCachedFirmwareUpdate(currentVersion: string): FirmwareUpdateCheckResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(currentVersion));

    if (!raw) {
      return null;
    }

    const cached = JSON.parse(raw) as { savedAt?: number; result?: FirmwareUpdateCheckResult };

    if (!cached.savedAt || !cached.result || Date.now() - cached.savedAt > FIRMWARE_UPDATE_CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(currentVersion));
      return null;
    }

    return cached.result;
  } catch {
    return null;
  }
}

function writeCachedFirmwareUpdate(currentVersion: string, result: FirmwareUpdateCheckResult): void {
  try {
    localStorage.setItem(cacheKey(currentVersion), JSON.stringify({ savedAt: Date.now(), result }));
  } catch {
    // Ignore storage quota or private-mode failures; the live response is still usable.
  }
}

function mergeWithTimeout(signal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), FIRMWARE_UPDATE_TIMEOUT_MS);

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
