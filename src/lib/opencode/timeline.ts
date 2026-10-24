/**
 * Paging and merging for a session's timeline. Long sessions hold multi-MB
 * tool output, so the store reads a small page instead of the whole history,
 * and after a turn it refreshes only the tail. Pure helpers: the store owns
 * state, the client owns transport.
 */
import type { SessionMessagesResponse } from "@opencode/client";
import type { InboxItem } from "./client";
import { projectHistory, userMessage, type UIMessage } from "./projection";

/** The part of `OpenCode` a page read needs (a fake in tests). */
export interface TimelineSource {
  messages(id: string, query: { limit?: number; cursor?: string; order?: "asc" | "desc"; signal?: AbortSignal }): Promise<SessionMessagesResponse>;
  inbox(id: string, signal?: AbortSignal): Promise<InboxItem[]>;
}

export interface TimelinePage {
  /** Projected messages, oldest first, including pending inbox sends. */
  messages: UIMessage[];
  /** Cursor for the page before this one, if any. */
  older: string | null;
}

export interface TimelinePageRequest {
  limit: number;
  /** Smaller page to ask for once if the first read fails or times out. */
  retryLimit: number;
  timeoutMs: number;
  order?: "asc" | "desc";
  cursor?: string;
  signal?: AbortSignal;
}

function abortError(message: string) {
  const e = new Error(message);
  e.name = "AbortError";
  return e;
}

/** Run `fn` with a signal that aborts after `ms`, or when `outer` does. */
export async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal): Promise<T> {
  if (outer?.aborted) throw abortError("Aborted");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(abortError(`Timed out after ${ms}ms`)), ms);
  const onAbort = () => ctrl.abort(outer?.reason);
  outer?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}

function toPage(r: SessionMessagesResponse, inbox: InboxItem[]): TimelinePage {
  const messages = projectHistory([...r.data].reverse());
  // Messages sent during a run that the agent hasn't read yet.
  for (const it of inbox) if (it.type === "user") messages.push({ ...userMessage(it.id, it.payload.text ?? "", it.payload.files, it.payload.metadata, it.time.created), pending: true, delivery: it.delivery });
  return { messages, older: r.cursor?.next ?? null };
}

/**
 * Read one page of history with a deadline. A page that times out or fails is
 * retried once with `retryLimit`: on a large session the difference between a
 * 12-message page and the last 4 is often the difference between 2 MB and a
 * few KB. The inbox only decorates the page, so its failure never fails it.
 */
export async function fetchTimelinePage(source: TimelineSource, sessionID: string, req: TimelinePageRequest): Promise<TimelinePage> {
  const read = async (limit: number) => {
    const [r, inbox] = await Promise.all([
      withTimeout((signal) => source.messages(sessionID, { limit, cursor: req.cursor, order: req.cursor ? undefined : req.order ?? "desc", signal }), req.timeoutMs, req.signal),
      withTimeout((signal) => source.inbox(sessionID, signal), req.timeoutMs, req.signal).catch(() => [] as InboxItem[]),
    ]);
    return toPage(r, inbox);
  };
  try {
    return await read(req.limit);
  } catch (e) {
    // The caller went away: a retry would only hold the connection longer.
    if (req.signal?.aborted) throw e;
    return read(req.retryLimit);
  }
}

const isOptimistic = (m: UIMessage) => m.kind === "user" && !!m.pending && m.id.startsWith("local_");

/** Last copy of an id wins; a snapshot shouldn't repeat one, but a merge must not either. */
function uniqueByID(list: UIMessage[]): UIMessage[] {
  if (new Set(list.map((m) => m.id)).size === list.length) return list;
  const last = new Map<string, UIMessage>();
  for (const m of list) last.set(m.id, m);
  return list.filter((m) => last.get(m.id) === m);
}

/**
 * Fold a freshly read tail into a loaded timeline: replace messages we already
 * have by id, append the ones we don't, and keep everything older untouched.
 * Optimistic sends the server hasn't echoed stay at the very end; one whose
 * text the tail now holds is dropped rather than shown twice.
 */
export function mergeTail(current: UIMessage[], tail: UIMessage[]): UIMessage[] {
  const incoming = uniqueByID(tail);
  if (!incoming.length) return current;
  const byID = new Map(incoming.map((m) => [m.id, m]));
  const matched = new Set<string>();
  const out: UIMessage[] = [];
  for (const m of current) {
    const fresh = byID.get(m.id);
    if (fresh) {
      out.push(fresh);
      matched.add(m.id);
    } else out.push(m);
  }
  // The tail's new messages belong before any optimistic send, never after.
  let split = out.length;
  while (split > 0 && isOptimistic(out[split - 1])) split--;
  const echoed = new Set(incoming.flatMap((m) => (m.kind === "user" ? [m.text] : [])));
  const optimistic = out.slice(split).filter((m) => m.kind !== "user" || !echoed.has(m.text));
  const fresh = incoming.filter((m) => !matched.has(m.id));
  return [...out.slice(0, split), ...fresh, ...optimistic];
}
