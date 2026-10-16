/**
 * Projects OpenCode v2 messages (REST) and live events (SSE) into one
 * render-friendly timeline. Pure functions; the store owns state.
 *
 * Block keys:
 *   text:<ordinal>, reasoning:<ordinal>  (ordinal is per kind, per message)
 *   tool:<callID>
 */
import type { SessionMessageInfo, V2Event } from "@opencode/client";
import { stopNoteChild } from "./tools";

export type ToolStatus = "streaming" | "running" | "completed" | "error";

export type Block =
  | { kind: "text"; key: string; text: string; streaming: boolean }
  | { kind: "reasoning"; key: string; text: string; streaming: boolean; started: number; ended?: number }
  | {
      kind: "tool";
      key: string;
      id: string;
      name: string;
      status: ToolStatus;
      inputText?: string;
      input?: Record<string, unknown>;
      output?: string;
      files?: { uri: string; mime: string; name?: string | null }[];
      error?: string;
      metadata?: Record<string, unknown>;
      started: number;
      ended?: number;
    };

export interface ModelRefLite {
  providerID: string;
  id: string;
  variant?: string;
}

export interface Tokens {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export type Delivery = "steer" | "queue";

export type UIMessage =
  | {
      kind: "user";
      id: string;
      text: string;
      files?: { uri: string; name?: string }[];
      time: number;
      pending?: boolean;
      /** Set while the message waits in the session inbox (sent during a run). */
      delivery?: Delivery;
    }
  | {
      kind: "assistant";
      id: string;
      agent: string;
      model?: ModelRefLite;
      blocks: Block[];
      time: number;
      completed?: number;
      finish?: string;
      error?: string;
      retry?: { attempt: number; at: number; message: string };
      /** Usage for this step; drives tokens/second and the context meter. */
      tokens?: Tokens;
      /** First streamed token and end of streaming, for tokens/second. */
      firstToken?: number;
      streamed?: number;
    }
  | { kind: "notice"; id: string; tone: "info" | "error" | "ok"; text: string; time: number }
  | { kind: "shell"; id: string; command: string; status: string; output?: string; exit?: number | string; time: number }
  | { kind: "compaction"; id: string; status: string; summary?: string; time: number }
  /** A subagent's report, delivered back into the parent session. */
  | { kind: "subagent"; id: string; childID?: string; agent?: string; state?: string; description?: string; text: string; time: number }
  /** The user stopped this subagent (a note to the model; never rendered). */
  | { kind: "stopped"; id: string; childID: string; time: number };

const SUBAGENT_ENVELOPE = /^\s*<subagent\b[^>]*>\n?([\s\S]*?)\n?<\/subagent>\s*$/;

/** Synthetic messages from a finished subagent become report cards; any other synthetic stays hidden (it's for the model). */
function fromSynthetic(id: string, text: string, metadata: Json | undefined, description: string | undefined, time: number): UIMessage | null {
  const stopped = stopNoteChild(metadata);
  if (stopped) return { kind: "stopped", id, childID: stopped, time };
  if (metadata?.source !== "subagent") return null;
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  return {
    kind: "subagent",
    id,
    childID: str(metadata.childID) ?? str(metadata.sessionID),
    agent: str(metadata.agent),
    state: str(metadata.state) ?? str(metadata.status),
    description: description ?? str(metadata.description),
    text: (SUBAGENT_ENVELOPE.exec(text)?.[1] ?? text).trim(),
    time,
  };
}

type Json = Record<string, unknown>;

function toolText(content: unknown): { output?: string; files?: { uri: string; mime: string; name?: string | null }[] } {
  if (!Array.isArray(content)) return {};
  const texts: string[] = [];
  const files: { uri: string; mime: string; name?: string | null }[] = [];
  for (const c of content as Json[]) {
    if (c?.type === "text" && typeof c.text === "string") texts.push(c.text);
    else if (c?.type === "file") files.push({ uri: String(c.uri), mime: String(c.mime ?? ""), name: (c.name as string) ?? null });
  }
  return { output: texts.length ? texts.join("\n") : undefined, files: files.length ? files : undefined };
}

function firstContentTime(content: readonly unknown[]): number | undefined {
  let t: number | undefined;
  for (const c of content as { time?: { created?: number } }[]) {
    const v = c?.time?.created;
    if (typeof v === "number" && (t === undefined || v < t)) t = v;
  }
  return t;
}

/** Output tokens per second for one step, when it's measurable. */
export function tokensPerSecond(m: { tokens?: Tokens; firstToken?: number; streamed?: number; completed?: number }): number | null {
  const out = (m.tokens?.output ?? 0) + (m.tokens?.reasoning ?? 0);
  const end = m.streamed ?? m.completed;
  if (!out || !m.firstToken || !end) return null;
  const secs = (end - m.firstToken) / 1000;
  return secs >= 0.25 ? out / secs : null;
}

/** Tokens the model saw in a step: its whole context window usage. */
export function contextTokens(t?: Tokens): number {
  return t ? t.input + t.output + t.cache.read + t.cache.write : 0;
}

function fromRest(m: SessionMessageInfo): UIMessage | null {
  switch (m.type) {
    case "user":
      return { kind: "user", id: m.id, text: m.text, files: m.files?.map((f, i) => ({ uri: `file-${i}`, name: f.name ?? f.mime })), time: m.time.created };
    case "assistant": {
      const blocks: Block[] = [];
      let ti = 0;
      let ri = 0;
      for (const c of m.content) {
        if (c.type === "text") blocks.push({ kind: "text", key: `text:${ti++}`, text: c.text, streaming: false });
        else if (c.type === "reasoning")
          blocks.push({ kind: "reasoning", key: `reasoning:${ri++}`, text: c.text, streaming: false, started: c.time?.created ?? m.time.created, ended: c.time?.completed ?? c.time?.created });
        else if (c.type === "tool") {
          const st = c.state as Json & { status: ToolStatus };
          const { output, files } = toolText(st.content);
          blocks.push({
            kind: "tool",
            key: `tool:${c.id}`,
            id: c.id,
            name: c.name,
            status: st.status === "streaming" || st.status === "running" ? (m.time.completed ? "error" : st.status) : st.status,
            inputText: st.status === "streaming" ? String(st.input ?? "") : undefined,
            input: st.status !== "streaming" ? (st.input as Json) : undefined,
            output,
            files,
            error: st.status === "error" ? ((st.error as Json)?.message as string) : st.status !== "completed" && m.time.completed ? "Interrupted" : undefined,
            metadata: st.metadata as Json | undefined,
            started: c.time.created,
            ended: c.time.completed,
          });
        }
      }
      return {
        kind: "assistant",
        id: m.id,
        agent: m.agent,
        model: m.model,
        blocks,
        time: m.time.created,
        completed: m.time.completed,
        finish: m.finish,
        error: m.error?.message,
        tokens: m.tokens,
        firstToken: firstContentTime(m.content) ?? m.time.created,
        streamed: (m.time as { streamed?: number }).streamed,
      };
    }
    case "shell":
      return { kind: "shell", id: m.id, command: m.command, status: m.status, output: m.output?.output, exit: m.exit, time: m.time.created };
    case "compaction":
      return { kind: "compaction", id: m.id, status: m.status, summary: "summary" in m ? (m as { summary?: string }).summary : undefined, time: m.time.created };
    // Agent/model switches aren't shown: each reply's footer names the agent
    // and model that wrote it, and the composer shows the current ones.
    case "model-switched":
    case "agent-switched":
      return null;
    case "synthetic":
      return fromSynthetic(m.id, m.text, m.metadata as Json | undefined, m.description, m.time.created);
    case "idle":
      if (m.outcome === "interrupted") return { kind: "notice", id: m.id, tone: "info", text: "Stopped", time: m.time.created };
      return null;
    default:
      return null;
  }
}

/** Collapse REST history into UI messages (oldest first). */
export function projectHistory(list: SessionMessageInfo[]): UIMessage[] {
  const out: UIMessage[] = [];
  for (const m of list) {
    const u = fromRest(m);
    if (u) out.push(u);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Live events
// ---------------------------------------------------------------------------

function findAssistant(msgs: UIMessage[], id: string): number {
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].id === id) return i;
  return -1;
}

function updateAssistant(msgs: UIMessage[], id: string, fn: (m: Extract<UIMessage, { kind: "assistant" }>) => Extract<UIMessage, { kind: "assistant" }>, create?: () => Extract<UIMessage, { kind: "assistant" }>): UIMessage[] {
  const i = findAssistant(msgs, id);
  if (i < 0) {
    if (!create) return msgs;
    return [...msgs, fn(create())];
  }
  const m = msgs[i];
  if (m.kind !== "assistant") return msgs;
  const next = msgs.slice();
  next[i] = fn(m);
  return next;
}

function upsertBlock(blocks: Block[], key: string, fn: (b: Block | undefined) => Block): Block[] {
  const i = blocks.findIndex((b) => b.key === key);
  if (i < 0) return [...blocks, fn(undefined)];
  const next = blocks.slice();
  next[i] = fn(blocks[i]);
  return next;
}

/**
 * Apply one live event to a session's timeline. Returns the same array
 * reference when nothing changed so React can skip work.
 */
export function applyEvent(msgs: UIMessage[], e: V2Event): UIMessage[] {
  const d = (e as { data: Json }).data;
  const created = (e as { created?: number }).created ?? Date.now();
  const mid = d?.assistantMessageID as string | undefined;
  const blankAssistant = () => ({ kind: "assistant" as const, id: mid!, agent: "", blocks: [] as Block[], time: created });

  switch (e.type) {
    case "session.inbox.enqueued": {
      const item = d.item as { type: string; payload?: { text?: string; files?: { uri: string; name?: string }[] } };
      if (item?.type !== "user") return msgs;
      const id = d.inboxID as string;
      const existing = msgs.findIndex((m) => m.id === id || (m.kind === "user" && m.pending && m.text === item.payload?.text));
      const delivery = (item as { delivery?: Delivery }).delivery;
      const msg: UIMessage = { kind: "user", id, text: item.payload?.text ?? "", files: item.payload?.files, time: created, pending: true, delivery };
      if (existing >= 0) {
        const next = msgs.slice();
        next[existing] = msg;
        return next;
      }
      return [...msgs, msg];
    }
    case "session.inbox.delivered": {
      const id = d.inboxID as string;
      const i = msgs.findIndex((m) => m.id === id);
      if (i < 0) return msgs;
      const m = msgs[i];
      if (m.kind !== "user" || !m.pending) return msgs;
      const next = msgs.slice();
      // Delivered: it joins the conversation where the agent actually read it.
      next.splice(i, 1);
      next.push({ ...m, pending: false, delivery: undefined, time: created });
      return next;
    }
    case "session.inbox.delivery.changed": {
      const id = d.inboxID as string;
      const i = msgs.findIndex((m) => m.id === id);
      if (i < 0) return msgs;
      const m = msgs[i];
      if (m.kind !== "user") return msgs;
      const next = msgs.slice();
      next[i] = { ...m, delivery: d.delivery as Delivery };
      return next;
    }
    case "session.inbox.cancelled": {
      const id = d.inboxID as string;
      return msgs.filter((m) => m.id !== id);
    }
    case "session.step.started":
      return updateAssistant(
        msgs,
        mid!,
        (m) => ({ ...m, agent: (d.agent as string) ?? m.agent, model: (d.model as ModelRefLite) ?? m.model, retry: undefined, firstToken: undefined, streamed: undefined }),
        blankAssistant,
      );
    case "session.text.started":
      return updateAssistant(msgs, mid!, (m) => ({ ...m, firstToken: m.firstToken ?? created, blocks: upsertBlock(m.blocks, `text:${d.ordinal}`, (b) => (b as Block) ?? { kind: "text", key: `text:${d.ordinal}`, text: "", streaming: true }) }), blankAssistant);
    case "session.text.delta":
      return updateAssistant(
        msgs,
        mid!,
        (m) => ({
          ...m,
          blocks: upsertBlock(m.blocks, `text:${d.ordinal}`, (b) => {
            const prev = b && b.kind === "text" ? b : { kind: "text" as const, key: `text:${d.ordinal}`, text: "", streaming: true };
            return { ...prev, text: prev.text + (d.delta as string), streaming: true };
          }),
        }),
        blankAssistant,
      );
    case "session.text.ended":
      return updateAssistant(msgs, mid!, (m) => ({
        ...m,
        blocks: upsertBlock(m.blocks, `text:${d.ordinal}`, () => ({ kind: "text", key: `text:${d.ordinal}`, text: d.text as string, streaming: false })),
      }));
    case "session.reasoning.started":
      return updateAssistant(
        msgs,
        mid!,
        (m) => ({ ...m, firstToken: m.firstToken ?? created, blocks: upsertBlock(m.blocks, `reasoning:${d.ordinal}`, (b) => (b as Block) ?? { kind: "reasoning", key: `reasoning:${d.ordinal}`, text: "", streaming: true, started: created }) }),
        blankAssistant,
      );
    case "session.reasoning.delta":
      return updateAssistant(
        msgs,
        mid!,
        (m) => ({
          ...m,
          blocks: upsertBlock(m.blocks, `reasoning:${d.ordinal}`, (b) => {
            const prev = b && b.kind === "reasoning" ? b : { kind: "reasoning" as const, key: `reasoning:${d.ordinal}`, text: "", streaming: true, started: created };
            return { ...prev, text: prev.text + (d.delta as string) };
          }),
        }),
        blankAssistant,
      );
    case "session.reasoning.ended":
      return updateAssistant(msgs, mid!, (m) => ({
        ...m,
        blocks: upsertBlock(m.blocks, `reasoning:${d.ordinal}`, (b) => ({
          kind: "reasoning",
          key: `reasoning:${d.ordinal}`,
          text: d.text as string,
          streaming: false,
          started: b && b.kind === "reasoning" ? b.started : created,
          ended: created,
        })),
      }));
    case "session.tool.input.started":
      return updateAssistant(
        msgs,
        mid!,
        (m) => ({
          ...m,
          blocks: upsertBlock(m.blocks, `tool:${d.id}`, (b) => (b as Block) ?? { kind: "tool", key: `tool:${d.id}`, id: d.id as string, name: d.name as string, status: "streaming", inputText: "", started: created }),
        }),
        blankAssistant,
      );
    case "session.tool.input.delta":
      return updateAssistant(msgs, mid!, (m) => ({
        ...m,
        blocks: upsertBlock(m.blocks, `tool:${d.id}`, (b) => {
          const prev = b && b.kind === "tool" ? b : { kind: "tool" as const, key: `tool:${d.id}`, id: d.id as string, name: "tool", status: "streaming" as ToolStatus, started: created };
          return { ...prev, inputText: (prev.inputText ?? "") + (d.delta as string) };
        }),
      }));
    case "session.tool.input.ended":
      return updateAssistant(msgs, mid!, (m) => ({
        ...m,
        blocks: upsertBlock(m.blocks, `tool:${d.id}`, (b) => {
          const prev = b && b.kind === "tool" ? b : { kind: "tool" as const, key: `tool:${d.id}`, id: d.id as string, name: "tool", status: "streaming" as ToolStatus, started: created };
          return { ...prev, inputText: d.text as string };
        }),
      }));
    case "session.tool.called":
      return updateAssistant(msgs, mid!, (m) => ({
        ...m,
        blocks: upsertBlock(m.blocks, `tool:${d.id}`, (b) => {
          const prev = b && b.kind === "tool" ? b : { kind: "tool" as const, key: `tool:${d.id}`, id: d.id as string, name: (d.name as string) ?? "tool", started: created, status: "running" as ToolStatus };
          return { ...prev, status: "running", input: d.input as Json, inputText: undefined };
        }),
      }));
    case "session.tool.progress":
      return updateAssistant(msgs, mid!, (m) => ({
        ...m,
        blocks: upsertBlock(m.blocks, `tool:${d.id}`, (b) => {
          const prev = b && b.kind === "tool" ? b : { kind: "tool" as const, key: `tool:${d.id}`, id: d.id as string, name: "tool", started: created, status: "running" as ToolStatus };
          return { ...prev, metadata: { ...(prev.metadata ?? {}), ...(d.metadata as Json) } };
        }),
      }));
    case "session.tool.success":
      return updateAssistant(msgs, mid!, (m) => ({
        ...m,
        blocks: upsertBlock(m.blocks, `tool:${d.id}`, (b) => {
          const prev = b && b.kind === "tool" ? b : { kind: "tool" as const, key: `tool:${d.id}`, id: d.id as string, name: "tool", started: created, status: "running" as ToolStatus };
          return { ...prev, status: "completed", ...toolText(d.content), metadata: { ...(prev.metadata ?? {}), ...((d.metadata as Json) ?? {}) }, ended: created };
        }),
      }));
    case "session.tool.failed":
      return updateAssistant(msgs, mid!, (m) => ({
        ...m,
        blocks: upsertBlock(m.blocks, `tool:${d.id}`, (b) => {
          const prev = b && b.kind === "tool" ? b : { kind: "tool" as const, key: `tool:${d.id}`, id: d.id as string, name: "tool", started: created, status: "running" as ToolStatus };
          return { ...prev, status: "error", error: ((d.error as Json)?.message as string) ?? "Failed", ...toolText(d.content), ended: created };
        }),
      }));
    case "session.step.streamed":
      return updateAssistant(msgs, mid!, (m) => ({ ...m, streamed: created }));
    case "session.step.ended":
      return updateAssistant(msgs, mid!, (m) => ({ ...m, completed: created, finish: d.finish as string, tokens: (d.tokens as Tokens) ?? m.tokens, blocks: m.blocks.map(settle) }));
    case "session.step.failed":
      return updateAssistant(msgs, mid!, (m) => ({ ...m, completed: created, finish: "error", error: ((d.error as Json)?.message as string) ?? "Something went wrong", blocks: m.blocks.map(settle) }), blankAssistant);
    case "session.retry.scheduled":
      return updateAssistant(msgs, mid!, (m) => ({ ...m, retry: { attempt: d.attempt as number, at: d.at as number, message: ((d.error as Json)?.message as string) ?? "" } }));
    case "session.shell.started": {
      const sh = (d.shell ?? {}) as { id?: string; command?: string };
      const id = sh.id ?? (e as { id: string }).id;
      if (msgs.some((m) => m.id === id)) return msgs;
      return [...msgs, { kind: "shell", id, command: sh.command ?? "", status: "running", time: created }];
    }
    case "session.shell.ended": {
      const sh = (d.shell ?? {}) as { id?: string; exit?: number; status?: string };
      const id = sh.id;
      const output = ((d.output as Json)?.output as string) ?? undefined;
      const i = msgs.findIndex((m) => m.id === id);
      if (i < 0) return msgs;
      const next = msgs.slice();
      next[i] = { ...(msgs[i] as Extract<UIMessage, { kind: "shell" }>), status: sh.status ?? "exited", exit: sh.exit, output };
      return next;
    }
    case "session.synthetic": {
      const id = (e as { id?: string }).id ?? `synthetic:${created}`;
      if (msgs.some((m) => m.id === id)) return msgs;
      const u = fromSynthetic(id, (d.text as string) ?? "", d.metadata as Json | undefined, d.description as string | undefined, created);
      return u ? [...msgs, u] : msgs;
    }
    case "session.compaction.started": {
      const id = (d.inputID as string) ?? (e as { id: string }).id;
      if (msgs.some((m) => m.id === id)) return msgs;
      return [...msgs, { kind: "compaction", id, status: "running", time: created }];
    }
    case "session.compaction.ended":
    case "session.compaction.failed": {
      let i = -1;
      for (let j = msgs.length - 1; j >= 0; j--) if (msgs[j].kind === "compaction" && (msgs[j] as { status: string }).status === "running") (i = j), (j = -1);
      if (i < 0) return msgs;
      const next = msgs.slice();
      const m = msgs[i] as Extract<UIMessage, { kind: "compaction" }>;
      next[i] = e.type === "session.compaction.ended" ? { ...m, status: "completed", summary: d.text as string } : { ...m, status: "failed" };
      return next;
    }
    default:
      return msgs;
  }
}

function settle(b: Block): Block {
  if (b.kind === "text" && b.streaming) return { ...b, streaming: false };
  if (b.kind === "reasoning" && b.streaming) return { ...b, streaming: false, ended: b.ended ?? Date.now() };
  return b;
}

/** Session id an event belongs to, if any. */
export function eventSessionID(e: V2Event): string | undefined {
  const d = (e as { data?: Json }).data;
  return (d?.sessionID as string | undefined) ?? undefined;
}

export { summarizeTools, toolCategory, toolLabel, type ToolCategory } from "./tools";
