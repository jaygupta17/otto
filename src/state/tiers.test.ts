import { describe, expect, test } from "bun:test";
import type { UIMessage } from "../lib/opencode/projection";
import { doingOf } from "./tiers";

const tool = (name: string, input: Record<string, unknown>) => ({ kind: "tool", key: `tool:${name}`, id: name, name, status: "running", input, started: 0 });
const turn = (...blocks: unknown[]) => [{ kind: "user", id: "u" }, { kind: "assistant", id: "a", blocks }] as unknown as UIMessage[];

describe("doingOf", () => {
  test("names the step a turn is on, by file where it has one", () => {
    expect(doingOf(turn(tool("edit", { filePath: "/w/src/Thread.tsx" })))).toBe("Editing Thread.tsx");
    expect(doingOf(turn({ ...tool("edit", { filePath: "/w/src/Thread.tsx" }), status: "completed" }))).toBe("Edited Thread.tsx");
  });

  test("says when it's thinking or writing, and nothing once that's done", () => {
    expect(doingOf(turn({ kind: "reasoning", key: "r", text: "…", streaming: true, started: 0 }))).toBe("Thinking");
    expect(doingOf(turn({ kind: "text", key: "t", text: "Hi", streaming: true }))).toBe("Writing");
    expect(doingOf(turn({ kind: "text", key: "t", text: "Hi", streaming: false }))).toBe("");
  });

  test("is empty before the reply starts", () => {
    expect(doingOf(turn())).toBe("");
    expect(doingOf(undefined)).toBe("");
  });
});
