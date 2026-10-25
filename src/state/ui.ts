import { create } from "zustand";
import { uid } from "../lib/id";
import { isTauri } from "../lib/platform";
import { kv } from "../lib/kv";

export type ThemePref = "system" | "light" | "dark";

export type SettingsTab = "general" | "workspaces" | "apps" | "agents" | "providers" | "mcp" | "skills" | "commands" | "about";

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
export type PanelSurface = "files" | "terminal" | "browser" | "context" | "project" | "memory";

/** Width each surface opens at until the user drags it (px). */
export const PANEL_DEFAULT_WIDTH: Record<PanelSurface, number> = { files: 400, terminal: 520, browser: 560, context: 340, project: 480, memory: 400 };
/** Files grows to this once a file is open, so code has room beside the tree. */
export const FILES_OPEN_WIDTH = 600;

/** Remembered expanded folders per workspace root, and remembered roots in total. */
const TREE_PATHS = 200;
const TREE_ROOTS = 8;

/** Drop anything malformed and hold the remembered tree to a sane size. */
function sanitizeTree(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (raw && typeof raw === "object") {
    // Entries keep insertion order: the setters move what's touched to the end.
    for (const [root, list] of Object.entries(raw as Record<string, unknown>).slice(-TREE_ROOTS)) {
      if (!Array.isArray(list)) continue;
      const paths = [...new Set(list.filter((p): p is string => typeof p === "string" && !!p))];
      if (paths.length) out[root] = paths.slice(-TREE_PATHS);
    }
  }
  return out;
}

interface UIState {
  theme: ThemePref;
  resolvedTheme: "light" | "dark";
  sidebarOpen: boolean;
  /** The open right-panel surface, or null when the panel is closed. */
  panel: PanelSurface | null;
  /** The surface the panel button reopens. */
  lastPanel: PanelSurface;
  panelWidths: Partial<Record<PanelSurface, number>>;
  /** The panel covers the chat. */
  panelExpanded: boolean;
  /** The file tree column inside the Files surface. */
  treeOpen: boolean;
  /** Expanded folders in the file tree, per workspace root. */
  treeExpanded: Record<string, string[]>;
  openPanel(s: PanelSurface): void;
  togglePanel(s: PanelSurface): void;
  /** Show the panel at its last surface, or hide it. */
  togglePanelOpen(): void;
  closePanel(): void;
  setPanelWidth(s: PanelSurface, w: number): void;
  setPanelExpanded(v: boolean): void;
  toggleTree(v?: boolean): void;
  /** Open/close a folder in the file tree; remembered across reloads and Refresh. */
  setTreeExpanded(root: string, path: string, open: boolean): void;
  /** Forget remembered folders a listing shows are gone. Silent: paths just drop. */
  pruneTree(root: string, dir: string, dirs: string[]): void;
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
  /** A line to reveal in an open file (`n` changes on every request so the same line can be revealed twice). */
  editorLine: { path: string; line: number; n: number } | null;
  openInEditor(path: string, line?: number): void;
  closeEditorFile(path: string): void;
  paletteOpen: boolean;
  setPalette(v: boolean): void;
  shortcutsOpen: boolean;
  setShortcuts(v: boolean): void;
  /** Main-area page on desktop / pushed screen on phones. */
  view: "chat" | "schedules";
  setView(v: "chat" | "schedules"): void;
  /** A new session on the phone, pushed like a session. Desktop drafts live on the home screen. */
  draftOpen: boolean;
  setDraftOpen(v: boolean): void;
  /** Home keeps the prompt centred and drops its header and recent list. */
  homeCompact: boolean;
  setHomeCompact(v: boolean): void;
  /** Show the model's thinking in chat. Off by default: the bird says it's working. */
  showThinking: boolean;
  setShowThinking(v: boolean): void;
  /**
   * Turn off the functional micro-transitions (sheets, pushes, entrances, hover).
   * Mascot, shimmer and loading motion are CSS and stay; see styles.css.
   * The OS's reduced-motion setting is a floor on top of this.
   */
  reduceMotion: boolean;
  setReduceMotion(v: boolean): void;
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", mode === "dark" ? "#1a1b1e" : "#eef1f5");
  if (isTauri) {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(mode))
      .catch(() => {});
  }
}

/** Phones and tablets pay the most for micro-transitions, so they start with fewer. */
const coarsePointer = typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;

const reduceMedia = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

/**
 * Functional transitions are off when the pref says so, or when the OS does: the
 * OS setting is a floor, so the app never moves more than the system allows.
 * `styles.css` keys the instant transitions off this attribute; motion (framer)
 * gets the same signal in App.tsx.
 */
function applyMotion() {
  document.documentElement.toggleAttribute("data-reduce-motion", useUI.getState().reduceMotion || !!reduceMedia?.matches);
}

