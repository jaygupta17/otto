import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, ArrowDown, Check, ChevronRight, Copy, GitFork, Pencil, Redo2, RotateCw, SquareTerminal, Layers, Info, Undo2 } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { tokensPerSecond, type Block, type UIMessage } from "../../lib/opencode/projection";
import { duration } from "../../lib/format";
import { useNow } from "../../hooks/useNow";
import { revertIndex, useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { AgentMark, TeammateFace } from "../ui/TeammateFace";
import { useAgentName, useTeammate } from "../../state/teammates";
import { Markdown } from "./Markdown";
import { ActivityGroup, SubagentReport } from "./Activity";
import { ScreenCard } from "./ScreenCard";
import { ChangedFiles } from "./ChangedFiles";
import { usesScreen } from "../../lib/browserSteps";
import { isStopError } from "../../lib/opencode/tools";
import { ThreadSession } from "./ToolParts";
import { AgentClock, Spinner } from "../ui/AgentClock";
import { Button } from "../ui/Button";
import { layerOpen } from "../../lib/layers";

type Assistant = Extract<UIMessage, { kind: "assistant" }>;
type Item =
  | { type: "user"; key: string; msg: Extract<UIMessage, { kind: "user" }> }
  | { type: "turn"; key: string; msgs: UIMessage[]; start: number }
  | { type: "notice"; key: string; msg: UIMessage };

/** Subagents and commands a call in this timeline started: their reports fold into that call's row. */
function claimedChildren(messages: UIMessage[]) {
  const ids = new Set<string>();
  for (const m of messages) {
    if (m.kind !== "assistant") continue;
    for (const b of m.blocks) {
      if (b.kind !== "tool") continue;
      const child = b.metadata?.sessionID ?? b.metadata?.sessionId;
      if (typeof child === "string") ids.add(child);
      if (typeof b.metadata?.shellID === "string") ids.add(b.metadata.shellID);
    }
  }
  return ids;
}

function buildItems(messages: UIMessage[]): Item[] {
  const items: Item[] = [];
  let turn: Extract<Item, { type: "turn" }> | null = null;
  let lastUserTime = 0;
  const claimed = claimedChildren(messages);
  for (const m of messages) {
    // Sent mid-run and not read yet: shown in the tray above the composer.
    if (m.kind === "user" && m.pending && m.delivery) continue;
    // The note telling the agent a stop was the user's; the card already says so.
    if (m.kind === "stopped") continue;
    if (m.kind === "subagent" && m.childID && claimed.has(m.childID)) continue;
    if (m.kind === "shellReport" && claimed.has(m.shellID)) continue;
    if (m.kind === "user") {
      turn = null;
      lastUserTime = m.time;
      items.push({ type: "user", key: m.id, msg: m });
    } else if (m.kind === "assistant" || m.kind === "shell" || m.kind === "shellReport" || m.kind === "subagent" || (m.kind === "notice" && m.tone === "error")) {
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
  const loadOlder = useChat((s) => s.loadOlder);
  const reload = useChat((s) => s.loadTimeline);

  const revert = useChat((s) => s.sessions[sessionId]?.revert);
  const cut = useMemo(() => revertIndex(timeline?.messages ?? [], revert), [timeline?.messages, revert]);
  const items = useMemo(() => buildItems((timeline?.messages ?? []).slice(0, cut)), [timeline?.messages, cut]);
  const hidden = (timeline?.messages.length ?? 0) - cut;

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const pressing = useRef(false);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Stay pinned to the bottom while content grows (streaming) and while the
  // viewport shrinks (keyboard, a taller composer), unless the user scrolled up.
  useLayoutEffect(() => {
    const el = content.current;
    const box = scroller.current;
    if (!el || !box) return;
    const ro = new ResizeObserver(() => {
      // A pointer held down must not have the list move under it: down and up
      // would land on different rows and the click would never fire.
      if (pinned.current && !pressing.current) scrollToBottom();
    });
    ro.observe(el);
    ro.observe(box);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  useLayoutEffect(() => {
    pinned.current = true;
    scrollToBottom();
  }, [sessionId, scrollToBottom]);

  // Lifting the pointer ends the hold above; catch up once the click has been
  // dispatched, so the catch-up scroll can't disturb the button that just ran.
  useEffect(() => {
    const release = () => {
      if (!pressing.current) return;
      pressing.current = false;
      if (!pinned.current) return;
      requestAnimationFrame(() => {
        if (pinned.current) scrollToBottom();
      });
    };
    // Capture, so a child stopping propagation can't leave us stuck pressing.
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", release);
    };
  }, [scrollToBottom]);

  // Sending a message follows it down, even from far up the thread.
  const lastUser = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].type === "user") return items[i].key;
    return null;
  }, [items]);
  const seenUser = useRef(lastUser);
  useLayoutEffect(() => {
    if (lastUser === seenUser.current) return;
    const first = seenUser.current === null && !timeline?.loaded;
    seenUser.current = lastUser;
    if (first) return;
    pinned.current = true;
    scrollToBottom(true);
  }, [lastUser, timeline?.loaded, scrollToBottom]);

  // Only the user's own scrolling unpins; our programmatic (and smooth) scrolls
  // pass through intermediate positions that must not count as "scrolled up".
  const touching = useRef(false);
  const userAt = useRef(0);
  const markUser = () => (userAt.current = performance.now());

  // PageUp / PageDown scroll the conversation from anywhere that isn't a text field
  // (the composer included: it's one paragraph, paging it is useless).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "PageUp" && e.key !== "PageDown") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      // With a sheet open, only the thread inside it (a subagent's) pages.
      if (layerOpen() && !scroller.current?.contains(t)) return;
      const field = t.isContentEditable || t.matches?.("input, textarea, select");
      if (field && !t.hasAttribute("data-composer")) return;
      if (!field && t !== document.body && !scroller.current?.contains(t)) return;
      const el = scroller.current;
      if (!el) return;
      e.preventDefault();
      markUser();
      el.scrollBy({ top: (e.key === "PageDown" ? 1 : -1) * el.clientHeight * 0.85, behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dist < 80) pinned.current = true;
    else if (touching.current || performance.now() - userAt.current < 300) pinned.current = false;
    setShowJump(dist > 400);
    if (el.scrollTop < 200 && timeline?.older && !timeline.loading) void loadOlder(sessionId);
  };

  // The user message after each item (fork point), in one pass instead of a scan per turn.
  const nextUsers = useMemo(() => {
    const out: (string | null)[] = new Array(items.length);
    let next: string | null = null;
    for (let i = items.length - 1; i >= 0; i--) {
      out[i] = next;
      if (items[i].type === "user") next = items[i].key;
    }
    return out;
  }, [items]);

  // The agent's screen shows once, at the end of the latest turn that worked on it.
  const screenAt = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type === "turn" && it.msgs.some((m) => m.kind === "assistant" && m.blocks.some(usesScreen))) return i;
    }
    return -1;
  }, [items]);

  const lastIsTurn = items.length > 0 && items[items.length - 1].type === "turn";
  const awaitingFirst = busy && !lastIsTurn;

  return (
    <ThreadSession.Provider value={sessionId}>
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        onWheel={markUser}
        onTouchStart={() => ((touching.current = true), markUser())}
        onTouchEnd={() => ((touching.current = false), markUser())}
        onTouchCancel={() => (touching.current = false)}
        onPointerDownCapture={() => (pressing.current = true)}
        onPointerDown={markUser}
        onKeyDown={markUser}
        tabIndex={0}
        role="region"
        aria-label="Conversation"
        className="scroll-quiet absolute inset-0 overflow-y-auto overscroll-contain outline-none">
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
            return <Turn key={it.key} msgs={it.msgs} live={live} screen={i === screenAt} start={it.start} retry={live ? retry : undefined} sessionId={sessionId} forkBefore={nextUsers[i]} />;
          })}
          {revert && hidden > 0 && <RevertBar sessionId={sessionId} files={revert.files?.length ?? 0} count={(timeline?.messages ?? []).slice(cut).filter((m) => m.kind === "user").length} />}
          {awaitingFirst && <Working sessionId={sessionId} />}
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
    </ThreadSession.Provider>
  );
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

