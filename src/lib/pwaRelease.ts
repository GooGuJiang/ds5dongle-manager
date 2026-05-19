import { APP_METADATA } from "../appConfig";

const UNKNOWN_VERSION = "--";
const PWA_UPDATE_CACHE_PREFIX = "pwa-update-cache:";
const PWA_UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const PWA_UPDATE_TIMEOUT_MS = import.meta.env.DEV ? 30_000 : 15_000;

export interface PwaReleaseAsset {
  name: string;
  downloadUrl: string;
}

export interface PwaLocalizedBlock {
  title: string;
  summary: string;
  highlights: string[];
  upgradeNotice: string;
}

export interface PwaLocalizedNotes {
  zh_CN: PwaLocalizedBlock;
  en_US: PwaLocalizedBlock;
  aiGenerated?: boolean;
}

export interface PwaReleaseInfo {
  tagName: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  commitSha: string | null;
  assets: PwaReleaseAsset[];
  localizedNotes?: PwaLocalizedNotes;
}

export interface PwaUpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  currentRelease: PwaReleaseInfo | null;
  latestRelease: PwaReleaseInfo;
}

export async function checkPwaUpdate(signal?: AbortSignal): Promise<PwaUpdateCheckResult | null> {
  const currentVersion = normalizePwaVersion(APP_METADATA.version);

  if (!shouldCheckPwaUpdate(currentVersion)) {
    return null;
  }

  const cachedResult = readCachedPwaUpdate(currentVersion);

  if (cachedResult) {
    void refreshPwaUpdateCache(currentVersion);
    return cachedResult;
  }

  return fetchPwaUpdate(currentVersion, signal);
}

export function shouldCheckPwaUpdate(currentVersion = APP_METADATA.version): boolean {
  return Boolean(
    typeof window !== "undefined" &&
      navigator.onLine &&
      currentVersion &&
      currentVersion.trim() !== "" &&
      currentVersion.trim() !== UNKNOWN_VERSION,
  );
}

function pwaUpdateUrl(currentVersion: string): string {
  const url = new URL(APP_METADATA.pwaUpdateApiUrl);
  url.searchParams.set("currentVersion", currentVersion);
  return url.toString();
}

async function fetchPwaUpdate(currentVersion: string, signal?: AbortSignal): Promise<PwaUpdateCheckResult> {
  const result = await fetchJson<PwaUpdateCheckResult>(pwaUpdateUrl(currentVersion), mergeWithTimeout(signal));
  writeCachedPwaUpdate(currentVersion, result);
  return result;
}

function refreshPwaUpdateCache(currentVersion: string): void {
  if (!navigator.onLine) {
    return;
  }

  void fetchPwaUpdate(currentVersion).catch((error) => {
    console.debug("PWA update cache refresh failed", error);
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
    throw new Error(`PWA update check failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function normalizePwaVersion(version: string): string {
  const normalized = version.trim();

  if (/^\d+\.\d+\.\d+/.test(normalized)) {
    return `v${normalized}`;
  }

  return normalized;
}

function cacheKey(currentVersion: string): string {
  return `${PWA_UPDATE_CACHE_PREFIX}${currentVersion}`;
}

function readCachedPwaUpdate(currentVersion: string): PwaUpdateCheckResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(currentVersion));

    if (!raw) {
      return null;
    }

    const cached = JSON.parse(raw) as { savedAt?: number; result?: PwaUpdateCheckResult };

    if (!cached.savedAt || !cached.result || Date.now() - cached.savedAt > PWA_UPDATE_CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(currentVersion));
      return null;
    }

    return cached.result;
  } catch {
    return null;
  }
}

function writeCachedPwaUpdate(currentVersion: string, result: PwaUpdateCheckResult): void {
  try {
    localStorage.setItem(cacheKey(currentVersion), JSON.stringify({ savedAt: Date.now(), result }));
  } catch {
    // Ignore storage quota or private-mode failures; the live response is still usable.
  }
}

function mergeWithTimeout(signal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PWA_UPDATE_TIMEOUT_MS);

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
