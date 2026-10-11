import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, ArrowDown, Check, ChevronRight, Copy, GitFork, Pencil, Redo2, RotateCw, ShieldQuestion, SquareTerminal, Layers, Info, Undo2 } from "lucide-react";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { tokensPerSecond, type Block, type UIMessage } from "../../lib/opencode/projection";
import { clock, duration } from "../../lib/format";
import { useNow } from "../../hooks/useNow";
import { revertIndex, useChat, type FormLite } from "../../state/chat";
import { useUI } from "../../state/ui";
import { agentColor } from "../../lib/agentColor";
import type { PermissionRequestLite } from "../../lib/opencode/client";
import { Markdown } from "./Markdown";
import { ActivityGroup } from "./Activity";
import { AgentClock, Spinner } from "../ui/AgentClock";
import { Button } from "../ui/Button";

type Assistant = Extract<UIMessage, { kind: "assistant" }>;
type Item =
  | { type: "user"; key: string; msg: Extract<UIMessage, { kind: "user" }> }
  | { type: "turn"; key: string; msgs: UIMessage[]; start: number }
  | { type: "notice"; key: string; msg: UIMessage };

function buildItems(messages: UIMessage[]): Item[] {
  const items: Item[] = [];
  let turn: Extract<Item, { type: "turn" }> | null = null;
  let lastUserTime = 0;
  for (const m of messages) {
    // Sent mid-run and not read yet: shown in the tray above the composer.
    if (m.kind === "user" && m.pending && m.delivery) continue;
    if (m.kind === "user") {
      turn = null;
      lastUserTime = m.time;
      items.push({ type: "user", key: m.id, msg: m });
    } else if (m.kind === "assistant" || m.kind === "shell" || (m.kind === "notice" && m.tone === "error")) {
      if (!turn) {
        turn = { type: "turn", key: `turn-${m.id}`, msgs: [], start: lastUserTime || m.time };
        items.push(turn);
      }
      turn.msgs.push(m);
    } else {
      items.push({ type: "notice", key: m.id, msg: m });
    }
  }
  return items;
}

