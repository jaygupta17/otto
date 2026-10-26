import { describe, expect, test } from "bun:test";
import type { ToolBlock } from "./projection";
import { subagentOf, summarizeTools, toolDoing, toolKind, toolLabel } from "./tools";

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

describe("present", () => {
  test("is its own kind, not a plugin tool we don't know", () => {
    expect(toolKind("present")).toBe("present");
    expect(toolKind("otto.present")).toBe("present");
    expect(toolKind("present_file")).toBe("other");
  });

  test("the step says what was shown", () => {
    expect(toolDoing(call("present", { source: "out/cover.png" }))).toBe("Showing cover.png");
    const done = { ...call("present", { source: "out/cover.png" }), status: "completed" } as ToolBlock;
    expect(toolLabel(done)).toMatchObject({ verb: "Presented", target: "cover.png", path: "out/cover.png" });
  });

  test("a title wins, and markup has no path", () => {
    const done = { ...call("present", { source: "<h1>hi</h1>", title: "Cover" }), status: "completed" } as ToolBlock;
    expect(toolLabel(done)).toMatchObject({ verb: "Presented", target: "Cover", path: undefined });
  });
});

describe("what a run says it did", () => {
  test("a presentation counts as an artifact, not an unknown tool", () => {
    const done = { ...call("present", { source: "out/cover.png" }), status: "completed" } as ToolBlock;
    expect(summarizeTools([done])).toBe("Showed 1 artifact");
  });
});