export const useUI = create<UIState>((set, get) => ({
  theme: readTheme(),
  resolvedTheme: resolve(readTheme()),
  sidebarOpen: true,
  panel: null,
  lastPanel: "files",
  panelWidths: {},
  panelExpanded: false,
  treeOpen: true,
  treeExpanded: {},
  openPanel(panel) {
    set({ panel });
  },
  togglePanel(panel) {
    set({ panel: get().panel === panel ? null : panel });
  },
  togglePanelOpen() {
    if (get().panel) set({ panel: null, panelExpanded: false });
    else set({ panel: get().lastPanel });
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
  setTreeExpanded(root, path, open) {
    const map = { ...get().treeExpanded };
    const kept = (map[root] ?? []).filter((p) => p !== path);
    delete map[root];
    // Touching a root moves it to the end, so the least recently used drop first.
    const list = open ? [...kept, path].slice(-TREE_PATHS) : kept;
    if (list.length) map[root] = list;
    for (const r of Object.keys(map).slice(0, Math.max(0, Object.keys(map).length - TREE_ROOTS))) delete map[r];
    set({ treeExpanded: map });
    void kv.set("ui.tree", map);
  },
  pruneTree(root, dir, dirs) {
    const list = get().treeExpanded[root];
    if (!list?.length) return;
    const prefix = `${dir.replace(/\/+$/, "")}/`;
    const live = new Set(dirs);
    // Any remembered folder whose immediate parent no longer lists it is gone;
    // its whole subtree goes with it. Never an error, just gone.
    const kept = list.filter((p) => {
      if (!p.startsWith(prefix)) return true;
      const child = p.slice(prefix.length).split("/")[0];
      return !!child && live.has(child);
    });
    if (kept.length === list.length) return;
    const next = { ...get().treeExpanded, [root]: kept };
    set({ treeExpanded: next });
    void kv.set("ui.tree", next);
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
  editorLine: null,
  paletteOpen: false,
  shortcutsOpen: false,
  setPalette(v) {
    set({ paletteOpen: v });
  },
  setShortcuts(v) {
    set({ shortcutsOpen: v });
  },
  openInEditor(path, line) {
    const files = get().editorFiles;
    set({
      editorFiles: files.includes(path) ? files : [...files, path].slice(-12),
      activeFile: path,
      panel: "files",
      editorLine: line && line > 0 ? { path, line, n: (get().editorLine?.n ?? 0) + 1 } : get().editorLine,
    });
  },
  closeEditorFile(path) {
    const files = get().editorFiles;
    const i = files.indexOf(path);
    const next = files.filter((f) => f !== path);
    const active = get().activeFile === path ? (next[Math.min(i, next.length - 1)] ?? null) : get().activeFile;
    set({ editorFiles: next, activeFile: active });
  },
  view: "chat",
  draftOpen: false,
  setDraftOpen(v) {
    set({ draftOpen: v });
  },
  setView(v) {
    set({ view: v });
  },
  homeCompact: true,
  setHomeCompact(v) {
    set({ homeCompact: v });
    void kv.set("ui.homeCompact", v);
  },
  showThinking: true,
  setShowThinking(v) {
    set({ showThinking: v });
    void kv.set("ui.showThinking", v);
  },
  reduceMotion: coarsePointer,
  setReduceMotion(v) {
    set({ reduceMotion: v });
    void kv.set("ui.reduceMotion", v);
    applyMotion();
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

reduceMedia?.addEventListener("change", applyMotion);

export function toast(t: Omit<Toast, "id">) {
  useUI.getState().pushToast(t);
}

export async function initUI() {
  applyTheme(useUI.getState().resolvedTheme);
  // Background photos are gone; drop what older builds saved (data URLs can be large).
  void kv.delete("ui.backdrop");
  void kv.delete("ui.backdrops");
  if ((await kv.get<boolean>("ui.homeCompact")) === false) useUI.setState({ homeCompact: false });
  if ((await kv.get<boolean>("ui.showThinking")) === false) useUI.setState({ showThinking: false });
  const reduce = await kv.get<boolean>("ui.reduceMotion");
  if (typeof reduce === "boolean") useUI.setState({ reduceMotion: reduce });
  applyMotion();
  const layout = await kv.get<{ sidebarOpen?: boolean; panel?: PanelSurface | null; lastPanel?: PanelSurface; panelWidths?: UIState["panelWidths"]; treeOpen?: boolean }>("ui.layout");
  if (layout) useUI.setState({ sidebarOpen: layout.sidebarOpen !== false, panel: layout.panel ?? null, lastPanel: layout.panel ?? layout.lastPanel ?? "files", panelWidths: layout.panelWidths ?? {}, treeOpen: layout.treeOpen !== false });
  const tree = await kv.get<Record<string, string[]>>("ui.tree");
  if (tree) useUI.setState({ treeExpanded: sanitizeTree(tree) });
  useUI.subscribe((s, prev) => {
    // Whatever opened the panel (button, shortcut, a link), the button brings that surface back.
    if (s.panel && s.panel !== s.lastPanel) return useUI.setState({ lastPanel: s.panel });
    if (s.sidebarOpen !== prev.sidebarOpen || s.panel !== prev.panel || s.lastPanel !== prev.lastPanel || s.panelWidths !== prev.panelWidths || s.treeOpen !== prev.treeOpen)
      void kv.set("ui.layout", { sidebarOpen: s.sidebarOpen, panel: s.panel, lastPanel: s.lastPanel, panelWidths: s.panelWidths, treeOpen: s.treeOpen });
  });
}

// Stores hold live connections; a hot swap would orphan them. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

