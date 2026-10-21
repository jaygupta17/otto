/**
 * Teammates on the connected machine (see lib/teammates). Loaded whenever the
 * chat store binds a client, so pickers and the sidebar can show faces
 * without opening settings first.
 */
import { create } from "zustand";
import { readGlobalConfig, updateGlobalConfig, type AgentConfig } from "../lib/opencode/config";
import { withMemoryPlugin } from "../lib/memory";
import { CATALOG, compileAgent, hash, listNames, readTeammates, startingAgent, STARTER_TEAM, TEAMMATE_PROMPT_VERSION, updateTeammates, type Teammate } from "../lib/teammates";
import { useChat } from "./chat";
import { useExtensions } from "./extensions";
import { toast } from "./ui";

/** Fields the editor changes on the OpenCode side. `null` clears one. */
export type AgentPatch = { [K in "model" | "permissions" | "steps" | "disabled" | "hidden"]?: AgentConfig[K] | null };

interface State {
  /** null until the first load finishes for this connection. */
  byId: Record<string, Teammate> | null;
  /** The user turned memory off; writing agents then leaves the plugin out. */
  memoryOff: boolean;
  error: string | null;
  load(): Promise<void>;
  /** Create or update. Returns false (after a toast) when it didn't save. */
  save(t: Omit<Teammate, "created" | "updated" | "compiled">, agent: AgentPatch, opts: { isNew: boolean }): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /** Adds Otto's starter team (skips anyone already on the machine). */
  addStarters(): Promise<string[] | null>;
  /** Adds these teammates from Otto's catalogue, skipping anyone already on the machine. The ids added, or null when it failed. */
  hire(ids: string[]): Promise<string[] | null>;
  reset(): void;
}

function client() {
  const c = useChat.getState().client;
  if (!c) throw new Error("Not connected to a workspace.");
  return c;
}

let generation = 0;

export const useTeammates = create<State>((set, get) => ({
  byId: null,
  memoryOff: false,
  error: null,

  async load() {
    const gen = ++generation;
    try {
      const c = client();
      const file = await readTeammates(c);
      if (gen !== generation) return;
      set({ byId: file.teammates, memoryOff: file.memory === "off", error: null });
      syncPicked();
      await resync(Object.values(file.teammates), () => gen !== generation);
    } catch (e) {
      if (gen !== generation) return;
      // Missing file is an empty roster; anything else is worth showing.
      set({ byId: get().byId ?? {}, error: (e as Error).message });
    }
  },

  async save(input, agent, { isNew }) {
    try {
      const c = client();
      const now = Date.now();
      let saved: Teammate | undefined;
      const file = await updateTeammates(c, (f) => {
        const prev = f.teammates[input.id];
        if (isNew && prev) throw new Error(`A teammate called “${input.id}” already exists.`);
        saved = { ...input, created: prev?.created ?? now, updated: now, compiled: prev?.compiled ?? 0 };
        f.teammates[input.id] = saved;
      });
      // Publish the roster only once the agent is written and the config
      // reloaded: the editor remounts on `updated` and reads both together.
      try {
        await writeAgents([saved!], agent);
        await markCompiled([saved!.id]);
      } catch (e) {
        set({ byId: file.teammates });
        throw e;
      }
      syncPicked();
      toast({ tone: "ok", title: isNew ? `${saved!.name} joined the team` : "Teammate saved" });
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save teammate", body: (e as Error).message });
      return false;
    }
  },

  async remove(id) {
    try {
      const c = client();
      const name = get().byId?.[id]?.name ?? id;
      // A load or resync already reading the old roster must not put them back.
      generation++;
      // Agent first: if the second write fails, the leftover identity is
      // harmless and the next load would only recreate a working agent.
      await updateGlobalConfig(c, (cfg) => {
        const agents = { ...(cfg.agents ?? {}) };
        delete agents[id];
        return { ...cfg, agents };
      });
      const file = await updateTeammates(c, (f) => {
        delete f.teammates[id];
      });
      // Anything that read the roster before this write is now stale.
      generation++;
      set({ byId: file.teammates });
      // Refresh the catalog before choosing a replacement: `startingAgent`
      // only knows an id is gone once the server stops listing it.
      await afterConfigWrite();
      syncPicked(id);
      toast({ tone: "ok", title: `Removed ${name}` });
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't remove teammate", body: (e as Error).message });
      return false;
    }
  },

  addStarters() {
    return get().hire(STARTER_TEAM.map((t) => t.id));
  },

  async hire(ids) {
    try {
      const c = client();
      const now = Date.now();
      const have = get().byId ?? {};
      // An agent of the user's own under one of these ids stays theirs.
      const theirs = new Set(useChat.getState().agents.map((a) => a.id));
      const todo = ids.map((id) => CATALOG.find((t) => t.id === id)).filter((t): t is (typeof CATALOG)[number] => !!t && !have[t.id] && !theirs.has(t.id));
      if (!todo.length) {
        toast({ tone: "ok", title: ids.length > 1 ? "They're already on the team" : "Already on the team" });
        return [];
      }
      let added: Teammate[] = [];
      const file = await updateTeammates(c, (f) => {
        // Created in list order, so the menus show them in the order given.
        added = todo.map((t, i) => {
          const next: Teammate = { ...t, face: hash(t.id), created: now + i, updated: now + i, compiled: 0 };
          f.teammates[t.id] = next;
          return next;
        });
      });
      try {
        await writeAgents(added);
        await markCompiled(added.map((t) => t.id));
      } catch (e) {
        set({ byId: file.teammates });
        throw e;
      }
      syncPicked();
      toast({ tone: "ok", title: `${listNames(added.map((t) => t.name))} joined the team` });
      return added.map((t) => t.id);
    } catch (e) {
      toast({ tone: "error", title: ids.length > 1 ? "Couldn't add the team" : "Couldn't hire them", body: (e as Error).message });
      return null;
    }
  },

  reset() {
    generation++;
    set({ byId: null, memoryOff: false, error: null });
  },
}));

