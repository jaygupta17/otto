/**
 * Commands running on the connected machine (OpenCode's `/api/shell`), kept
 * live from `shell.*` events and re-listed on every (re)connect. Background
 * calls in the chat read their state here until their report arrives, and the
 * strip above the composer lists what's still going.
 */
import { create } from "zustand";
import type { V2Event } from "../lib/opencode/events";
import type { ShellInfo } from "../lib/opencode/client";
import { shellStopNote } from "../lib/opencode/tools";
import { sortedSessions, useChat } from "./chat";
import { toast } from "./ui";

export type ShellLite = { id: string; command: string; status: ShellInfo["status"]; sessionID?: string; started: number; exit?: number };

/** What we've read of a command's output: the tail, and where the next read starts. */
type Tail = { text: string; cursor: number; size: number };

/** Kept per command while you watch it; plenty for a log, cheap to hold. */
const TAIL_BYTES = 256 * 1024;

interface State {
  byId: Record<string, ShellLite>;
  tails: Record<string, Tail>;
  /** Stopped from here: the row says so before the server's notice lands. */
  stopped: Record<string, true>;
  ingest(e: V2Event): void;
  load(): Promise<void>;
  /** Read whatever output arrived since the last read. */
  read(id: string): Promise<void>;
  /** Tell the agent it was you, then kill it. */
  stop(id: string): Promise<void>;
  reset(): void;
}

let generation = 0;
const reading = new Set<string>();

const fromInfo = (s: ShellInfo): ShellLite => ({
  id: s.id,
  command: s.command,
  status: s.status,
  sessionID: typeof s.metadata?.sessionID === "string" ? s.metadata.sessionID : undefined,
  started: s.time?.started ?? Date.now(),
  exit: s.exit,
});

export const useShells = create<State>((set, get) => ({
  byId: {},
  tails: {},
  stopped: {},

  ingest(e) {
    const d = (e as { data?: Record<string, unknown> }).data ?? {};
    if (e.type === "shell.created") {
      const info = d.info as ShellInfo | undefined;
      if (info?.id) set((s) => ({ byId: { ...s.byId, [info.id]: fromInfo(info) } }));
    } else if (e.type === "shell.exited") {
      const id = d.id as string;
      const prev = get().byId[id];
      if (!prev) return;
      set((s) => ({ byId: { ...s.byId, [id]: { ...prev, status: (d.status as ShellLite["status"]) ?? "exited", exit: d.exit as number | undefined } } }));
      // The last lines, for anyone watching it.
      if (get().tails[id] && !get().stopped[id]) void get().read(id);
    } else if (e.type === "shell.deleted") {
      const id = d.id as string;
      const prev = get().byId[id];
      if (prev?.status === "running") set((s) => ({ byId: { ...s.byId, [id]: { ...prev, status: "killed" } } }));
    }
  },

  async load() {
    const client = useChat.getState().client;
    if (!client) return;
    const gen = generation;
    // The list is per location: the server's own, and where recent chats work.
    const dirs = new Set<string | undefined>([undefined]);
    for (const s of sortedSessions(useChat.getState().sessions).slice(0, 12)) if (s.location?.directory) dirs.add(s.location.directory);
    const lists = await Promise.all([...dirs].map((d) => client.shells(d).catch(() => [] as ShellInfo[])));
    if (gen !== generation) return;
    const next: Record<string, ShellLite> = {};
    for (const list of lists) for (const s of list) next[s.id] = fromInfo(s);
    // Anything we thought was running and the server no longer lists has gone.
    const prev = get().byId;
    for (const [id, s] of Object.entries(prev)) if (!next[id]) next[id] = s.status === "running" ? { ...s, status: "killed" } : s;
    set({ byId: next });
  },

  async read(id) {
    const client = useChat.getState().client;
    if (!client || reading.has(id)) return;
    reading.add(id);
    const gen = generation;
    try {
      let tail = get().tails[id];
      // First look: start near the end of a long log instead of reading it all.
      if (!tail) {
        const head = await client.shellOutputFrom(id, 0, 1);
        tail = { text: "", cursor: Math.max(0, head.size - TAIL_BYTES), size: head.size };
      }
      const r = await client.shellOutputFrom(id, tail.cursor);
      if (gen !== generation) return;
      const text = (tail.text + r.output).slice(-TAIL_BYTES);
      set((s) => ({ tails: { ...s.tails, [id]: { text, cursor: r.cursor, size: r.size } } }));
    } catch {
      // Gone (stopped, or the server forgot it): keep what we read.
    } finally {
      reading.delete(id);
    }
  },

  async stop(id) {
    const chat = useChat.getState();
    const client = chat.client;
    const sh = get().byId[id];
    if (!client) return;
    set((s) => ({ stopped: { ...s.stopped, [id]: true } }));
    // Killing it drops its output, so keep the last of it for the row.
    await get().read(id);
    try {
      // The note waits for the agent's next turn (resume: false), ahead of the
      // server's "not found" notice, so the agent reads the stop as yours.
      if (sh?.sessionID) await client.synthetic(sh.sessionID, { ...shellStopNote(id, sh.command), resume: false }).catch(() => {});
      await client.removeShell(id);
      if (sh) set((s) => ({ byId: { ...s.byId, [id]: { ...sh, status: "killed" } } }));
    } catch (e) {
      set((s) => {
        const stopped = { ...s.stopped };
        delete stopped[id];
        return { stopped };
      });
      toast({ tone: "error", title: "Couldn't stop the command", body: (e as Error).message });
    }
  },

  reset() {
    generation++;
    reading.clear();
    set({ byId: {}, tails: {}, stopped: {} });
  },
}));

/** Is `sid` this session or one working for it (a subagent's own subagents count too)? */
export function inTree(parents: Record<string, string>, sid: string | undefined, root: string) {
  for (let s: string | undefined = sid, i = 0; s && i < 8; s = parents[s], i++) if (s === root) return true;
  return false;
}

// Follow the connection: a new client means a different machine.
useChat.subscribe((s, prev) => {
  if (s.client !== prev.client) return useShells.getState().reset();
  // Sessions arrive after the stream connects: list again once we know where they work.
  if (s.client && !Object.keys(prev.sessions).length && Object.keys(s.sessions).length) void useShells.getState().load();
});
