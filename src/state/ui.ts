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

/** Tools in the right-hand dock, in dock order. `project` is intentionally not here: it is unregistered. */
export type PanelSurface = "artifact" | "browser" | "terminal" | "context" | "memory";

/** The panel's width until the user drags it. One width for every surface: the panel doesn't resize as you switch. */
export const PANEL_DEFAULT_WIDTH = 460;

interface UIState {
  theme: ThemePref;
  resolvedTheme: "light" | "dark";
  sidebarOpen: boolean;
  /** The open right-panel surface, or null when the panel is closed. */
  panel: PanelSurface | null;
  /** The surface the panel reopens at (`⌘⇧\`), and the one the dock leaves lit while closed. */
  lastPanel: PanelSurface;
  /** The panel's width, one number for the whole panel. */
  panelWidth: number | null;
  openPanel(s: PanelSurface): void;
  /** Click a dock icon: open that surface, or close the panel when it's the one already up. */
  togglePanel(s: PanelSurface): void;
  /** Show the panel at its last surface, or hide it. */
  togglePanelOpen(): void;
  closePanel(): void;
  setPanelWidth(w: number): void;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  addWorkspaceOpen: boolean;
  toasts: Toast[];
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
  /**
   * Fetch the title and image of links in messages, from this machine. Off by
   * default: message text can name any URL, so a fetch is a signal to whoever
   * wrote it — when the message was read, and where from.
   */
  linkPreviews: boolean;
  setLinkPreviews(v: boolean): void;
  /** The agent's screen shows just its Chrome, shaped to the view (lib/screenFit.ts), not the whole desktop. */
  screenFit: boolean;
  setScreenFit(v: boolean): void;
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
  lastPanel: "artifact",
  panelWidth: null,
  openPanel(panel) {
    set({ panel, lastPanel: panel });
  },
  togglePanel(panel) {
    set({ panel: get().panel === panel ? null : panel, lastPanel: panel });
  },
  togglePanelOpen() {
    if (get().panel) set({ panel: null });
    else set({ panel: get().lastPanel });
  },
  closePanel() {
    set({ panel: null });
  },
  setPanelWidth(w) {
    set({ panelWidth: Math.round(w) });
  },
  settingsOpen: false,
  settingsTab: "general",
  addWorkspaceOpen: false,
  toasts: [],
  paletteOpen: false,
  shortcutsOpen: false,
  setPalette(v) {
    set({ paletteOpen: v });
  },
  setShortcuts(v) {
    set({ shortcutsOpen: v });
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
  linkPreviews: false,
  setLinkPreviews(v) {
    set({ linkPreviews: v });
    void kv.set("ui.linkPreviews", v);
  },
  screenFit: true,
  setScreenFit(v) {
    set({ screenFit: v });
    void kv.set("ui.screenFit", v);
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

/** Whether a saved or computed panel id is one this build has. */
export function isPanelSurface(v: unknown): v is PanelSurface {
  return v === "artifact" || v === "browser" || v === "terminal" || v === "context" || v === "memory";
}

export async function initUI() {
  applyTheme(useUI.getState().resolvedTheme);
  // Background photos are gone; drop what older builds saved (data URLs can be large).
  void kv.delete("ui.backdrop");
  void kv.delete("ui.backdrops");
  if ((await kv.get<boolean>("ui.homeCompact")) === false) useUI.setState({ homeCompact: false });
  if ((await kv.get<boolean>("ui.showThinking")) === false) useUI.setState({ showThinking: false });
  if ((await kv.get<boolean>("ui.linkPreviews")) === true) useUI.setState({ linkPreviews: true });
  if ((await kv.get<boolean>("ui.screenFit")) === false) useUI.setState({ screenFit: false });
  const reduce = await kv.get<boolean>("ui.reduceMotion");
  if (typeof reduce === "boolean") useUI.setState({ reduceMotion: reduce });
  applyMotion();
  // Layout: one width for the whole panel, and no surface that this build no
  // longer has (an old build could have saved `files` or `project`).
  const layout = await kv.get<{ sidebarOpen?: boolean; panel?: unknown; lastPanel?: unknown; panelWidth?: unknown }>("ui.layout");
  if (layout) {
    useUI.setState({
      sidebarOpen: layout.sidebarOpen !== false,
      panel: isPanelSurface(layout.panel) ? layout.panel : null,
      lastPanel: isPanelSurface(layout.lastPanel) ? layout.lastPanel : "artifact",
      panelWidth: typeof layout.panelWidth === "number" && Number.isFinite(layout.panelWidth) ? layout.panelWidth : null,
    });
  }
  // The file tree is gone; drop what older builds remembered.
  void kv.delete("ui.tree");
  useUI.subscribe((s, prev) => {
    if (s.sidebarOpen !== prev.sidebarOpen || s.panel !== prev.panel || s.lastPanel !== prev.lastPanel || s.panelWidth !== prev.panelWidth)
      void kv.set("ui.layout", { sidebarOpen: s.sidebarOpen, panel: s.panel, lastPanel: s.lastPanel, panelWidth: s.panelWidth });
  });
}

// Stores hold live connections; a hot swap would orphan them. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

