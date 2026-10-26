/**
 * What this session has presented, newest first.
 *
 * Nothing new travels over the wire: the agent calls `present`, and the call
 * is already a tool part of the session's timeline (projection.ts → Block).
 * This store is a small projection of those calls — one entry per call,
 * deduped by call id — plus whatever the user clicked open from chat (a path
 * in a tool row, a file in Context, a localhost link).
 *
 * The list is per session, capped, and never persisted: it records what the
 * agent showed *in this conversation*, and an artifact from yesterday would be
 * a different product.
 */
import { create } from "zustand";
import { useChat } from "./chat";
import { useUI } from "./ui";
import { checkFile } from "../lib/mdLinks";
import { classify, kindOfPath, parsePresent, resolveArtifactPath, titleFor, type ArtifactKind } from "../lib/artifacts";

export interface Artifact {
  /** Call id for a presented artifact; `local:<path>` or `url:<url>` for one the user opened. */
  id: string;
  sessionId: string;
  /** The source as given (a path, a URL, or markup). */
  source: string;
  title: string;
  kind: ArtifactKind;
  /** Absolute path, once the source is known to be inside the session root. */
  path?: string;
  /** The address to frame, for a URL. */
  url?: string;
  /** Raw HTML to frame through `srcDoc`. */
  markup?: string;
  /** Why this can't be shown (outside the folder, nothing there). */
  problem?: string;
  at: number;
}

/** Enough history for a working session without holding a whole page. */
const MAX_PER_SESSION = 24;
const MAX_MARKUP_TOTAL = 4_000_000;

interface ArtifactState {
  bySession: Record<string, Artifact[]>;
  /** The artifact each session is showing. */
  selected: Record<string, string | undefined>;
  /** Count of artifacts that arrived while the surface was closed, for the dock's pip. */
  fresh: number;
  /** Bumped when the artifact surface should show itself (a path clicked in chat). */
  request: number;
  /** A line to jump to in the file on show; `n` changes so the same line can be hit twice. */
  reveal: { path: string; line: number; n: number } | null;
  /** Record a `present` tool call. Idempotent per call id; does not open the panel. */
  presented(callId: string, input: Record<string, unknown> | undefined, sessionId: string, root: string, at?: number): Promise<void>;
  /** Show something the user asked for (a path from chat, a change in Context). */
  showLocal(sessionId: string, root: string, source: string, opts?: { title?: string; line?: number }): Promise<void>;
  /** Show a URL the user clicked; a localhost one goes through the port forwarding. */
  showUrl(sessionId: string, url: string): void;
  select(sessionId: string, id: string): void;
  /** The pip goes away once the surface has been seen. */
  seen(): void;
}

/**
 * Ids already recorded, so the timeline re-scan on every streaming event costs
 * one lookup. Kept after an entry is trimmed out of the list — a re-scan walks
 * the whole history, and a forgotten id would come back on every pass — with a
 * cap so a very long-running app can't grow it without bound.
 */
const known = new Map<string, true>();
const KNOWN_MAX = 50_000;

function remember(id: string) {
  known.set(id, true);
  if (known.size > KNOWN_MAX) {
    const oldest = known.keys().next();
    if (!oldest.done) known.delete(oldest.value);
  }
}

const markupSize = (a: Artifact) => a.markup?.length ?? 0;

function totalMarkup(bySession: Record<string, Artifact[]>): number {
  let n = 0;
  for (const list of Object.values(bySession)) for (const a of list) n += markupSize(a);
  return n;
}

/** Put `a` at the front of its session, capped, and drop the oldest markup when there's too much. */
function insert(bySession: Record<string, Artifact[]>, a: Artifact): Record<string, Artifact[]> {
  const next: Record<string, Artifact[]> = { ...bySession };
  const list = next[a.sessionId] ?? [];
  const merged = list.some((x) => x.id === a.id) ? list : [a, ...list];
  // Newest first by when the call started, whatever order the checks finished in.
  const ordered = [...merged].sort((x, y) => y.at - x.at);
  next[a.sessionId] = ordered.slice(0, MAX_PER_SESSION);
  // Oldest markup in the whole store pays for the newest, so one agent can't
  // park megabytes of HTML in memory by presenting a page every minute.
  let total = totalMarkup(next);
  while (total > MAX_MARKUP_TOTAL) {
    const oldest = Object.values(next)
      .flat()
      .filter((x) => !!x.markup)
      .sort((x, y) => x.at - y.at)[0];
    if (!oldest) break;
    next[oldest.sessionId] = next[oldest.sessionId].filter((x) => x.id !== oldest.id);
    total -= markupSize(oldest);
  }
  return next;
}

type Built = { ok: true; artifact: Artifact } | { ok: false; problem: string };

/**
 * Build an entry from a source. Paths are held to the session root here
 * (`resolveArtifactPath`), then checked for existence once (`checkFile`).
 */
