/**
 * Teammate memory for the Memory panel (see lib/memory). Whether the plugin is
 * on for this machine, and what each project folder remembers. Reloads when
 * an agent's memory tool finishes, so the panel never shows a stale list.
 */
import { create } from "zustand";
import { readGlobalConfig, updateGlobalConfig } from "../lib/opencode/config";
import { updateTeammates } from "../lib/teammates";
import { addMemory, forgetMemory, isMemoryTool, memoryInstalled, readMemories, updateMemory, withMemoryPlugin, withoutMemoryPlugin, type Memory, type MemoryEntry } from "../lib/memory";
import { onToolSettled, useChat } from "./chat";
import { useExtensions } from "./extensions";
import { useTeammates } from "./teammates";
import { toast, useUI } from "./ui";

interface Folder {
  entries: MemoryEntry[] | null;
  error: string | null;
}

interface State {
  /** The plugin is in the machine's config. null until checked. */
  installed: boolean | null;
  byRoot: Record<string, Folder>;
  /** Set by "Show in Memory" in a chat; the panel takes it as its search. */
  query: string | null;
  checkInstalled(): Promise<void>;
  load(root: string): Promise<void>;
  setEnabled(on: boolean): Promise<boolean>;
  add(root: string, m: Omit<Memory, "ts">): Promise<boolean>;
  update(root: string, entry: MemoryEntry, patch: Pick<Memory, "content" | "type">): Promise<boolean>;
  forget(root: string, entry: MemoryEntry): Promise<boolean>;
  /** Open the panel, searching for `query`. */
  show(query?: string): void;
  takeQuery(): string | null;
  reset(): void;
}

function client() {
  const c = useChat.getState().client;
  if (!c) throw new Error("Not connected to a workspace.");
  return c;
}

let generation = 0;
const loads: Record<string, number> = {};

export const useMemory = create<State>((set, get) => ({
  installed: null,
  byRoot: {},
  query: null,

  async checkInstalled() {
    const gen = generation;
    try {
      const cfg = await readGlobalConfig(client());
      if (gen === generation) set({ installed: memoryInstalled(cfg) });
    } catch {
      if (gen === generation) set({ installed: false });
    }
  },

  async load(root) {
    const gen = generation;
    const n = (loads[root] = (loads[root] ?? 0) + 1);
    try {
      const entries = await readMemories(client(), root);
      if (gen !== generation || n !== loads[root]) return;
      set((s) => ({ byRoot: { ...s.byRoot, [root]: { entries, error: null } } }));
    } catch (e) {
      if (gen !== generation || n !== loads[root]) return;
      set((s) => ({ byRoot: { ...s.byRoot, [root]: { entries: s.byRoot[root]?.entries ?? null, error: (e as Error).message } } }));
    }
  },

  async setEnabled(on) {
    try {
      const c = client();
      // The roster flag first: teammate saves read it before writing the config.
      await updateTeammates(c, (f) => {
        if (on) delete f.memory;
        else f.memory = "off";
      });
      useTeammates.setState({ memoryOff: !on });
      const cfg = await updateGlobalConfig(c, (cfg) => (on ? withMemoryPlugin(cfg) : withoutMemoryPlugin(cfg)));
      set({ installed: memoryInstalled(cfg) });
      if (useExtensions.getState().config) await useExtensions.getState().load(true);
      toast(
        on
          ? { tone: "ok", title: "Memory is on", body: "Teammates can save and recall memories. The first time, it takes about a minute to set up." }
          : { tone: "ok", title: "Memory is off", body: "Saved memories stay in each project's .opencode/memory folder." },
      );
      return true;
    } catch (e) {
      toast({ tone: "error", title: on ? "Couldn't turn memory on" : "Couldn't turn memory off", body: (e as Error).message });
      return false;
    }
  },

  async add(root, m) {
    try {
      await addMemory(client(), root, m);
      await get().load(root);
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save memory", body: (e as Error).message });
      return false;
    }
  },

  async update(root, entry, patch) {
    try {
      await updateMemory(client(), root, entry, patch);
      await get().load(root);
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't change memory", body: (e as Error).message });
      void get().load(root);
      return false;
    }
  },

  async forget(root, entry) {
    try {
      await forgetMemory(client(), root, entry);
      await get().load(root);
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't delete memory", body: (e as Error).message });
      void get().load(root);
      return false;
    }
  },

  show(query) {
    set({ query: query ?? null });
    useUI.getState().openPanel("memory");
  },

  takeQuery() {
    const q = get().query;
    if (q !== null) set({ query: null });
    return q;
  },

  reset() {
    generation++;
    set({ installed: null, byRoot: {}, query: null });
  },
}));

/** True when a finished tool call read or changed memory (directly or inside a script). */
export function touchesMemory(name: string | undefined, metadata: Record<string, unknown> | undefined) {
  if (name && isMemoryTool(name)) return true;
  const calls = metadata?.toolCalls;
  return Array.isArray(calls) && calls.some((c) => typeof c?.tool === "string" && isMemoryTool(c.tool));
}

// An agent saved, changed or forgot something: refresh the folders on screen.
onToolSettled((t) => {
  if (!touchesMemory(t.name, t.metadata)) return;
  const s = useMemory.getState();
  for (const root of Object.keys(s.byRoot)) void s.load(root);
});

// A new client means a different machine.
useChat.subscribe((s, prev) => {
  if (s.client !== prev.client) useMemory.getState().reset();
});

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
