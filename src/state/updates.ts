/**
 * In-app updates (desktop): Tauri's updater reads latest.json from the newest
 * published GitHub release, verifies the signature against the key in
 * tauri.conf.json, and swaps the app in place.
 *
 *   idle → checking → available → downloading → ready (restart) / error
 *
 * Otto checks shortly after launch and every few hours while open, unless the
 * user turned that off. Nothing downloads until they say so.
 */
import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { isTauri, osName } from "../lib/platform";
import { kv } from "../lib/kv";

export const RELEASES_URL = "https://github.com/jaygupta17/otto/releases/latest";

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

/** Only the desktop builds carry the updater plugin. */
export const updatesSupported = () => isTauri && ["macos", "windows", "linux"].includes(osName());

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
    if (!pending || get().status !== "available") return;
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
