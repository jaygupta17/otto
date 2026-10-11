/**
 * Runtime/platform detection and the one HTTP entrypoint the app uses.
 *
 * Inside Tauri every request goes through the Rust HTTP client
 * (`@tauri-apps/plugin-http`): no CORS, works the same on desktop and
 * mobile, and response bodies stream (needed for SSE). In a plain browser
 * (`bun run dev` without Tauri) we fall back to `window.fetch`.
 */

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type OsName = "macos" | "windows" | "linux" | "ios" | "android" | "web";

let cachedOs: OsName | null = null;

export function osName(): OsName {
  if (cachedOs) return cachedOs;
  let os: OsName = "web";
  if (isTauri) {
    try {
      // plugin-os exposes a synchronous platform() backed by injected globals.
      const internals = (window as unknown as { __TAURI_OS_PLUGIN_INTERNALS__?: { platform?: string } })
        .__TAURI_OS_PLUGIN_INTERNALS__;
      const p = internals?.platform;
      if (p === "macos" || p === "windows" || p === "linux" || p === "ios" || p === "android") os = p;
    } catch {
      os = "web";
    }
  }
  if (os === "web") {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) os = "ios";
    else if (/Android/.test(ua)) os = "android";
  }
  cachedOs = os;
  return os;
}

export const isMac = () => osName() === "macos" || (osName() === "web" && /Mac/.test(navigator.platform));

type FetchFn = typeof globalThis.fetch;
let tauriFetch: FetchFn | null = null;

export async function httpFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  if (isTauri) {
    if (!tauriFetch) {
      const mod = await import("@tauri-apps/plugin-http");
      tauriFetch = mod.fetch as FetchFn;
    }
    return tauriFetch(input, init);
  }
  return globalThis.fetch(input, init);
}

export async function openExternal(url: string) {
  if (isTauri) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