type Segment = { kind: "text"; key: string; text: string; streaming: boolean } | { kind: "activity"; key: string; blocks: Block[] } | { kind: "error"; key: string; text: string } | { kind: "shell"; key: string; msg: Extract<UIMessage, { kind: "shell" }> } | { kind: "subagent"; key: string; msg: Extract<UIMessage, { kind: "subagent" }> };

function segmentsOf(msgs: UIMessage[]): Segment[] {
  const segs: Segment[] = [];
  let run: Block[] = [];
  const flushRun = () => {
    // Keyed by the run's own first block, so the same run keeps its key (and
    // the state inside it: open/closed) when prose starts streaming after it.
    if (run.length) segs.push({ kind: "activity", key: `act-${run[0].key}`, blocks: run });
    run = [];
  };
  for (const m of msgs) {
    if (m.kind === "shell") {
      flushRun();
      segs.push({ kind: "shell", key: m.id, msg: m });
      continue;
    }
    // A background command's result with no call in view (older history paged out).
    if (m.kind === "shellReport") {
      flushRun();
      segs.push({ kind: "shell", key: m.id, msg: { kind: "shell", id: m.id, command: m.command ?? "", status: "exited", exit: m.exit ?? (m.state === "completed" ? 0 : m.state), output: m.text, time: m.time } });
      continue;
    }
    if (m.kind === "subagent") {
      flushRun();
      segs.push({ kind: "subagent", key: m.id, msg: m });
      continue;
    }
    if (m.kind === "notice") {
      flushRun();
      segs.push({ kind: "error", key: m.id, text: m.text });
      continue;
    }
    if (m.kind !== "assistant") continue;
    for (const b of m.blocks) {
      if (b.kind === "text") {
        if (!b.text.trim()) continue;
        flushRun();
        segs.push({ kind: "text", key: `${m.id}-${b.key}`, text: b.text, streaming: b.streaming });
      } else {
        run.push({ ...b, key: `${m.id}:${b.key}` });
      }
    }
    // A stop isn't a failure: the "Stopped" divider already says it.
    if (m.error && !isStopError(m.error)) {
      flushRun();
      segs.push({ kind: "error", key: `${m.id}-err`, text: m.error });
    }
  }
  flushRun();
  return segs;
}

