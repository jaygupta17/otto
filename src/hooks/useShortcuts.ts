import { useEffect } from "react";
import { useChat } from "../state/chat";
import { useUI, type PanelSurface } from "../state/ui";
import { cycleEffort } from "../lib/actions";
import { isMac } from "../lib/platform";
import { layerOpen } from "../lib/layers";

/** ⌘ on macOS, Ctrl elsewhere. */
export const isMod = (e: KeyboardEvent | React.KeyboardEvent) => (isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);

/** Mac-style key label ("⌘⇧E") as this platform spells it ("Ctrl+Shift+E" off macOS). */
export function kbd(keys: string): string {
  if (isMac()) return keys;
  return keys
    .split(" ")
    .map((chord) => {
      const parts: string[] = [];
      let rest = chord;
      const mods: [string, string][] = [["⌘", "Ctrl"], ["⌃", "Ctrl"], ["⌥", "Alt"], ["⇧", "Shift"]];
      for (;;) {
        const m = mods.find(([sym]) => rest.startsWith(sym));
        if (!m || rest.length === 1) break;
        if (!parts.includes(m[1])) parts.push(m[1]);
        rest = rest.slice(1);
      }
      return parts.length ? [...parts, rest].join("+") : rest;
    })
    .join(" ");
}

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.matches("input, textarea, select, .xterm-helper-textarea"));

/** Letter of a key press, layout-safe for shortcuts (falls back to the physical key for non-Latin layouts). */
const letter = (e: KeyboardEvent) => (/^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.key.toLowerCase());

export interface Shortcut {
  keys: string;
  label: string;
  group: "General" | "Sessions" | "Composer" | "Panels";
}

/** Shown in the shortcuts sheet (⌘/). Keep in sync with the handler below. */
export const SHORTCUTS: Shortcut[] = [
  { keys: "⌘K", label: "Command palette", group: "General" },
  { keys: "⌘P", label: "Go to session", group: "General" },
  { keys: "⌘,", label: "Settings", group: "General" },
  { keys: "⌘/", label: "Keyboard shortcuts", group: "General" },
  { keys: "⌘N", label: "New session", group: "Sessions" },
  { keys: "⌥↑ ⌥↓", label: "Previous / next session", group: "Sessions" },
  { keys: "⌘.", label: "Stop the agent", group: "Sessions" },
  { keys: "⌘L", label: "Focus the composer", group: "Composer" },
  { keys: "Tab ⇧Tab", label: "Next / previous agent", group: "Composer" },
  { keys: "⌃T", label: "Cycle thinking effort", group: "Composer" },
  { keys: "@", label: "Mention a file", group: "Composer" },
  { keys: "/", label: "Commands: /compact /undo /redo /fork", group: "Composer" },
  { keys: "!", label: "Run a shell command", group: "Composer" },
  { keys: "Enter", label: "While working: steer or queue", group: "Composer" },
  { keys: "Esc", label: "Stop, or leave the composer", group: "Composer" },
  { keys: "⌘B", label: "Toggle sidebar", group: "Panels" },
  { keys: "⌘⇧E", label: "Files", group: "Panels" },
  { keys: "⌃`", label: "Terminal", group: "Panels" },
  { keys: "⌘⇧B", label: "Browser", group: "Panels" },
  { keys: "⌘⇧I", label: "Context and changes", group: "Panels" },
  { keys: "⌘⇧J", label: "Project instructions", group: "Panels" },
  { keys: "⌘⇧M", label: "Memory", group: "Panels" },
  { keys: "⌘⇧\\", label: "Close the right panel", group: "Panels" },
];

const PANEL_KEYS: Record<string, PanelSurface> = { e: "files", b: "browser", i: "context", j: "project", m: "memory" };

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const ui = useUI.getState();
      const chat = useChat.getState();
      // ⌃T works everywhere, including inside the composer (but not the terminal, where it's a shell key).
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && letter(e) === "t" && !(e.target as HTMLElement)?.closest?.(".xterm")) {
        e.preventDefault();
        cycleEffort();
        return;
      }
      // ⌥↑/↓ switches sessions, but not in text fields (paragraph / line moves there) or behind a dialog.
      if (e.altKey && !e.metaKey && !e.ctrlKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !editable(e.target) && !layerOpen()) {
        e.preventDefault();
        const list = Object.values(chat.sessions).sort((a, b) => b.time.updated - a.time.updated);
        const i = list.findIndex((s) => s.id === chat.activeId);
        const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
        if (next) chat.open(next.id);
        return;
      }
      // ⌃` toggles the terminal, like most editors.
      if (e.ctrlKey && !e.metaKey && e.code === "Backquote") {
        e.preventDefault();
        ui.togglePanel("terminal");
        return;
      }
      if (!isMod(e) || e.altKey) return;
      const k = letter(e);
      // Shifted panel keys first: ⌘⇧B is the browser, ⌘B the sidebar.
      if (e.shiftKey && PANEL_KEYS[k]) {
        e.preventDefault();
        ui.togglePanel(PANEL_KEYS[k]);
      } else if (e.shiftKey && (k === "\\" || k === "|" || e.code === "Backslash")) {
        e.preventDefault();
        ui.closePanel();
      } else if (e.shiftKey) {
        return;
      } else if (k === "k" || k === "p") {
        e.preventDefault();
        ui.setPalette(!ui.paletteOpen);
      } else if (k === "b") {
        e.preventDefault();
        ui.toggleSidebar();
      } else if (k === "n") {
        e.preventDefault();
        chat.open(null);
      } else if (k === ",") {
        e.preventDefault();
        ui.openSettings();
      } else if (k === "/" || e.code === "Slash") {
        e.preventDefault();
        ui.setShortcuts(!ui.shortcutsOpen);
      } else if (k === "." && chat.activeId && chat.busy[chat.activeId]) {
        e.preventDefault();
        void chat.interrupt(chat.activeId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