export function Thread({ sessionId, bottomInset = 0 }: { sessionId: string; bottomInset?: number }) {
  const timeline = useChat((s) => s.timelines[sessionId]);
  const busy = useChat((s) => !!s.busy[sessionId]);
  const retry = useChat((s) => s.retrying[sessionId]);
  const permissions = useChat((s) => s.permissions);
  const forms = useChat((s) => s.forms);
  const loadOlder = useChat((s) => s.loadOlder);
  const reload = useChat((s) => s.loadTimeline);

  const revert = useChat((s) => s.sessions[sessionId]?.revert);
  const cut = useMemo(() => revertIndex(timeline?.messages ?? [], revert), [timeline?.messages, revert]);
  const items = useMemo(() => buildItems((timeline?.messages ?? []).slice(0, cut)), [timeline?.messages, cut]);
  const hidden = (timeline?.messages.length ?? 0) - cut;
  const asks = useMemo(() => Object.values(permissions).filter((p) => p.sessionID === sessionId), [permissions, sessionId]);
  const sessionForms = useMemo(() => Object.values(forms).filter((f) => f.sessionID === sessionId), [forms, sessionId]);

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Stay pinned to the bottom while content grows (streaming), unless the user scrolled up.
  useLayoutEffect(() => {
    const el = content.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) scrollToBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  useLayoutEffect(() => {
    pinned.current = true;
    scrollToBottom();
  }, [sessionId, scrollToBottom]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinned.current = dist < 80;
    setShowJump(dist > 400);
    if (el.scrollTop < 200 && timeline?.older && !timeline.loading) void loadOlder(sessionId);
  };

  const lastIsTurn = items.length > 0 && items[items.length - 1].type === "turn";
  const awaitingFirst = busy && !lastIsTurn;

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="scroll-quiet absolute inset-0 overflow-y-auto overscroll-contain">
        <div ref={content} className="mx-auto w-full max-w-[760px] px-5 pt-6 sm:px-8" style={{ paddingBottom: bottomInset + 32 }}>
          {timeline?.loading && !timeline.loaded && <ThreadSkeleton />}
          {timeline?.error && !timeline.loaded && (
            <div className="mt-16 flex flex-col items-center gap-3 text-center">
              <AlertCircle className="text-danger" />
              <div className="text-[14px] text-muted">{timeline.error}</div>
              <Button size="sm" icon={<RotateCw size={14} />} onClick={() => reload(sessionId, true)}>
                Try again
              </Button>
            </div>
          )}
          {timeline?.older && timeline.loading && (
            <div className="flex justify-center py-3 text-muted">
              <Spinner />
            </div>
          )}
          {items.map((it, i) => {
            if (it.type === "user") return <UserBubble key={it.key} msg={it.msg} sessionId={sessionId} />;
            if (it.type === "notice") return <NoticeRow key={it.key} msg={it.msg} />;
            const live = busy && i === items.length - 1;
            const nextUser = items.slice(i + 1).find((x) => x.type === "user");
            return <Turn key={it.key} msgs={it.msgs} live={live} start={it.start} retry={live ? retry : undefined} sessionId={sessionId} forkBefore={nextUser?.key ?? null} />;
          })}
          {revert && hidden > 0 && <RevertBar sessionId={sessionId} files={revert.files?.length ?? 0} count={(timeline?.messages ?? []).slice(cut).filter((m) => m.kind === "user").length} />}
          {awaitingFirst && <Working start={lastUserTimeOf(items)} seed={String(lastUserTimeOf(items))} />}
          <AnimatePresence>
            {asks.map((p) => (
              <PermissionCard key={p.id} req={p} />
            ))}
            {sessionForms.map((f) => (
              <FormCard key={f.id} form={f} />
            ))}
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence>
        {showJump && (
          <motion.button
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            onClick={() => {
              pinned.current = true;
              scrollToBottom(true);
            }}
            className="surface-float absolute left-1/2 z-10 grid h-8 w-8 -translate-x-1/2 place-items-center rounded-full border border-line bg-raised text-ink-2 shadow-float hover:text-ink"
            style={{ bottom: bottomInset + 12 }}
            aria-label="Jump to latest"
          >
            <ArrowDown size={16} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function lastUserTimeOf(items: Item[]) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.type === "user") return it.msg.time;
  }
  return Date.now();
}

// ---------------------------------------------------------------------------

const UserBubble = memo(function UserBubble({ msg, sessionId }: { msg: Extract<UIMessage, { kind: "user" }>; sessionId: string }) {
  const long = msg.text.length > 1200;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const real = !msg.pending && !msg.id.startsWith("local_");
  return (
    <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="group/user mt-8 mb-4 flex flex-col items-end first:mt-0">
      <div className={`selectable relative max-w-[min(560px,85%)] rounded-3xl bg-active px-3.5 py-2 text-[15px] leading-[1.5] whitespace-pre-wrap text-ink ${msg.pending ? "opacity-70" : ""}`}>
        <div className={long && !expanded ? "max-h-[220px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" : ""}>{msg.text}</div>
        {long && (
          <button className="mt-1 text-[13px] font-medium text-ink underline underline-offset-2" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Show less" : "Show more"}
          </button>
        )}
        {msg.files?.length ? <div className="mt-2 flex flex-wrap gap-1.5">{msg.files.map((f) => <span key={f.uri} className="rounded-md bg-sunken px-2 py-0.5 text-[12px] text-muted">{f.name ?? f.uri.split("/").pop()}</span>)}</div> : null}
      </div>
      {real && (
        <div className="mt-1 flex h-7 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/user:opacity-100 focus-within:opacity-100 max-[760px]:opacity-100">
          <ActionButton
            label={copied ? "Copied" : "Copy"}
            onClick={() => {
              void navigator.clipboard.writeText(msg.text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </ActionButton>
          <ActionButton label="Edit and resend (undoes from here)" onClick={() => void useChat.getState().undo(sessionId, msg.id)}>
            <Pencil size={13} />
          </ActionButton>
          <ActionButton label="Fork from here into a new session" onClick={() => void useChat.getState().fork(sessionId, msg.id, msg.text)}>
            <GitFork size={13} />
          </ActionButton>
        </div>
      )}
    </motion.div>
  );
});

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} title={label} onClick={onClick} className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink">
      {children}
    </button>
  );
}

/** Shown while an undo is staged: the hidden tail can be brought back until you send something new. */
function RevertBar({ sessionId, count, files }: { sessionId: string; count: number; files: number }) {
  const undo = useChat((s) => s.undo);
  const redo = useChat((s) => s.redo);
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="my-6 flex items-center gap-2 rounded-2xl border border-dashed border-line-strong px-3.5 py-2.5 text-[13px]">
      <Undo2 size={14} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 text-ink-2">
        Undid {count} message{count === 1 ? "" : "s"}
        {files > 0 && <span className="text-muted"> · restored {files} file{files === 1 ? "" : "s"}</span>}
        <span className="text-muted"> · sending makes it final</span>
      </span>
      <Button size="sm" variant="ghost" icon={<Undo2 size={13} />} onClick={() => void undo(sessionId)}>
        Undo more
      </Button>
      <Button size="sm" icon={<Redo2 size={13} />} onClick={() => void redo(sessionId)}>
        Redo
      </Button>
    </motion.div>
  );
}

