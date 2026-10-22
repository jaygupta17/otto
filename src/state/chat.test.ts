import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { SessionMessageInfo, SessionMessagesResponse } from "@opencode/client";
import type { OpenCode } from "../lib/opencode/client";
import { TIMELINE_PAGE, TIMELINE_TAIL, useChat } from "./chat";

const user = (id: string, text = id, created = 1): SessionMessageInfo => ({ id, type: "user", text, time: { created } }) as unknown as SessionMessageInfo;
const assistant = (id: string, created = 2): SessionMessageInfo =>
  ({ id, type: "assistant", agent: "build", model: { providerID: "p", id: "m" }, content: [{ type: "text", text: id }], time: { created } }) as unknown as SessionMessageInfo;

function page(data: SessionMessageInfo[], next: string | null = null): SessionMessagesResponse {
  return { data, cursor: { next } };
}

/**
 * A client that answers each limit from a table, records what the store asked
 * for, and can be made to fail one of them (a network error or a timeout).
 */
function fakeClient(reply: (limit: number) => Promise<SessionMessagesResponse>, inbox: () => Promise<never[]> = async () => []) {
  const limits: number[] = [];
  const client = {
    messages(_id: string, q: { limit?: number }) {
      const limit = q.limit ?? 0;
      limits.push(limit);
      return reply(limit);
    },
    inbox,
    sessions: async () => ({ data: [], cursor: {} }),
  };
  return { client: client as unknown as OpenCode, limits };
}

const attach = (client: OpenCode) => useChat.setState({ client, timelines: {}, activeId: "ses" });
const timeline = (id = "ses") => useChat.getState().timelines[id];

afterEach(() => {
  useChat.getState().reset();
});

describe("loadTimeline", () => {
  test("asks for one small page, not the whole history", async () => {
    const { client, limits } = fakeClient(async () => page([assistant("a3"), user("u2"), assistant("a2"), user("u1")], "older-cursor"));
    attach(client);
    await useChat.getState().loadTimeline("ses");
    expect(limits).toEqual([TIMELINE_PAGE]);
    expect(timeline().messages.map((m) => m.id)).toEqual(["u1", "a2", "u2", "a3"]);
    expect(timeline()).toMatchObject({ loaded: true, loading: false, older: "older-cursor" });
    expect(timeline().error).toBeUndefined();
  });

  test("retries with the tail page when the small page fails", async () => {
    const { client, limits } = fakeClient((limit) => (limit === TIMELINE_PAGE ? Promise.reject(new Error("Failed to fetch")) : Promise.resolve(page([assistant("a4"), user("u3")]))));
    attach(client);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await useChat.getState().loadTimeline("ses");
    warn.mockRestore();
    expect(limits).toEqual([TIMELINE_PAGE, TIMELINE_TAIL]);
    expect(timeline().messages.map((m) => m.id)).toEqual(["u3", "a4"]);
    expect(timeline()).toMatchObject({ loaded: true, loading: false });
  });

  test("shows a friendly error, not the fetch failure, when both pages fail", async () => {
    const { client, limits } = fakeClient(() => Promise.reject(new Error("Failed to fetch")));
    attach(client);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await useChat.getState().loadTimeline("ses");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(limits).toEqual([TIMELINE_PAGE, TIMELINE_TAIL]);
    expect(timeline()).toMatchObject({ loaded: false, loading: false });
    expect(timeline().error).toBe("Couldn't load this conversation. It may be too large for this connection — try again.");
    expect(timeline().error).not.toContain("Failed to fetch");
  });
});

describe("loadTail", () => {
  const loaded = (messages: ReturnType<typeof timeline>["messages"], older = "old") =>
    useChat.setState({ timelines: { ses: { messages, loaded: true, loading: false, older } } });

  test("refreshes only the last few messages and never shows a skeleton", async () => {
    const { client, limits } = fakeClient(async () => page([assistant("a2"), user("u1")]));
    attach(client);
    loaded([
      { kind: "user", id: "u1", text: "u1", time: 1 },
      { kind: "assistant", id: "a1", agent: "build", blocks: [{ kind: "text", key: "text:0", text: "old", streaming: false }], time: 2 },
    ]);
    await useChat.getState().loadTail("ses");
    expect(limits).toEqual([TIMELINE_TAIL]);
    expect(timeline()).toMatchObject({ loaded: true, loading: false, older: "old" });
    // a1 is older than the tail, so it stays; a2 is new.
    expect(timeline().messages.map((m) => m.id)).toEqual(["u1", "a1", "a2"]);
  });

  test("keeps an optimistic send at the end", async () => {
    const { client } = fakeClient(async () => page([assistant("a2"), user("u1")]));
    attach(client);
    loaded([
      { kind: "user", id: "u1", text: "u1", time: 1 },
      { kind: "user", id: "local_9", text: "typing", time: 3, pending: true },
    ]);
    await useChat.getState().loadTail("ses");
    expect(timeline().messages.map((m) => m.id)).toEqual(["u1", "a2", "local_9"]);
  });

  test("loads a full page when the timeline was never opened", async () => {
    const { client, limits } = fakeClient(async () => page([user("u1")]));
    attach(client);
    await useChat.getState().loadTail("ses");
    expect(limits).toEqual([TIMELINE_PAGE]);
    expect(timeline()).toMatchObject({ loaded: true });
  });

  test("silently ignores a failed tail refresh", async () => {
    const { client } = fakeClient(() => Promise.reject(new Error("Failed to fetch")));
    attach(client);
    loaded([{ kind: "user", id: "u1", text: "u1", time: 1 }]);
    await useChat.getState().loadTail("ses");
    expect(timeline()).toMatchObject({ loaded: true, loading: false });
    expect(timeline().error).toBeUndefined();
    expect(timeline().messages.map((m) => m.id)).toEqual(["u1"]);
  });

  test("does not replace streaming text when a new turn started meanwhile", async () => {
    let answer!: (r: SessionMessagesResponse) => void;
    const slow = fakeClient(() => new Promise((resolve) => (answer = resolve)));
    attach(slow.client);
    loaded([{ kind: "user", id: "u1", text: "u1", time: 1 }]);
    const pending = useChat.getState().loadTail("ses");
    useChat.setState({ busy: { ses: true } });
    answer(page([assistant("a2")]));
    await pending;
    expect(timeline().messages.map((m) => m.id)).toEqual(["u1"]);
  });

  test("does not merge a tail from a connection that was replaced", async () => {
    let answer!: (r: SessionMessagesResponse) => void;
    const slow = fakeClient(() => new Promise((resolve) => (answer = resolve)));
    attach(slow.client);
    loaded([{ kind: "user", id: "u1", text: "u1", time: 1 }]);
    const pending = useChat.getState().loadTail("ses");
    // The workspace changed while the read was in flight.
    const next = fakeClient(async () => page([]));
    attach(next.client);
    answer(page([assistant("a2")]));
    await pending;
    expect(timeline()).toBeUndefined();
  });
});
