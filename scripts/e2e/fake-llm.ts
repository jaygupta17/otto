/**
 * A scripted OpenAI-compatible model for driving a real OpenCode server in
 * tests. It never thinks: the last user message says what to do.
 *
 *   bg-agent <label> <seconds>   start a background subagent that works for <seconds>
 *   fg-agent <label> <seconds>   the same, in the foreground (the turn waits for it)
 *   bg-shell <seconds>           start a background `sleep <seconds>`
 *   nest-agent <label> <seconds> a foreground subagent that itself starts `bg-agent <label> <seconds>`
 *   essay <lines>                reply with <lines> lines of filler (a long turn, for lazy loading)
 *   present <source> [title…]    show the user <source> with the `present` tool
 *   anything else                reply "ok: <text>"
 *
 * A subagent's prompt is `work <seconds>`: it runs `sleep <seconds>` and reports.
 * After any tool result the model just says "done", which ends the turn.
 *
 * Run: bun scripts/e2e/fake-llm.ts   (FAKE_LLM_PORT, default 4918)
 */

type Msg = { role: string; content?: unknown; tool_calls?: unknown[] };

const text = (m: Msg | undefined): string => {
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => (typeof p === "string" ? p : ((p as { text?: string }).text ?? ""))).join("\n");
  return "";
};

let n = 0;
const enc = new TextEncoder();
const sse = (o: unknown) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
  id: "fake",
  object: "chat.completion.chunk",
  created: Math.floor(Date.now() / 1000),
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
  ...(finish ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } : {}),
});

function reply(content: string) {
  return [chunk({ role: "assistant", content }), chunk({}, "stop")];
}

function call(name: string, args: Record<string, unknown>) {
  const id = `call_${++n}`;
  return [chunk({ role: "assistant", tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] }), chunk({}, "tool_calls")];
}

/** What to say next, given the conversation so far. */
export function decide(messages: Msg[]) {
  const last = messages[messages.length - 1];
  if (last?.role === "tool") return reply("done");
  const said = text([...messages].reverse().find((m) => m.role === "user")).trim();
  // The latest instruction, wherever OpenCode put it in the message.
  const line = said.split("\n").map((l) => l.trim()).reverse().find((l) => /^(bg-agent|fg-agent|nest-agent|bg-shell|essay|work|present)\b/.test(l)) ?? said;
  const [verb, ...rest] = line.split(/\s+/);
  if (verb === "work") return call("shell", { command: `sleep ${Number(rest[0]) || 5}`, timeout: 0 });
  if (verb === "bg-agent" || verb === "fg-agent") {
    const secs = Number(rest[1]) || 5;
    return call("subagent", { agent: "general", description: rest[0] ?? "Background job", prompt: `work ${secs}`, background: verb === "bg-agent" });
  }
  if (verb === "nest-agent") return call("subagent", { agent: "general", description: "Delegator", prompt: `bg-agent ${rest[0] ?? "inner"} ${Number(rest[1]) || 5}`, background: false });
  if (verb === "bg-shell") return call("shell", { command: `sleep ${Number(rest[0]) || 5}`, background: true });
  if (verb === "present") return call("present", { source: rest[0] ?? "", ...(rest.length > 1 ? { title: rest.slice(1).join(" ") } : {}) });
  if (verb === "essay") return reply(Array.from({ length: Number(rest[0]) || 20 }, (_, i) => `Line ${i + 1} of a long answer.`).join("\n\n"));
  return reply(`ok: ${said.slice(0, 80)}`);
}

if (import.meta.main) {
  const port = Number(process.env.FAKE_LLM_PORT ?? 4918);
  Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (req.method !== "POST") return Response.json({ object: "list", data: [{ id: "m", object: "model" }] });
      const body = (await req.json()) as { messages?: Msg[] };
      const chunks = decide(body.messages ?? []);
      const stream = new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(sse(ch));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    },
  });
  console.log(`fake model on http://127.0.0.1:${port}/v1`);
}
