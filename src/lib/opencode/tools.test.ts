import { describe, expect, test } from "bun:test";
import type { ToolBlock } from "./projection";
import { subagentOf, toolDoing } from "./tools";

const call = (name: string, input: Record<string, unknown>) => ({ kind: "tool", key: `tool:${name}`, id: name, name, status: "running", input, started: 0 }) as unknown as ToolBlock;

describe("toolDoing", () => {
  test("says a step as it happens, by file where it has one", () => {
    expect(toolDoing(call("read", { filePath: "/w/src/Thread.tsx" }))).toBe("Reading Thread.tsx");
    expect(toolDoing(call("edit", { filePath: "/w/src/Thread.tsx" }))).toBe("Editing Thread.tsx");
    expect(toolDoing(call("bash", { command: "bun test\nmore" }))).toBe("Running bun test");
  });

  test("waits on whoever has it", () => {
    expect(toolDoing(call("task", { subagent_type: "explore", description: "Find it" }))).toBe("Waiting on Explore");
    expect(toolDoing(call("question", { questions: [] }))).toBe("Waiting for you");
  });

  test("falls back to the tool's own name", () => {
    expect(toolDoing(call("linear.create_issue", {}))).toBe("Using Create Issue");
  });
});

describe("subagentOf", () => {
  test("a handoff that's going is in the foreground until it settles in the background", () => {
    const started = { ...call("subagent", { agent: "scout" }), metadata: { sessionID: "ses_kid", status: "running" } } as ToolBlock;
    expect(subagentOf(started)).toMatchObject({ childID: "ses_kid", background: false });
    expect(subagentOf({ ...started, status: "completed" }).background).toBe(true);
    expect(subagentOf({ ...started, status: "completed", metadata: { sessionID: "ses_kid", status: "completed" } }).background).toBe(false);
    expect(subagentOf(call("subagent", { agent: "scout", background: true })).background).toBe(true);
  });
});
