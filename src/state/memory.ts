/**
 * The Memory panel's state: whether the `memory/context.md` instruction is
 * installed, the current text of that file, and the index of everything else
 * in the memory folder. Files are plain markdown on the connected machine;
 * this store only reads and writes them through the OpenCode file API.
 */
import { create } from "zustand";
import { readGlobalConfig } from "../lib/opencode/config";
import { updateTeammates } from "../lib/teammates";
import { installMemory, memoryInstalled, memoryPaths, readMemoryFile, readMemoryState, removeMemory, writeMemoryFile, type MemoryFile } from "../lib/memory";
import { useChat } from "./chat";
import { useExtensions } from "./extensions";
import { useTeammates } from "./teammates";
import { toast, useUI } from "./ui";

interface State {
  /** The instruction is in the machine's global config. null until checked. */
  installed: boolean | null;
  /** context.md; empty when it doesn't exist yet. */
  context: string;
  /** Every file in memory/, context.md included. null until loaded. */
  files: MemoryFile[] | null;
  /** Absolute path of the file open in the panel editor, if any. */
  active: string | null;
  loading: boolean;
  error: string | null;
  checkInstalled(): Promise<void>;
  load(): Promise<void>;
  setEnabled(on: boolean): Promise<boolean>;
  /** Text of one file; also makes it the active one. */
  read(path: string): Promise<string | null>;
  saveContext(text: string): Promise<boolean>;
  saveFile(path: string, text: string): Promise<boolean>;
  closeFile(): void;
  /** Open the Memory panel. */
  show(): void;
  reset(): void;
}

function client() {
  const c = useChat.getState().client;
  if (!c) throw new Error("Not connected to a workspace.");
  return c;
}

let generation = 0;

export const useMemory = create<State>((set, get) => ({
  installed: null,
  context: "",
  files: null,
  active: null,
  loading: false,
  error: null,

  async checkInstalled() {
    const gen = generation;
    try {
      const cfg = await readGlobalConfig(client());
      if (gen === generation) set({ installed: memoryInstalled(cfg) });
    } catch {
      if (gen === generation) set({ installed: false });
    }
  },

  async load() {
    const gen = generation;
    set({ loading: true, error: null });
    try {
      const state = await readMemoryState(client());
      if (gen !== generation) return;
      set({ context: state.context, files: state.files, loading: false });
    } catch (e) {
      if (gen !== generation) return;
      set({ loading: false, error: (e as Error).message });
    }
  },

  async setEnabled(on) {
    try {
      const c = client();
      // The roster flag first: writing agents reads it before touching the config.
      await updateTeammates(c, (f) => {
        if (on) delete f.memory;
        else f.memory = "off";
      });
      useTeammates.setState({ memoryOff: !on });
      let root = "";
      if (on) root = (await installMemory(c)).root;
      else await removeMemory(c);
      set({ installed: on });
      if (useExtensions.getState().config) await useExtensions.getState().load(true);
      await get().load();
      toast(
        on
          ? { tone: "ok", title: "Memory is on", body: `Teammates keep notes in ${root || "the memory folder"}. context.md is added to every new session.` }
          : { tone: "ok", title: "Memory is off", body: "The folder and its files stay; context.md is no longer injected into new sessions." },
      );
      return true;
    } catch (e) {
      toast({ tone: "error", title: on ? "Couldn't turn memory on" : "Couldn't turn memory off", body: (e as Error).message });
      return false;
    }
  },

  async read(path) {
    set({ active: path, error: null });
    try {
      return await readMemoryFile(client(), path);
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
    }
  },

  async saveContext(text) {
    try {
      const { context } = await memoryPaths(client());
      await writeMemoryFile(client(), context, text);
      set({ context: text, error: null });
      await get().load();
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save context.md", body: (e as Error).message });
      return false;
    }
  },

  async saveFile(path, text) {
    try {
      await writeMemoryFile(client(), path, text);
      set({ error: null });
      await get().load();
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save this file", body: (e as Error).message });
      return false;
    }
  },

  closeFile() {
    set({ active: null });
  },

  show() {
    set({ active: null });
    useUI.getState().openPanel("memory");
  },

  reset() {
    generation++;
    set({ installed: null, context: "", files: null, active: null, loading: false, error: null });
  },
}));

// A new client means a different machine.
useChat.subscribe((s, prev) => {
  if (s.client !== prev.client) useMemory.getState().reset();
});

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