async function build(callId: string, sessionId: string, root: string, source: string, opts: { title?: string; as?: ArtifactKind; at?: number } = {}): Promise<Built> {
  const shaped = classify(source, opts.as);
  if ("problem" in shaped) return { ok: false, problem: shaped.problem };
  const title = opts.title || titleFor(source, opts.as);
  if (shaped.kind === "markup") return { ok: true, artifact: { id: callId, sessionId, source, title, kind: "html", markup: shaped.markup, at: opts.at ?? Date.now() } };
  if (shaped.kind === "url") return { ok: true, artifact: { id: callId, sessionId, source, title, kind: "url", url: shaped.url, at: opts.at ?? Date.now() } };

  const within = resolveArtifactPath(root, shaped.path);
  // `as` names the renderer (a file the agent wants read as text, or framed as
  // a page); otherwise the extension does.
  const kind = opts.as ?? kindOfPath(shaped.path);
  if ("problem" in within) return { ok: true, artifact: { id: callId, sessionId, source, title, kind, problem: within.problem, at: opts.at ?? Date.now() } };
  const artifact: Artifact = { id: callId, sessionId, source, title, kind, path: within.path, at: opts.at ?? Date.now() };
  const client = useChat.getState().client;
  if (client) {
    // A check that can't run (no budget, an RPC that failed) reports false;
    // the renderer still tries the file and says so itself if it isn't there.
    if ((await checkFile(client, root, within.path).catch(() => true)) === false) artifact.problem = "Couldn't find that file in this session's folder.";
  }
  return { ok: true, artifact };
}

export const useArtifacts = create<ArtifactState>((set, get) => ({
  bySession: {},
  selected: {},
  fresh: 0,
  request: 0,
  reveal: null,

  async presented(callId, input, sessionId, root, at) {
    if (!sessionId || !callId || known.has(callId)) return;
    remember(callId);
    const parsed = parsePresent(input);
    const when = at ?? Date.now();
    let artifact: Artifact;
    if ("problem" in parsed) {
      artifact = { id: callId, sessionId, source: "", title: "Presentation", kind: "text", problem: parsed.problem, at: when };
    } else {
      const built = await build(callId, sessionId, root, parsed.source, { title: parsed.title, as: parsed.as, at: when });
      artifact = built.ok ? built.artifact : { id: callId, sessionId, source: parsed.source, title: parsed.title || titleFor(parsed.source, parsed.as), kind: "text", problem: built.problem, at: when };
    }
    set((s) => ({ bySession: insert(s.bySession, artifact), selected: { ...s.selected, [sessionId]: artifact.id } }));
    // Something the user hasn't looked at yet lights the dock.
    if (useUI.getState().panel !== "artifact") set((s) => ({ fresh: s.fresh + 1 }));
  },

  async showLocal(sessionId, root, source, opts = {}) {
    const id = `local:${source}`;
    if (!known.has(id)) {
      remember(id);
      const built = await build(id, sessionId, root, source, { title: opts.title });
      const artifact: Artifact = built.ok ? built.artifact : { id, sessionId, source, title: opts.title || source, kind: "text", problem: built.problem, at: Date.now() };
      set((s) => ({ bySession: insert(s.bySession, artifact) }));
    }
    set((s) => ({ selected: { ...s.selected, [sessionId]: id } }));
    if (opts.line && opts.line > 0) {
      const path = get().bySession[sessionId]?.find((a) => a.id === id)?.path ?? source;
      set((s) => ({ reveal: { path, line: opts.line!, n: (s.reveal?.n ?? 0) + 1 } }));
    }
    useUI.getState().openPanel("artifact");
    set((s) => ({ request: s.request + 1 }));
  },

  showUrl(sessionId, url) {
    const id = `url:${url}`;
    if (!known.has(id)) {
      remember(id);
      const artifact: Artifact = { id, sessionId, source: url, url, title: titleFor(url), kind: "url", at: Date.now() };
      set((s) => ({ bySession: insert(s.bySession, artifact) }));
    }
    set((s) => ({ selected: { ...s.selected, [sessionId]: id } }));
    useUI.getState().openPanel("artifact");
    set((s) => ({ request: s.request + 1 }));
  },

  select(sessionId, id) {
    set((s) => ({ selected: { ...s.selected, [sessionId]: id } }));
  },

  seen() {
    if (get().fresh) set({ fresh: 0 });
  },
}));

/** The artifacts a chat shows: its own, then its subagents' (who present on its behalf). */
export function artifactsFor(bySession: Record<string, Artifact[]>, sessionId: string | null, parents: Record<string, string>): Artifact[] {
  if (!sessionId) return [];
  const mine = bySession[sessionId] ?? [];
  const children = Object.keys(parents)
    .filter((id) => parents[id] === sessionId)
    .flatMap((id) => bySession[id] ?? []);
  if (!children.length) return mine;
  return [...mine, ...children].sort((a, b) => b.at - a.at).slice(0, MAX_PER_SESSION);
}

/** The artifact on show for a session, defaulting to the newest. */
export function selectedArtifact(selected: string | undefined, list: Artifact[]): Artifact | null {
  if (!list.length) return null;
  return list.find((a) => a.id === selected) ?? list[0];
}

/** Show a file the user asked for from the chat (a tool row, Context's changes). */
export function showFile(root: string, path: string, line?: number) {
  const sid = useChat.getState().activeId;
  if (!sid) return;
  void useArtifacts.getState().showLocal(sid, root, path, { line });
}

/** Whether a tool call is the `present` tool (`present`, or namespaced `otto.present`). */
export function isPresentTool(name?: string): boolean {
  const t = name?.trim().toLowerCase().replace(/:\d+$/, "") ?? "";
  return (t.includes(".") ? t.split(".").filter(Boolean).pop() : t) === "present";
}
