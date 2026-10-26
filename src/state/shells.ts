/**
 * Commands running on the connected machine (OpenCode's `/api/shell`), kept
 * live from `shell.*` events and re-listed on every (re)connect. Background
 * calls in the chat read their state here until their report arrives, and the
 * strip above the composer lists what's still going.
 */
import { useEffect, useMemo } from "react";
import { create } from "zustand";
import type { V2Event } from "../lib/opencode/events";
import type { ShellInfo } from "../lib/opencode/client";
import { backgroundShellID, inputOf, shellStopNote, toolKind } from "../lib/opencode/tools";
import { sortedSessions, useChat, type Timeline } from "./chat";
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
/** Which location last listed a command, so a failed fetch there doesn't prune it. */
const dirOf = new Map<string, string>();

/**
 * Fetch shells for each location in parallel. A location whose request failed
 * is left out of `replaced`, so its commands are kept rather than pruned.
 */
async function fetchShells(dirs: Array<string | undefined>, fetch: (directory?: string) => Promise<ShellInfo[]>) {
  // Async, so a fetch that throws outright settles as a failure like any other.
  const results = await Promise.allSettled(dirs.map(async (d) => fetch(d)));
  const fresh: Array<{ dir: string; items: ShellInfo[] }> = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") fresh.push({ dir: dirs[i] ?? "", items: r.value });
  });
  return { fresh, replaced: new Set(fresh.map((f) => f.dir)) };
}

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
    // Snapshot before the fetch: anything created or updated meanwhile is newer than the reply.
    const before = new Map(Object.entries(get().byId).map(([id, s]) => [id, s.status]));
    const { fresh, replaced } = await fetchShells([...dirs], (d) => client.shells(d));
    if (gen !== generation) return;
    const next: Record<string, ShellLite> = {};
    for (const { dir, items } of fresh) {
      for (const s of items) {
        next[s.id] = fromInfo(s);
        dirOf.set(s.id, dir);
      }
    }
    // A command stays unless the location that listed it answered and dropped it.
    const prev = get().byId;
    for (const [id, s] of Object.entries(prev)) {
      // Arrived or changed while the fetch was in flight: the reply can predate it.
      if (before.get(id) !== s.status) {
        next[id] = s;
        continue;
      }
      if (next[id]) continue;
      const dir = dirOf.get(id);
      // Never listed here (or its location failed): nothing says it's gone.
      if (dir === undefined || !replaced.has(dir)) {
        next[id] = s;
        continue;
      }
      // Gone: the server no longer lists it.
      next[id] = s.status === "running" ? { ...s, status: "killed" } : s;
    }
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
    dirOf.clear();
    set({ byId: {}, tails: {}, stopped: {} });
  },
}));

/** Is `sid` this session or one working for it (a subagent's own subagents count too)? */
export function inTree(parents: Record<string, string>, sid: string | undefined, root: string) {
  for (let s: string | undefined = sid, i = 0; s && i < 8; s = parents[s], i++) if (s === root) return true;
  return false;
}

/**
 * Whether a call is still waiting on this command: a foreground `shell` shows
 * in that call's row, not as something left running. Only the live event
 * names the shell a call started; a call read back from history doesn't, so
 * that one matches by its command. A session that isn't busy waits on
 * nothing; one whose conversation isn't read yet counts as waiting until it
 * is (`useLeftRunning` reads it), so a teammate's own command never flashes up
 * as a second thing running.
 */
export function waitedOn(chat: { busy: Record<string, boolean>; timelines: Record<string, Timeline | undefined> }, sh: ShellLite): boolean {
  const sid = sh.sessionID;
  if (!sid || !chat.busy[sid]) return false;
  const t = chat.timelines[sid];
  if (!t || (!t.loaded && !t.error)) return true;
  for (const m of t.messages.slice(-3)) {
    if (m.kind !== "assistant") continue;
    for (const b of m.blocks) {
      if (b.kind !== "tool" || toolKind(b.name) !== "shell" || (b.status !== "running" && b.status !== "streaming") || backgroundShellID(b)) continue;
      const id = b.metadata?.shellID;
      if (typeof id === "string" ? id === sh.id : inputOf(b).command === sh.command) return true;
    }
  }
  return false;
}

/**
 * Commands under `root` (its own, or a teammate's down its tree) still
 * running with no call waiting on them: what the strip and a session's row
 * list as running in the background.
 */
export function useLeftRunning(root: string): ShellLite[] {
  const running = useShells((s) =>
    Object.values(s.byId)
      .filter((sh) => sh.status === "running" && !s.stopped[sh.id])
      .map((sh) => sh.id)
      .join(" "),
  );
  const list = () => (running ? running.split(" ").flatMap((id) => useShells.getState().byId[id] ?? []) : []);
  // Busy sessions with a command running whose conversation isn't read yet: read it, so `waitedOn` can tell.
  const unread = useChat((c) =>
    list()
      .flatMap((sh) => (sh.sessionID && c.busy[sh.sessionID] && !c.timelines[sh.sessionID] && inTree(c.parents, sh.sessionID, root) ? [sh.sessionID] : []))
      .join(" "),
  );
  useEffect(() => {
    for (const id of new Set(unread.split(" "))) if (id) void useChat.getState().loadTimeline(id);
  }, [unread]);
  const left = useChat((c) =>
    list()
      .filter((sh) => inTree(c.parents, sh.sessionID, root) && !waitedOn(c, sh))
      .map((sh) => sh.id)
      .join(" "),
  );
  return useMemo(() => (left ? left.split(" ").flatMap((id) => useShells.getState().byId[id] ?? []) : []), [left]);
}

// Follow the connection: a new client means a different machine.
useChat.subscribe((s, prev) => {
  if (s.client !== prev.client) return useShells.getState().reset();
  // Sessions arrive after the stream connects: list again once we know where they work.
  if (s.client && !Object.keys(prev.sessions).length && Object.keys(s.sessions).length) void useShells.getState().load();
});