type TurnProps = { msgs: UIMessage[]; live: boolean; screen: boolean; start: number; retry?: { attempt: number; message: string; next: number }; sessionId: string; forkBefore: string | null };

const Turn = memo(function Turn({ msgs, live, screen, start, retry, sessionId, forkBefore }: TurnProps) {
  const segs = useMemo(() => segmentsOf(msgs), [msgs]);
  const assistants = msgs.filter((m): m is Assistant => m.kind === "assistant");
  const end = assistants.reduce((acc, m) => Math.max(acc, m.completed ?? 0), 0);
  const text = segs.filter((s) => s.kind === "text").map((s) => (s as { text: string }).text).join("\n\n");
  const model = assistants.find((m) => m.model)?.model;
  const blocks = useMemo(() => msgs.flatMap((m) => (m.kind === "assistant" ? m.blocks : [])), [msgs]);
  // Something above is already moving (streaming words, a running tool, a teammate on it): that says it's working.
  const moving = live && (segs.some((s) => s.kind === "text" && s.streaming) || blocks.some((b) => (b.kind === "tool" && (b.status === "running" || b.status === "streaming")) || (b.kind === "reasoning" && b.streaming)));

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
        if (s.kind === "subagent") return <SubagentReport key={s.key} msg={s.msg} />;
        return <ErrorCard key={s.key} text={s.text} />;
      })}
      {screen && <ScreenCard blocks={blocks} live={live} sessionId={sessionId} />}
      {!live && <ChangedFiles blocks={blocks} />}
      {live ? (
        (!moving || retry) && <Working sessionId={sessionId} retry={retry} />
      ) : (
        text && <TurnFooter text={text} took={end && start ? end - start : 0} model={model?.id} agent={assistants.find((m) => m.agent)?.agent} speed={turnSpeed(assistants)} onFork={() => void useChat.getState().fork(sessionId, forkBefore)} />
      )}
    </div>
  );
}, sameTurn);

/**
 * buildItems makes fresh `msgs` arrays every frame; the messages inside are
 * stable unless they changed. Compare them one by one so only the turn that's
 * streaming re-renders.
 */
function sameTurn(a: TurnProps, b: TurnProps) {
  if (a.live !== b.live || a.screen !== b.screen || a.start !== b.start || a.retry !== b.retry || a.sessionId !== b.sessionId || a.forkBefore !== b.forkBefore) return false;
  if (a.msgs === b.msgs) return true;
  if (a.msgs.length !== b.msgs.length) return false;
  for (let i = 0; i < a.msgs.length; i++) if (a.msgs[i] !== b.msgs[i]) return false;
  return true;
}

/**
 * The turn is live but nothing above is moving (waiting on the model, between
 * steps): just the teammate's working face (or the clock), so it never looks
 * frozen. Only a retry earns words.
 */
function Working({ sessionId, retry }: { sessionId: string; retry?: { attempt: number; message: string; next: number } }) {
  const now = useNow(!!retry);
  // A lead's part runs in a child session the sidebar doesn't list; it knows who's on it.
  const mate = useTeammate(useChat((s) => s.sessions[sessionId]?.agent ?? s.delegated[sessionId]));
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 flex h-6 items-center gap-2 text-[13.5px]" role="status" aria-label="Working">
      {mate ? <TeammateFace seed={mate.face} color={mate.color} accessory={mate.accessory} size={20} state="working" /> : <AgentClock />}
      {retry && (
        <span className="text-ink-2">
          Retrying{retry.attempt > 1 ? ` (attempt ${retry.attempt})` : ""}
          {retry.next > now ? ` in ${Math.ceil((retry.next - now) / 1000)}s` : ""} <span className="text-muted">· {retry.message}</span>
        </span>
      )}
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
  const agentName = useAgentName(agent);
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
          <AgentMark id={agent} color={info?.color} size={14} />
          {agentName}
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
  const freeTier = /free tier/i.test(text);
  return (
    <div className="selectable my-3 flex items-start gap-2.5 rounded-2xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[14px] text-ink">
      <AlertCircle size={16} className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 break-words">
        {text}
        {freeTier && (
          <div className="mt-1 text-[13px] text-ink-2">
            OpenCode's free models sometimes don't answer. Pick a model from a connected provider, or{" "}
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
