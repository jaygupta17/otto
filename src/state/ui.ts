import { create } from "zustand";
import { uid } from "../lib/id";
import { isTauri } from "../lib/platform";
import { kv } from "../lib/kv";

export type ThemePref = "system" | "light" | "dark";

export type BackdropKind = "none" | "image";

export interface Backdrop {
  kind: BackdropKind;
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
  return { on: b.kind === "image" && !!b.image, intensity: b.intensity, fade: b.fade ?? 0.35, blur: b.blur ?? 0, glass: b.glass ?? 0.3 };
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
  /** Desktop/mobile notifications when a session finishes in the background. */
  notify: boolean;
  setNotify(v: boolean): void;
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

export function toast(t: Omit<Toast, "id">) {
  useUI.getState().pushToast(t);
}

export async function initUI() {
  applyTheme(useUI.getState().resolvedTheme);
  const backdrop = await kv.get<Backdrop>("ui.backdrop");
  // Older builds had gradient presets; anything but a photo now means "none".
  if (backdrop) useUI.setState({ backdrop: backdrop.kind === "image" ? backdrop : { ...backdrop, kind: "none" } });
  if ((await kv.get<boolean>("ui.notify")) === true) useUI.setState({ notify: true });
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