type Segment = { kind: "text"; key: string; text: string; streaming: boolean } | { kind: "activity"; key: string; blocks: Block[] } | { kind: "error"; key: string; text: string } | { kind: "shell"; key: string; msg: Extract<UIMessage, { kind: "shell" }> };

function segmentsOf(msgs: UIMessage[]): Segment[] {
  const segs: Segment[] = [];
  let run: Block[] = [];
  const flushRun = (key: string) => {
    if (run.length) segs.push({ kind: "activity", key: `act-${key}`, blocks: run });
    run = [];
  };
  for (const m of msgs) {
    if (m.kind === "shell") {
      flushRun(m.id);
      segs.push({ kind: "shell", key: m.id, msg: m });
      continue;
    }
    if (m.kind === "notice") {
      flushRun(m.id);
      segs.push({ kind: "error", key: m.id, text: m.text });
      continue;
    }
    if (m.kind !== "assistant") continue;
    for (const b of m.blocks) {
      if (b.kind === "text") {
        if (!b.text.trim()) continue;
        flushRun(`${m.id}-${b.key}`);
        segs.push({ kind: "text", key: `${m.id}-${b.key}`, text: b.text, streaming: b.streaming });
      } else {
        run.push({ ...b, key: `${m.id}:${b.key}` });
      }
    }
    if (m.error) {
      flushRun(m.id);
      segs.push({ kind: "error", key: `${m.id}-err`, text: m.error });
    }
  }
  flushRun("tail");
  return segs;
}

const Turn = memo(function Turn({ msgs, live, start, retry, sessionId, forkBefore }: { msgs: UIMessage[]; live: boolean; start: number; retry?: { attempt: number; message: string; next: number }; sessionId: string; forkBefore: string | null }) {
  const segs = useMemo(() => segmentsOf(msgs), [msgs]);
  const assistants = msgs.filter((m): m is Assistant => m.kind === "assistant");
  const end = assistants.reduce((acc, m) => Math.max(acc, m.completed ?? 0), 0);
  const text = segs.filter((s) => s.kind === "text").map((s) => (s as { text: string }).text).join("\n\n");
  const model = assistants.find((m) => m.model)?.model;

  return (
    <div className="group/turn mb-6">
      {segs.map((s, i) => {
        if (s.kind === "text")
          return (
            <motion.div key={s.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="my-2.5">
              <Markdown text={s.text} streaming={live && s.streaming} />
            </motion.div>
          );
        if (s.kind === "activity") return <ActivityGroup key={s.key} blocks={s.blocks} live={live && i === segs.length - 1} />;
        if (s.kind === "shell") return <ShellCard key={s.key} msg={s.msg} />;
        return <ErrorCard key={s.key} text={s.text} />;
      })}
      {live ? (
        <Working start={start} seed={String(start)} retry={retry} />
      ) : (
        text && <TurnFooter text={text} took={end && start ? end - start : 0} model={model?.id} agent={assistants.find((m) => m.agent)?.agent} speed={turnSpeed(assistants)} onFork={() => void useChat.getState().fork(sessionId, forkBefore)} />
      )}
    </div>
  );
});

function Working({ start, retry }: { start: number; seed?: string; retry?: { attempt: number; message: string; next: number } }) {
  const now = useNow(true);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 flex h-6 items-center gap-2 text-[13px]">
      <AgentClock />
      {retry ? (
        <span className="text-ink-2">
          Retrying{retry.attempt > 1 ? ` (attempt ${retry.attempt})` : ""}
          {retry.next > now ? ` in ${Math.ceil((retry.next - now) / 1000)}s` : ""} <span className="text-muted">· {retry.message}</span>
        </span>
      ) : (
        <span className="text-ink-2">Working</span>
      )}
      <span className="text-muted tabular-nums">{clock(now - start)}</span>
    </motion.div>
  );
}

/** Output tokens/second across a turn's steps (weighted by tokens). */
function turnSpeed(steps: Assistant[]): number | null {
  let tokens = 0;
  let secs = 0;
  for (const m of steps) {
    const tps = tokensPerSecond(m);
    if (!tps) continue;
    const out = (m.tokens?.output ?? 0) + (m.tokens?.reasoning ?? 0);
    tokens += out;
    secs += out / tps;
  }
  return secs > 0 ? tokens / secs : null;
}

