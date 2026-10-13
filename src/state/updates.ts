/**
 * Updates.
 *
 * Desktop: Tauri's updater reads latest.json from the newest published GitHub
 * release, verifies the signature against the key in tauri.conf.json, and
 * swaps the app in place.
 *
 *   idle → checking → available → downloading → ready (restart) / error
 *
 * Android (sideloaded APK): no in-place install. Otto reads the same
 * latest.json and, when it's newer, offers the release's APK; Android
 * installs it over the old one. iOS updates through the App Store.
 *
 * Otto checks shortly after launch and every few hours while open, unless the
 * user turned that off. Nothing downloads until they say so.
 */
import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { httpFetch, isTauri, openExternal, osName } from "../lib/platform";
import { kv } from "../lib/kv";

const REPO = "https://github.com/jaygupta17/otto";
export const RELEASES_URL = `${REPO}/releases/latest`;
const MANIFEST = `${REPO}/releases/latest/download/latest.json`;

type Status = "idle" | "checking" | "current" | "available" | "downloading" | "ready" | "error";

interface UpdatesState {
  status: Status;
  /** The newer version on offer, with its release notes. */
  version?: string;
  notes?: string;
  /** 0–1 while downloading; undefined when the size isn't known. */
  progress?: number;
  error?: string;
  /** The download or install failed (not the check): offer the release page instead. */
  installFailed?: boolean;
  checkedAt?: number;
  auto: boolean;
  setAuto(v: boolean): void;
  check(opts?: { quiet?: boolean }): Promise<void>;
  install(): Promise<void>;
  restart(): Promise<void>;
  /** Hide the sidebar pill for this version until the next launch. */
  dismissed?: string;
  dismiss(): void;
}

/** Desktop builds carry the updater plugin and install in place. */
export const installsInPlace = () => isTauri && ["macos", "windows", "linux"].includes(osName());
/** Android can't install in place, but can be told about a new APK. */
export const updatesSupported = () => installsInPlace() || (isTauri && osName() === "android");

/** The APK for a version, named the way the release workflow names it. */
const apkUrl = (v: string) => `${REPO}/releases/download/v${v}/Otto_${v}_android.apk`;

/** a > b for plain x.y.z versions (a pre-release suffix counts as older). */
export function newer(a: string, b: string) {
  const parse = (v: string) => v.replace(/^v/, "").split("-");
  const [ma, pa] = parse(a);
  const [mb, pb] = parse(b);
  const x = ma.split(".").map(Number);
  const y = mb.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return !pa && !!pb;
}

let pending: Update | null = null;

export const useUpdates = create<UpdatesState>((set, get) => ({
  status: "idle",
  auto: true,
  setAuto(v) {
    set({ auto: v });
    void kv.set("updates.auto", v);
  },
  async check({ quiet = false } = {}) {
    if (!updatesSupported()) return;
    const s = get().status;
    if (s === "checking" || s === "downloading" || s === "ready") return;
    set({ status: "checking", error: undefined, installFailed: false });
    try {
      if (!installsInPlace()) {
        const res = await httpFetch(MANIFEST, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const m = (await res.json()) as { version?: string; notes?: string };
        const v = m.version?.replace(/^v/, "");
        set(
          v && newer(v, __APP_VERSION__)
            ? { status: "available", version: v, notes: m.notes?.trim() || undefined, checkedAt: Date.now() }
            : { status: "current", version: undefined, notes: undefined, checkedAt: Date.now() },
        );
        return;
      }
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      pending = update;
      set(
        update
          ? { status: "available", version: update.version, notes: update.body?.trim() || undefined, checkedAt: Date.now() }
          : { status: "current", version: undefined, notes: undefined, checkedAt: Date.now() },
      );
    } catch (e) {
      // A background check that can't reach GitHub isn't worth a red banner.
      set(quiet ? { status: "idle" } : { status: "error", error: message(e) });
    }
  },
  async install() {
    const { status, version } = get();
    if (status !== "available") return;
    if (!installsInPlace()) {
      // The browser downloads it; tapping the download installs over this version.
      await openExternal(version ? apkUrl(version) : RELEASES_URL);
      return;
    }
    if (!pending) return;
    set({ status: "downloading", progress: 0, error: undefined });
    let total = 0;
    let got = 0;
    try {
      await pending.downloadAndInstall((ev) => {
        if (ev.event === "Started") total = ev.data.contentLength ?? 0;
        else if (ev.event === "Progress") {
          got += ev.data.chunkLength;
          set({ progress: total ? Math.min(1, got / total) : undefined });
        }
      });
      // Windows never gets here: the installer closes the app itself.
      set({ status: "ready", progress: 1 });
    } catch (e) {
      set({ status: "error", error: message(e), installFailed: true });
    }
  },
  async restart() {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  },
  dismiss() {
    set({ dismissed: get().version });
  },
}));

function message(e: unknown) {
  const m = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
  return m || "Couldn't update.";
}

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Load the preference and start background checks. */
export async function initUpdates() {
  if (!updatesSupported()) return;
  const auto = await kv.get<boolean>("updates.auto");
  if (auto === false) useUpdates.setState({ auto: false });
  const tick = () => useUpdates.getState().auto && void useUpdates.getState().check({ quiet: true });
  setTimeout(tick, 8000);
  setInterval(tick, SIX_HOURS);
}
