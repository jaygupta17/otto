import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo, SessionMessagesResponse } from "@opencode/client";
import { fetchTimelinePage, mergeTail, type TimelineSource } from "./timeline";
import type { UIMessage } from "./projection";
import type { InboxItem } from "./client";
import { TIMELINE_OLDER, TIMELINE_PAGE, TIMELINE_TAIL, TIMELINE_TIMEOUT_MS } from "../../state/chat";

const user = (id: string, text = id): SessionMessageInfo => ({ id, type: "user", text, time: { created: 1 } }) as unknown as SessionMessageInfo;
const assistant = (id: string, text = `reply ${id}`): SessionMessageInfo =>
  ({ id, type: "assistant", agent: "build", model: { providerID: "p", id: "m" }, content: [{ type: "text", text }], time: { created: 2 } }) as unknown as SessionMessageInfo;
const pendingInbox = (id: string, text: string): InboxItem => ({ id, sessionID: "ses", time: { created: 3 }, type: "user", payload: { text }, delivery: "queue" });

/** The store projects REST messages; here the inputs are already projected. */
const ui = {
  user: (id: string, text = id, extra: Partial<Extract<UIMessage, { kind: "user" }>> = {}): UIMessage => ({ kind: "user", id, text, time: 1, ...extra }),
  assistant: (id: string, text = `reply ${id}`): UIMessage => ({ kind: "assistant", id, agent: "build", blocks: [{ kind: "text", key: "text:0", text, streaming: false }], time: 2 }),
};

function fakeSource(opts: { pages?: Record<number, SessionMessageInfo[]>; fail?: number[]; hang?: number[]; inbox?: InboxItem[] } = {}) {
  const calls: number[] = [];
  const source: TimelineSource = {
    messages(_id, query): Promise<SessionMessagesResponse> {
      const limit = query.limit ?? 0;
      calls.push(limit);
      if (opts.hang?.includes(limit)) {
        // A server that accepts the request and never answers: only the
        // deadline (or the caller) can end it.
        return new Promise((_resolve, reject) => {
          const abort = () => reject(query.signal?.reason ?? new Error("aborted"));
          if (query.signal?.aborted) abort();
          else query.signal?.addEventListener("abort", abort, { once: true });
        });
      }
      if (opts.fail?.includes(limit)) return Promise.reject(new Error(`network down at ${limit}`));
      return Promise.resolve({ data: opts.pages?.[limit] ?? [], cursor: { next: null } });
    },
    inbox() {
      return Promise.resolve(opts.inbox ?? []);
    },
  };
  return { source, calls };
}

describe("mergeTail", () => {
  test("replaces messages it already has by id", () => {
    const current = [ui.user("u1"), ui.assistant("a1", "streaming text"), ui.user("u2")];
    const merged = mergeTail(current, [ui.assistant("a1", "final text"), ui.assistant("a2")]);
    expect(merged.map((m) => m.id)).toEqual(["u1", "a1", "u2", "a2"]);
    expect((merged[1] as Extract<UIMessage, { kind: "assistant" }>).blocks[0]).toMatchObject({ text: "final text" });
  });

  test("keeps messages older than the tail", () => {
    const current = [ui.user("u0"), ui.assistant("a0"), ui.user("u1")];
    const merged = mergeTail(current, [ui.user("u1")]);
    expect(merged.map((m) => m.id)).toEqual(["u0", "a0", "u1"]);
  });

  test("keeps optimistic sends at the end", () => {
    const current = [ui.user("u1"), ui.assistant("a1"), ui.user("local_1", "not sent yet", { pending: true })];
    const merged = mergeTail(current, [ui.assistant("a1", "final"), ui.assistant("a2")]);
    expect(merged.map((m) => m.id)).toEqual(["u1", "a1", "a2", "local_1"]);
    expect(merged[merged.length - 1]).toMatchObject({ kind: "user", pending: true });
  });

  test("drops an optimistic send once the tail echoes its text", () => {
    const current = [ui.user("u1"), ui.user("local_1", "hello", { pending: true })];
    const merged = mergeTail(current, [ui.user("u1"), ui.user("u2", "hello")]);
    expect(merged.map((m) => m.id)).toEqual(["u1", "u2"]);
  });

  test("never duplicates an id, in the tail or across it", () => {
    const current = [ui.user("u1"), ui.assistant("a1")];
    const merged = mergeTail(current, [ui.user("u1"), ui.user("u1"), ui.assistant("a2"), ui.assistant("a2")]);
    expect(merged.map((m) => m.id)).toEqual(["u1", "a1", "a2"]);
  });

  test("an empty tail leaves the timeline untouched", () => {
    const current = [ui.user("u1")];
    expect(mergeTail(current, [])).toBe(current);
  });
});

describe("fetchTimelinePage", () => {
  test("retries once with a smaller page when the first request times out", async () => {
    const { source, calls } = fakeSource({ pages: { 4: [user("m4"), user("m3"), user("m2"), user("m1")] }, hang: [12] });
    const page = await fetchTimelinePage(source, "ses", { limit: 12, retryLimit: 4, timeoutMs: 20, order: "desc" });
    expect(calls).toEqual([12, 4]);
    expect(page.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  test("retries once on a network error, then reports the failure", async () => {
    const { source, calls } = fakeSource({ fail: [12, 4] });
    await expect(fetchTimelinePage(source, "ses", { limit: 12, retryLimit: 4, timeoutMs: 20 })).rejects.toThrow("network down at 4");
    expect(calls).toEqual([12, 4]);
  });

  test("does not retry when the caller aborted", async () => {
    const { source, calls } = fakeSource({ hang: [12] });
    const ctrl = new AbortController();
    const loading = fetchTimelinePage(source, "ses", { limit: 12, retryLimit: 4, timeoutMs: 5_000, signal: ctrl.signal });
    ctrl.abort();
    await expect(loading).rejects.toThrow();
    expect(calls).toEqual([12]);
  });

  test("includes pending inbox sends and the older cursor", async () => {
    const { source } = fakeSource({ pages: { 4: [user("m1")] }, inbox: [pendingInbox("in1", "waiting")] });
    const page = await fetchTimelinePage(source, "ses", { limit: 4, retryLimit: 4, timeoutMs: 20 });
    expect(page.messages.map((m) => m.id)).toEqual(["m1", "in1"]);
    expect(page.messages[1]).toMatchObject({ kind: "user", pending: true, delivery: "queue" });
  });
});

describe("timeline page sizes", () => {
  test("the store asks for small pages, not the whole history", () => {
    expect(TIMELINE_PAGE).toBe(12);
    expect(TIMELINE_OLDER).toBe(12);
    expect(TIMELINE_TAIL).toBe(4);
    expect(TIMELINE_TIMEOUT_MS).toBe(12_000);
  });
});
