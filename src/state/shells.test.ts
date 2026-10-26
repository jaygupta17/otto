import { describe, expect, test } from "bun:test";
import type { UIMessage } from "../lib/opencode/projection";
import type { Timeline } from "./chat";
import { waitedOn, type ShellLite } from "./shells";

const sh: ShellLite = { id: "sh_1", command: "sleep 60", status: "running", sessionID: "kid", started: 0 };
const call = (over: Record<string, unknown> = {}) => ({ kind: "tool", key: "tool:c", id: "c", name: "shell", status: "running", input: { command: "sleep 60" }, metadata: {}, started: 0, ...over });
const timeline = (...blocks: unknown[]): Timeline => ({ messages: [{ kind: "user", id: "u" }, { kind: "assistant", id: "a", blocks }] as unknown as UIMessage[], loaded: true, loading: false });
const chat = (t: Timeline | undefined, busy = true) => ({ busy: { kid: busy }, timelines: { kid: t } });

describe("waitedOn", () => {
  test("a running call read back from history matches its command by text (only live events name the shell)", () => {
    expect(waitedOn(chat(timeline(call())), sh)).toBe(true);
    expect(waitedOn(chat(timeline(call({ input: { command: "bun dev" } }))), sh)).toBe(false);
  });

  test("a live call matches by the shell it names, not by text", () => {
    expect(waitedOn(chat(timeline(call({ metadata: { shellID: "sh_1" } }))), sh)).toBe(true);
    expect(waitedOn(chat(timeline(call({ metadata: { shellID: "sh_2" } }))), sh)).toBe(false);
  });

  test("a command left running in the background is nobody's call", () => {
    expect(waitedOn(chat(timeline(call({ status: "completed", metadata: { status: "running", shellID: "sh_1" } }))), sh)).toBe(false);
  });

  test("a session that's done waits on nothing", () => {
    expect(waitedOn(chat(timeline(call()), false), sh)).toBe(false);
  });

  test("a busy session not read yet counts as waiting, until a failed read says it can't tell", () => {
    expect(waitedOn(chat(undefined), sh)).toBe(true);
    expect(waitedOn(chat({ messages: [], loaded: false, loading: true }), sh)).toBe(true);
    expect(waitedOn(chat({ messages: [], loaded: false, loading: false, error: "x" }), sh)).toBe(false);
  });
});
