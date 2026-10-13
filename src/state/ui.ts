import { create } from "zustand";
import { uid } from "../lib/id";
import { isTauri } from "../lib/platform";
import { kv } from "../lib/kv";
import { cssLuminance, imageLuminance, mismatch } from "../lib/backdropTone";

export type ThemePref = "system" | "light" | "dark";

export type BackdropKind = "none" | "image" | "fill";

/** A saved background: a photo, or a CSS colour/gradient. */
export interface BackdropItem {
  id: string;
  kind: "image" | "fill";
  /** data URL (image) */
  image?: string;
  /** CSS background value (fill) */
  css?: string;
  name?: string;
  /** A portrait crop of `image` for tall windows (built-ins only). */
  tall?: string;
}

/** Backgrounds that ship with Otto: always listed, never removed. The first is the default. */
export const BUILTIN_BACKDROPS: BackdropItem[] = [
  { id: "builtin.dusk", kind: "image", image: "/backgrounds/dusk.webp", tall: "/backgrounds/dusk-tall.webp", name: "Dusk" },
  { id: "builtin.night", kind: "image", image: "/backgrounds/night.webp", name: "Night" },
];
const isBuiltin = (id?: string | null) => !!id && BUILTIN_BACKDROPS.some((b) => b.id === id);

/** Defaults for a freshly chosen background (Settings → General sliders). */
export const BACKDROP_DEFAULTS = { intensity: 0.74, chatFade: 1, fade: 1, blur: 0, glass: 0.6 };

export interface Backdrop {
  kind: BackdropKind;
  /** id of the chosen BackdropItem (saved or preset) */
  activeId?: string | null;
  /** CSS background for kind === "fill" */
  css?: string | null;
  /** 0–1, how strongly the photo shows */
  intensity: number;
  /** data URL for kind === "image" (kept in the app store, not localStorage) */
  image?: string | null;
  /** 0–1, how much the photo fades into the background toward the bottom */
  fade?: number;
  /** px of blur on the photo itself */
  blur?: number;
  /** 0–1, how see-through panels are over the photo (0 = solid) */
  glass?: number;
  /** 0–1, how strongly the chat fades into the app colour toward the composer */
  chatFade?: number;
}

/** Resolved backdrop settings with defaults applied. */
export function backdropSettings(b: Backdrop) {
  return { on: (b.kind === "image" && !!b.image) || (b.kind === "fill" && !!b.css), intensity: b.intensity ?? BACKDROP_DEFAULTS.intensity, fade: b.fade ?? BACKDROP_DEFAULTS.fade, blur: b.blur ?? BACKDROP_DEFAULTS.blur, glass: b.glass ?? BACKDROP_DEFAULTS.glass, chatFade: b.chatFade ?? BACKDROP_DEFAULTS.chatFade };
}

export type SettingsTab = "general" | "workspaces" | "agents" | "providers" | "mcp" | "skills" | "commands" | "about";

export interface Toast {
  id: string;
  tone: "info" | "error" | "ok";
  title: string;
  body?: string;
  /** Picks the icon for agent alerts (an approval looks different from "finished"). */
  kind?: "finished" | "failed" | "permission" | "question";
  /** Keep it up longer: something is waiting on the user. */
  sticky?: boolean;
  /** A button on the toast, e.g. "Open" for a session that needs you. */
  action?: { label: string; run(): void };
}

/** Tools in the right-hand panel, opened from the rail at the window's edge. */
export type PanelSurface = "files" | "terminal" | "browser" | "context" | "project";

/** Width each surface opens at until the user drags it (px). */
export const PANEL_DEFAULT_WIDTH: Record<PanelSurface, number> = { files: 640, terminal: 600, browser: 620, context: 360, project: 540 };

interface UIState {
  theme: ThemePref;
  resolvedTheme: "light" | "dark";
  sidebarOpen: boolean;
  /** The open right-panel surface, or null when the panel is closed. */
  panel: PanelSurface | null;
  panelWidths: Partial<Record<PanelSurface, number>>;
  /** The panel covers the chat. */
  panelExpanded: boolean;
  /** The file tree column inside the Files surface. */
  treeOpen: boolean;
  openPanel(s: PanelSurface): void;
  togglePanel(s: PanelSurface): void;
  closePanel(): void;
  setPanelWidth(s: PanelSurface, w: number): void;
  setPanelExpanded(v: boolean): void;
  toggleTree(v?: boolean): void;
  /** A URL to show in the Browser surface; `n` changes on every request so the same URL can reload. */
  browserRequest: { url: string; n: number } | null;
  openInBrowser(url: string): void;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  addWorkspaceOpen: boolean;
  toasts: Toast[];
  /** Files open in the editor panel (absolute paths), in tab order. */
  editorFiles: string[];
  activeFile: string | null;
  openInEditor(path: string): void;
  closeEditorFile(path: string): void;
  paletteOpen: boolean;
  setPalette(v: boolean): void;
  shortcutsOpen: boolean;
  setShortcuts(v: boolean): void;
  /** Main-area page on desktop / pushed screen on phones. */
  view: "chat" | "schedules";
  setView(v: "chat" | "schedules"): void;
  backdrop: Backdrop;
  setBackdrop(b: Partial<Backdrop>): void;
  /** The user's saved backgrounds (photos and fills). */
  backdrops: BackdropItem[];
  /** Save (if new) and switch to a background. */
  applyBackdrop(item: BackdropItem): Promise<void>;
  removeBackdrop(id: string): Promise<void>;
  /** Home keeps the prompt centred and drops its header and recent list. */
  homeCompact: boolean;
  setHomeCompact(v: boolean): void;
  setTheme(t: ThemePref): void;
  toggleSidebar(v?: boolean): void;
  openSettings(tab?: UIState["settingsTab"]): void;
  closeSettings(): void;
  setAddWorkspace(v: boolean): void;
  pushToast(t: Omit<Toast, "id">): void;
  dismissToast(id: string): void;
}

