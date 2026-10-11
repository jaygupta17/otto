/**
 * Terminals on the agent machine. The list comes from the server, so
 * terminals opened on another device (or before a restart) show up too.
 */
import { create } from "zustand";
import type { PtyInfo } from "../lib/opencode/client";
import { TermSession } from "../lib/terminal";
import { openLink } from "../lib/preview";
import { useChat } from "./chat";
import { useUI, toast } from "./ui";

interface State {
  tabs: PtyInfo[];
  activeId: string | null;
  loaded: boolean;
  creating: boolean;
  load(): Promise<void>;
  create(cwd?: string): Promise<void>;
  close(id: string): Promise<void>;
  setActive(id: string): void;
}

/** Live xterm views, by PTY id. Kept outside React so they survive re-renders. */
const sessions = new Map<string, TermSession>();

export function terminalSession(id: string): TermSession | null {
  const st = useTerminals.getState();
  const client = useChat.getState().client;
  if (!client || !st.tabs.some((t) => t.id === id)) return null;
  let s = sessions.get(id);
  if (!s) {
    s = new TermSession(id, client, undefined, useUI.getState().resolvedTheme, openLink);
    sessions.set(id, s);
  }
  return s;
}

function disposeAll() {
  for (const s of sessions.values()) s.dispose();
  sessions.clear();
}

export const useTerminals = create<State>((set, get) => ({
  tabs: [],
  activeId: null,
  loaded: false,
  creating: false,

  async load() {
    const client = useChat.getState().client;
    if (!client) return;
    try {
      const list = (await client.ptys()).filter((p) => p.status === "running");
      if (useChat.getState().client !== client) return;
      set((s) => ({ tabs: list, loaded: true, activeId: list.some((p) => p.id === s.activeId) ? s.activeId : (list[0]?.id ?? null) }));
    } catch {
      set({ loaded: true });
    }
  },

  async create(cwd) {
    const client = useChat.getState().client;
    if (!client || get().creating) return;
    set({ creating: true });
    try {
      const n = get().tabs.length + 1;
      const p = await client.createPty({ cwd, title: `Terminal ${n}` });
      set((s) => ({ tabs: [...s.tabs, p], activeId: p.id }));
    } catch (e) {
      toast({ tone: "error", title: "Couldn't open a terminal", body: (e as Error).message });
    } finally {
      set({ creating: false });
    }
  },

  async close(id) {
    const client = useChat.getState().client;
    sessions.get(id)?.dispose();
    sessions.delete(id);
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      const tabs = s.tabs.filter((t) => t.id !== id);
      return { tabs, activeId: s.activeId === id ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.activeId };
    });
    await client?.removePty(id).catch(() => {});
  },

  setActive(id) {
    set({ activeId: id });
  },
}));

// A new workspace (or a reconnect to a different server) means different terminals.
useChat.subscribe((s, prev) => {
  if (s.client === prev.client) return;
  disposeAll();
  useTerminals.setState({ tabs: [], activeId: null, loaded: false });
});

useUI.subscribe((s, prev) => {
  if (s.resolvedTheme !== prev.resolvedTheme) for (const t of sessions.values()) t.setTheme(s.resolvedTheme);
});

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") for (const t of sessions.values()) t.wake();
  });
}