/**
 * Write each teammate's compiled agent into opencode.json in one go. Teammates
 * come with memory, so the plugin goes in too unless the user turned it off
 * (OpenCode installs it in the background after the reload).
 */
async function writeAgents(list: Teammate[], patch: AgentPatch = {}) {
  const memory = !useTeammates.getState().memoryOff;
  await updateGlobalConfig(client(), (cfg) => {
    const agents = { ...(cfg.agents ?? {}) };
    for (const t of list) {
      const next = compileAgent(t, agents[t.id]);
      for (const [k, v] of Object.entries(patch) as [keyof AgentPatch, unknown][]) {
        if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete next[k];
        else (next as Record<string, unknown>)[k] = v;
      }
      agents[t.id] = next;
    }
    return memory ? withMemoryPlugin({ ...cfg, agents }) : { ...cfg, agents };
  });
  await afterConfigWrite();
}

async function markCompiled(ids: string[]) {
  const file = await updateTeammates(client(), (f) => {
    for (const id of ids) if (f.teammates[id]) f.teammates[id].compiled = TEAMMATE_PROMPT_VERSION;
  });
  useTeammates.setState({ byId: file.teammates });
}

/**
 * Keep the picked agent one a new session can start with. Runs when the roster
 * or the agent catalog changes. Waits for both: an empty catalog or a roster
 * that hasn't loaded yet says nothing about what's valid.
 */
function syncPicked(removed?: string) {
  const chat = useChat.getState();
  const roster = useTeammates.getState().byId;
  if (!roster || !chat.agents.length) return;
  // A just-removed agent can still be in the catalog until the server reloads
  // its config, and the store must not keep starting sessions with them.
  const agents = removed ? chat.agents.filter((a) => a.id !== removed) : chat.agents;
  const next = startingAgent(chat.pickedAgent, roster, agents);
  if (next !== chat.pickedAgent) void chat.setAgent(next, null);
}

async function afterConfigWrite() {
  // Settings may hold a parsed copy; agents derive from config.
  if (useExtensions.getState().config) await useExtensions.getState().load(true);
  await useChat.getState().refreshCatalog();
}

/**
 * Recompile teammates whose agent is missing or was built by an older
 * prompt. Writes only when something is actually stale.
 */
async function resync(list: Teammate[], stale: () => boolean = () => false) {
  if (!list.length) return;
  const cfg = await readGlobalConfig(client());
  // Removal bumped the generation while this read was in flight: recompiling
  // now would write the removed teammate's agent back into the config.
  if (stale()) return;
  const todo = list.filter((t) => t.compiled < TEAMMATE_PROMPT_VERSION || !cfg.agents?.[t.id]);
  if (!todo.length) return;
  await writeAgents(todo);
  await markCompiled(todo.map((t) => t.id));
}

export function useTeammate(id: string | undefined | null) {
  return useTeammates((s) => (id ? s.byId?.[id] : undefined));
}

/** Display name: a teammate's own name, else the agent's. */
export function useAgentName(id: string | undefined | null) {
  const t = useTeammate(id);
  const info = useChat((s) => (id ? s.agents.find((a) => a.id === id) : undefined));
  if (!id) return "";
  return t?.name ?? info?.name ?? id.charAt(0).toUpperCase() + id.slice(1);
}

// Follow the connection: a new client means a different machine.
useChat.subscribe((s, prev) => {
  if (s.agents !== prev.agents) syncPicked();
  if (s.client === prev.client) return;
  useTeammates.getState().reset();
  if (s.client) void useTeammates.getState().load();
});
// Imported after the client was bound (a lazily loaded screen).
if (useChat.getState().client) void useTeammates.getState().load();

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
