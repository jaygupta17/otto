import { describe, expect, test } from "bun:test";
import type { UIMessage } from "../lib/opencode/projection";
import { siblingLabels, siblingsOf } from "./subagent";

const user = (id: string, pending = false): UIMessage => ({ kind: "user", id, text: id, time: 0, pending }) as UIMessage;
const task = (child: string, agent = "scout", description?: string) => ({
  kind: "tool",
  key: `tool:${child}`,
  id: child,
  name: "task",
  status: "completed",
  input: { subagent_type: agent, description },
  metadata: { sessionID: child },
  started: 0,
});
const turn = (id: string, ...blocks: unknown[]): UIMessage => ({ kind: "assistant", id, agent: "juno", blocks, time: 0 }) as UIMessage;

describe("siblingsOf", () => {
  const msgs = [
    user("u1"),
    turn("a1", task("k0")),
    user("u2"),
    turn("a2", task("k1", "scout", "Read the docs"), { kind: "text", key: "t", text: "hi" }, task("k2", "patch")),
    turn("a3", task("k3", "scout", "Check tests")),
    user("u3", true),
    turn("a4", task("k4")),
    user("u4"),
    turn("a5", task("k5")),
  ];

  test("everyone handed a part in the same turn, in order", () => {
    expect(siblingsOf(msgs, "k2").map((s) => s.sessionID)).toEqual(["k1", "k2", "k3", "k4"]);
    expect(siblingsOf(msgs, "k1")[0]).toEqual({ sessionID: "k1", agent: "scout", title: "Read the docs" });
  });

  test("a turn of one is just itself; an unknown child has none", () => {
    expect(siblingsOf(msgs, "k0").map((s) => s.sessionID)).toEqual(["k0"]);
    expect(siblingsOf(msgs, "nope")).toEqual([]);
    expect(siblingsOf(undefined, "k0")).toEqual([]);
  });
});

describe("siblingLabels", () => {
  const name = (a?: string) => (a ? a[0].toUpperCase() + a.slice(1) : "Subagent");
  test("the task when there is one", () => {
    expect(siblingLabels([{ sessionID: "1", agent: "scout", title: " Read the docs " }, { sessionID: "2", agent: "scout", title: "Check tests" }], name)).toEqual(["Read the docs", "Check tests"]);
  });
  test("letters only for the same agent twice without a task", () => {
    expect(
      siblingLabels(
        [
          { sessionID: "1", agent: "scout" },
          { sessionID: "2", agent: "patch" },
          { sessionID: "3", agent: "scout" },
          { sessionID: "4", agent: "scout", title: "Named" },
        ],
        name,
      ),
    ).toEqual(["Scout A", "Patch", "Scout B", "Named"]);
  });
});