function TurnFooter({ text, took, model, agent, speed, onFork }: { text: string; took: number; model?: string; agent?: string; speed: number | null; onFork: () => void }) {
  const [copied, setCopied] = useState(false);
  const info = useChat((s) => (agent ? s.agents.find((a) => a.id === agent) : undefined));
  return (
    <div className="mt-1 flex h-7 min-w-0 items-center gap-1 text-[12px] whitespace-nowrap text-faint opacity-0 transition-opacity duration-200 group-hover/turn:opacity-100 max-[760px]:opacity-100">
      <button
        className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-hover hover:text-ink"
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Copied" : "Copy"}
      </button>
      {agent && (
        <span className="flex items-center gap-1.5 px-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: agentColor(agent, info?.color) }} />
          {info?.name ?? agent}
        </span>
      )}
      {model && <span className="min-w-0 truncate px-1">· {model}</span>}
      {took > 0 && <span className="px-1">· {duration(took)}</span>}
      {speed && <span className="px-1 tabular-nums" title="Output tokens per second">· {Math.round(speed)} tok/s</span>}
      <button className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-hover hover:text-ink" title="Continue from this point in a new session" onClick={onFork}>
        <GitFork size={13} /> Fork
      </button>
    </div>
  );
}

function ErrorCard({ text }: { text: string }) {
  // OpenCode's free models only accept OpenCode's own system prompt. An agent
  // with custom instructions replaces it, so Zen refuses that agent.
  const freeTier = /free tier/i.test(text);
  return (
    <div className="selectable my-3 flex items-start gap-2.5 rounded-2xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[14px] text-ink">
      <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 break-words">
        {text}
        {freeTier && (
          <div className="mt-1 text-[13px] text-ink-2">
            OpenCode's free models only work with agents that keep OpenCode's built-in prompt. This agent has its own instructions, so switch to Build or Plan, pick a model from a provider, or{" "}
            <button className="underline underline-offset-2 hover:text-ink" onClick={() => useUI.getState().openSettings("providers")}>
              connect a provider
            </button>
            .
          </div>
        )}
      </div>
    </div>
  );
}

