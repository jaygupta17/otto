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
}

/** Built-in fills, always offered next to the user's own. */
export const BACKDROP_PRESETS: BackdropItem[] = [
  { id: "p-dusk", kind: "fill", name: "Dusk", css: "linear-gradient(160deg, #1f2a5a 0%, #6b3a6e 48%, #e48a6a 100%)" },
  { id: "p-aurora", kind: "fill", name: "Aurora", css: "radial-gradient(120% 90% at 15% 10%, #2bd4a4 0%, transparent 55%), radial-gradient(100% 80% at 90% 30%, #6a5cff 0%, transparent 60%), linear-gradient(180deg, #0b1020, #101a2e)" },
  { id: "p-ocean", kind: "fill", name: "Ocean", css: "linear-gradient(200deg, #0a3d62 0%, #0c6e8a 50%, #3fb5c4 100%)" },
  { id: "p-forest", kind: "fill", name: "Forest", css: "linear-gradient(170deg, #0f2a1f 0%, #1f5a3d 55%, #8fbf6a 100%)" },
  { id: "p-ember", kind: "fill", name: "Ember", css: "radial-gradient(110% 80% at 80% 100%, #ff7a3d 0%, transparent 60%), linear-gradient(180deg, #1a0f12, #3a1520)" },
  { id: "p-sand", kind: "fill", name: "Sand", css: "linear-gradient(165deg, #f3e7d3 0%, #e2c9a6 55%, #c99b78 100%)" },
  { id: "p-graphite", kind: "fill", name: "Graphite", css: "linear-gradient(180deg, #2b2d33 0%, #15161a 100%)" },
  { id: "p-lilac", kind: "fill", name: "Lilac", css: "linear-gradient(150deg, #c9b8ff 0%, #f1c4e0 60%, #ffe3c7 100%)" },
];

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
}

/** Resolved backdrop settings with defaults applied. */
export function backdropSettings(b: Backdrop) {
  return { on: (b.kind === "image" && !!b.image) || (b.kind === "fill" && !!b.css), intensity: b.intensity, fade: b.fade ?? 0.35, blur: b.blur ?? 0, glass: b.glass ?? 0.3 };
}

export type SettingsTab = "general" | "workspaces" | "agents" | "providers" | "mcp" | "skills" | "commands" | "about";

export interface Toast {
  id: string;
  tone: "info" | "error" | "ok";
  title: string;
  body?: string;
}

interface UIState {
  theme: ThemePref;
  resolvedTheme: "light" | "dark";
  sidebarOpen: boolean;
  filesOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  addWorkspaceOpen: boolean;
  toasts: Toast[];
  /** Files open in the editor panel (absolute paths), in tab order. */
  editorFiles: string[];
  activeFile: string | null;
  /** Width of the chat column while the editor is open (px). */
  chatWidth: number;
  openInEditor(path: string): void;
  closeEditorFile(path: string): void;
  setChatWidth(w: number): void;
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
  /** Desktop/mobile notifications when a session finishes in the background. */
  notify: boolean;
  setNotify(v: boolean): void;
  /** Home keeps the prompt centred and drops its header and recent list. */
  homeCompact: boolean;
  setHomeCompact(v: boolean): void;
  setTheme(t: ThemePref): void;
  toggleSidebar(v?: boolean): void;
  toggleFiles(v?: boolean): void;
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
  filesOpen: false,
  settingsOpen: false,
  settingsTab: "general",
  addWorkspaceOpen: false,
  toasts: [],
  editorFiles: [],
  activeFile: null,
  chatWidth: 460,
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
    set({ editorFiles: files.includes(path) ? files : [...files, path].slice(-12), activeFile: path });
  },
  closeEditorFile(path) {
    const files = get().editorFiles;
    const i = files.indexOf(path);
    const next = files.filter((f) => f !== path);
    const active = get().activeFile === path ? (next[Math.min(i, next.length - 1)] ?? null) : get().activeFile;
    set({ editorFiles: next, activeFile: active });
  },
  setChatWidth(w) {
    set({ chatWidth: Math.round(w) });
    void kv.set("ui.chatWidth", Math.round(w));
  },
  view: "chat",
  setView(v) {
    set({ view: v });
  },
  backdrop: { kind: "none", intensity: 0.85, image: null },
  notify: false,
  setNotify(v) {
    set({ notify: v });
    void kv.set("ui.notify", v);
  },
  homeCompact: true,
  setHomeCompact(v) {
    set({ homeCompact: v });
    void kv.set("ui.homeCompact", v);
  },

  backdrops: [],
  async applyBackdrop(item) {
    const saved = item.id.startsWith("p-") || get().backdrops.some((x) => x.id === item.id);
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
  toggleFiles(v) {
    set({ filesOpen: v ?? !get().filesOpen });
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
    setTimeout(() => get().dismissToast(id), t.tone === "error" ? 6500 : 3500);
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
  }
  useUI.setState({ backdrops });
  if ((await kv.get<boolean>("ui.notify")) === true) useUI.setState({ notify: true });
  if ((await kv.get<boolean>("ui.homeCompact")) === false) useUI.setState({ homeCompact: false });
  const chatWidth = await kv.get<number>("ui.chatWidth");
  if (chatWidth) useUI.setState({ chatWidth });
  const layout = await kv.get<{ sidebarOpen?: boolean }>("ui.layout");
  if (layout?.sidebarOpen === false) useUI.setState({ sidebarOpen: false });
  useUI.subscribe((s, prev) => {
    if (s.sidebarOpen !== prev.sidebarOpen) void kv.set("ui.layout", { sidebarOpen: s.sidebarOpen });
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