const readTheme = (): ThemePref => {
  try {
    const t = localStorage.getItem("otto.theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
};

const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
const resolve = (t: ThemePref): "light" | "dark" => (t === "system" ? (media?.matches ? "dark" : "light") : t);

function applyTheme(mode: "light" | "dark") {
  document.documentElement.dataset.theme = mode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#11121f" : "#eef0f7");
  if (isTauri) {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(mode))
      .catch(() => {});
  }
}

export const useUI = create<UIState>((set, get) => ({
  theme: readTheme(),
  resolvedTheme: resolve(readTheme()),
  sidebarOpen: true,
  panel: null,
  panelWidths: {},
  panelExpanded: false,
  treeOpen: true,
  openPanel(panel) {
    set({ panel });
  },
  togglePanel(panel) {
    set({ panel: get().panel === panel ? null : panel });
  },
  closePanel() {
    set({ panel: null, panelExpanded: false });
  },
  setPanelWidth(surface, w) {
    set({ panelWidths: { ...get().panelWidths, [surface]: Math.round(w) } });
  },
  setPanelExpanded(v) {
    set({ panelExpanded: v });
  },
  toggleTree(v) {
    set({ treeOpen: v ?? !get().treeOpen });
  },
  browserRequest: null,
  openInBrowser(url) {
    set({ browserRequest: { url, n: (get().browserRequest?.n ?? 0) + 1 }, panel: "browser" });
  },
  settingsOpen: false,
  settingsTab: "general",
  addWorkspaceOpen: false,
  toasts: [],
  editorFiles: [],
  activeFile: null,
  paletteOpen: false,
  shortcutsOpen: false,
  setPalette(v) {
    set({ paletteOpen: v });
  },
  setShortcuts(v) {
    set({ shortcutsOpen: v });
  },
  openInEditor(path) {
    const files = get().editorFiles;
    set({ editorFiles: files.includes(path) ? files : [...files, path].slice(-12), activeFile: path, panel: "files" });
  },
  closeEditorFile(path) {
    const files = get().editorFiles;
    const i = files.indexOf(path);
    const next = files.filter((f) => f !== path);
    const active = get().activeFile === path ? (next[Math.min(i, next.length - 1)] ?? null) : get().activeFile;
    set({ editorFiles: next, activeFile: active });
  },
  view: "chat",
  setView(v) {
    set({ view: v });
  },
  backdrop: { kind: "none", intensity: BACKDROP_DEFAULTS.intensity, image: null },
  homeCompact: true,
  setHomeCompact(v) {
    set({ homeCompact: v });
    void kv.set("ui.homeCompact", v);
  },

  backdrops: [],
  async applyBackdrop(item) {
    const saved = isBuiltin(item.id) || get().backdrops.some((x) => x.id === item.id);
    if (!saved) {
      const backdrops = [item, ...get().backdrops].slice(0, MAX_BACKDROPS);
      try {
        await kv.set("ui.backdrops", backdrops);
      } catch {
        toast({ tone: "error", title: "Not enough space to save another photo", body: "Remove one you don't use, then try again." });
        return;
      }
      set({ backdrops });
    }
    get().setBackdrop({ kind: item.kind, activeId: item.id, image: item.kind === "image" ? item.image : null, css: item.kind === "fill" ? item.css : null });
  },
  async removeBackdrop(id) {
    const backdrops = get().backdrops.filter((x) => x.id !== id);
    set({ backdrops });
    await kv.set("ui.backdrops", backdrops);
    if (get().backdrop.activeId === id) get().setBackdrop({ kind: "none", activeId: null, image: null, css: null });
  },
  setBackdrop(b) {
    const backdrop = { ...get().backdrop, ...b };
    set({ backdrop });
    void kv.set("ui.backdrop", backdrop);
  },

  setTheme(theme) {
    try {
      localStorage.setItem("otto.theme", theme);
    } catch {
      /* ignore */
    }
    const resolvedTheme = resolve(theme);
    applyTheme(resolvedTheme);
    set({ theme, resolvedTheme });
  },
  toggleSidebar(v) {
    set({ sidebarOpen: v ?? !get().sidebarOpen });
  },
  openSettings(tab) {
    set({ settingsOpen: true, settingsTab: tab ?? get().settingsTab });
  },
  closeSettings() {
    set({ settingsOpen: false });
  },
  setAddWorkspace(v) {
    set({ addWorkspaceOpen: v });
  },
  pushToast(t) {
    const id = uid("t_");
    set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
    setTimeout(() => get().dismissToast(id), t.sticky ? 20_000 : t.action ? 8000 : t.tone === "error" ? 6500 : 3500);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

media?.addEventListener("change", () => {
  const s = useUI.getState();
  if (s.theme === "system") {
    const r = resolve("system");
    applyTheme(r);
    useUI.setState({ resolvedTheme: r });
  }
});

const MAX_BACKDROPS = 12;

export function toast(t: Omit<Toast, "id">) {
  useUI.getState().pushToast(t);
}

export async function initUI() {
  applyTheme(useUI.getState().resolvedTheme);
  void syncBackdrop();
  const backdrop = await kv.get<Backdrop>("ui.backdrop");
  let backdrops = (await kv.get<BackdropItem[]>("ui.backdrops")) ?? [];
  if (backdrop) {
    // Builds before the library kept a single photo on the backdrop itself: keep it as a saved item.
    if (backdrop.image && !backdrops.some((x) => x.image === backdrop.image)) {
      const item: BackdropItem = { id: uid("bg_"), kind: "image", image: backdrop.image };
      backdrops = [item, ...backdrops];
      await kv.set("ui.backdrops", backdrops);
      if (backdrop.kind === "image") backdrop.activeId = item.id;
    }
    if (backdrop.kind === "image" && !backdrop.activeId) backdrop.activeId = backdrops.find((x) => x.image === backdrop.image)?.id ?? null;
    const known = backdrop.kind === "image" || backdrop.kind === "fill";
    useUI.setState({ backdrop: known ? backdrop : { ...backdrop, kind: "none" } });
  } else {
    // Never chosen one: start on the built-in sky. Picking "None" is remembered.
    const sky = BUILTIN_BACKDROPS[0];
    useUI.setState({ backdrop: { ...useUI.getState().backdrop, kind: "image", activeId: sky.id, image: sky.image } });
  }
  useUI.setState({ backdrops });
  if ((await kv.get<boolean>("ui.homeCompact")) === false) useUI.setState({ homeCompact: false });
  const layout = await kv.get<{ sidebarOpen?: boolean; panel?: PanelSurface | null; panelWidths?: UIState["panelWidths"]; treeOpen?: boolean }>("ui.layout");
  if (layout) useUI.setState({ sidebarOpen: layout.sidebarOpen !== false, panel: layout.panel ?? null, panelWidths: layout.panelWidths ?? {}, treeOpen: layout.treeOpen !== false });
  useUI.subscribe((s, prev) => {
    if (s.sidebarOpen !== prev.sidebarOpen || s.panel !== prev.panel || s.panelWidths !== prev.panelWidths || s.treeOpen !== prev.treeOpen)
      void kv.set("ui.layout", { sidebarOpen: s.sidebarOpen, panel: s.panel, panelWidths: s.panelWidths, treeOpen: s.treeOpen });
  });
}

// Stores hold live connections; a hot swap would orphan them. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

/**
 * The backdrop is marked on <html> (not on the app's root) so everything that
 * renders in a portal (settings, menus, palette, toasts) picks up the same
 * glass. `--mismatch` thickens the glass when the background fights the theme.
 */
let toneRun = 0;
async function syncBackdrop() {
  const { backdrop, resolvedTheme } = useUI.getState();
  const s = backdropSettings(backdrop);
  const root = document.documentElement;
  if (!s.on) {
    delete root.dataset.backdrop;
    root.style.removeProperty("--glass");
    root.style.removeProperty("--mismatch");
    return;
  }
  root.dataset.backdrop = "on";
  root.style.setProperty("--glass", String(s.glass));
  const run = ++toneRun;
  try {
    const lum = backdrop.kind === "fill" ? cssLuminance(backdrop.css ?? "") : await imageLuminance(backdrop.image!);
    // A photo shown faintly is mostly the app colour underneath.
    const seen = resolvedTheme === "dark" ? lum * s.intensity : 1 - (1 - lum) * s.intensity;
    if (run === toneRun) root.style.setProperty("--mismatch", mismatch(seen, resolvedTheme).toFixed(2));
  } catch {
    if (run === toneRun) root.style.setProperty("--mismatch", "0.5");
  }
}
useUI.subscribe((s, prev) => {
  if (s.backdrop !== prev.backdrop || s.resolvedTheme !== prev.resolvedTheme) void syncBackdrop();
});