function NoticeRow({ msg }: { msg: UIMessage }) {
  const [open, setOpen] = useState(false);
  if (msg.kind === "compaction") {
    const text = msg.status === "running" ? "Compacting conversation…" : msg.status === "failed" ? "Compaction failed" : "Conversation compacted";
    return (
      <div className="my-5">
        <div className="flex items-center gap-3 text-[12px] text-faint">
          <div className="h-px flex-1 bg-line" />
          <button disabled={!msg.summary} onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 enabled:hover:bg-hover enabled:hover:text-ink">
            {msg.status === "running" ? <Spinner size={12} /> : <Layers size={12} />}
            {text}
            {msg.summary && <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />}
          </button>
          <div className="h-px flex-1 bg-line" />
        </div>
        <AnimatePresence initial={false}>
          {open && msg.summary && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              <div className="mt-3 rounded-2xl border border-line px-4 py-3 text-[13.5px] text-ink-2">
                <Markdown text={msg.summary} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }
  const text = msg.kind === "notice" ? msg.text : "";
  if (!text) return null;
  return (
    <div className="my-4 flex items-center gap-3 text-[12px] text-faint">
      <div className="h-px flex-1 bg-line" />
      <span className="flex items-center gap-1.5">
        <Info size={12} />
        {text}
      </span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

function ShellCard({ msg }: { msg: Extract<UIMessage, { kind: "shell" }> }) {
  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-line" style={{ background: "var(--code-bg)" }}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 font-mono text-[12px] text-ink-2">
        <SquareTerminal size={13} className="text-muted" />
        <span className="truncate">$ {msg.command}</span>
        {msg.status === "running" ? <Spinner size={12} className="ml-auto text-muted" /> : <span className="ml-auto text-faint">exit {String(msg.exit ?? "?")}</span>}
      </div>
      {msg.output && <pre className="selectable scroll-quiet max-h-60 overflow-auto px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-muted">{msg.output}</pre>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asks
// ---------------------------------------------------------------------------

function PermissionCard({ req }: { req: PermissionRequestLite }) {
  const reply = useChat((s) => s.replyPermission);
  const what = req.resources.length ? req.resources.slice(0, 3).join(", ") + (req.resources.length > 3 ? ` +${req.resources.length - 3}` : "") : "";
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
      className="my-4 overflow-hidden rounded-2xl border border-info/40 bg-raised"
    >
      <div className="flex items-start gap-2.5 px-4 pt-3">
        <ShieldQuestion size={16} className="mt-0.5 shrink-0 text-info" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium text-info">Needs your approval</div>
          <div className="mt-0.5 text-[14px] text-ink">
            Allow <span className="font-semibold">{req.action}</span>?
          </div>
          {what && <div className="selectable mt-0.5 truncate font-mono text-[12px] text-muted">{what}</div>}
          {req.message && <div className="selectable mt-1 text-[13px] text-ink-2">{req.message}</div>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2 px-3 pb-3">
        <Button size="sm" variant="ghost" onClick={() => reply(req, "reject")}>
          Deny
        </Button>
        <Button size="sm" variant="secondary" onClick={() => reply(req, "always")}>
          Always allow
        </Button>
        <Button size="sm" variant="primary" onClick={() => reply(req, "once")}>
          Allow once
        </Button>
      </div>
    </motion.div>
  );
}

function FormCard({ form }: { form: FormLite }) {
  const reply = useChat((s) => s.replyForm);
  const visible = form.fields.filter((f) => !f.hidden);
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(visible.filter((f) => f.default !== undefined).map((f) => [f.key, f.default])));
  const set = (k: string, v: unknown) => setValues((p) => ({ ...p, [k]: v }));
  const ready = visible.every((f) => !f.required || (values[f.key] !== undefined && values[f.key] !== "" && !(Array.isArray(values[f.key]) && (values[f.key] as unknown[]).length === 0)));

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} className="my-4 overflow-hidden rounded-2xl border border-info/40 bg-raised">
      <div className="px-4 pt-3 text-[12px] font-medium text-info">The agent has a question</div>
      <div className="px-4 pt-0.5 text-[15px] font-semibold">{form.title}</div>
      <div className="space-y-4 px-4 py-3">
        {visible.map((f) => (
          <div key={f.key}>
            {(f.title || visible.length > 1) && <div className="mb-1 text-[13px] font-medium text-ink-2">{f.title ?? f.key}</div>}
            {f.description && <div className="mb-2 text-[12.5px] text-muted">{f.description}</div>}
            {f.options?.length ? (
              <div className="flex flex-wrap gap-1.5">
                {f.options.map((o) => {
                  const multi = f.type === "multiselect";
                  const cur = values[f.key];
                  const on = multi ? Array.isArray(cur) && cur.includes(o.value) : cur === o.value;
                  return (
                    <button
                      key={o.value}
                      onClick={() => set(f.key, multi ? (on ? (cur as string[]).filter((x) => x !== o.value) : [...((cur as string[]) ?? []), o.value]) : o.value)}
                      className={`rounded-lg border px-3 py-1.5 text-[13px] transition-colors ${on ? "border-ink bg-ink text-bg" : "border-line-strong bg-raised text-ink hover:bg-hover"}`}
                    >
                      {o.label ?? o.value}
                    </button>
                  );
                })}
              </div>
            ) : f.type === "boolean" ? (
              <div className="flex gap-1.5">
                {[true, false].map((v) => (
                  <button key={String(v)} onClick={() => set(f.key, v)} className={`rounded-lg border px-3 py-1.5 text-[13px] ${values[f.key] === v ? "border-ink bg-ink text-bg" : "border-line-strong bg-raised hover:bg-hover"}`}>
                    {v ? "Yes" : "No"}
                  </button>
                ))}
              </div>
            ) : (
              <input
                className="field h-9 w-full rounded-lg px-3 text-[14px] outline-none"
                type={f.type === "number" || f.type === "integer" ? "number" : "text"}
                placeholder={f.placeholder}
                value={(values[f.key] as string) ?? ""}
                onChange={(e) => set(f.key, f.type === "number" || f.type === "integer" ? Number(e.target.value) : e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 px-3 pb-3">
        <Button size="sm" variant="ghost" onClick={() => reply(form, null)}>
          Skip
        </Button>
        <Button size="sm" variant="primary" disabled={!ready} onClick={() => reply(form, values)}>
          Send
        </Button>
      </div>
    </motion.div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="animate-pulse space-y-6 pt-4">
      <div className="ml-auto h-10 w-2/5 rounded-3xl bg-sunken" />
      <div className="space-y-2.5">
        <div className="h-3.5 w-3/4 rounded-full bg-sunken" />
        <div className="h-3.5 w-2/3 rounded-full bg-sunken" />
        <div className="h-3.5 w-1/2 rounded-full bg-sunken" />
      </div>
      <div className="ml-auto h-10 w-1/3 rounded-3xl bg-sunken" />
      <div className="space-y-2.5">
        <div className="h-3.5 w-4/5 rounded-full bg-sunken" />
        <div className="h-3.5 w-1/2 rounded-full bg-sunken" />
      </div>
    </div>
  );
}
