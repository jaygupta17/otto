import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, ArrowDown, Check, ChevronRight, Copy, GitFork, Pencil, Redo2, RotateCw, SquareTerminal, Layers, Info, Undo2 } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { tokensPerSecond, type Block, type UIMessage } from "../../lib/opencode/projection";
import { duration, stamp } from "../../lib/format";
import { useNow } from "../../hooks/useNow";
import { revertIndex, useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { Markdown } from "./Markdown";
import { ActivityGroup, SubagentReport } from "./Activity";
import { TurnArtifacts } from "./PresentChip";
import { isStopError, toolKind } from "../../lib/opencode/tools";
import { ThreadSession } from "./ToolParts";
import { MessageAttachments } from "./Attachments";
import { TurnStatus, type RunError } from "./TurnStatus";
import { Spinner } from "../ui/AgentClock";
import { stepNow, Working } from "./Working";
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
      items.push({ type: "user", key: m.key ?? m.id, msg: m });
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

  // What the alert region says out loud: the failure in the turn the user is on,
  // or a timeline that wouldn't load. Older turns are history and stay quiet.
  const runError = useMemo<RunError | null>(() => {
    if (timeline?.error && !timeline.loaded) return { key: `load:${sessionId}`, text: timeline.error };
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.type !== "turn") continue;
      for (let j = it.msgs.length - 1; j >= 0; j--) {
        const m = it.msgs[j];
        if (m.kind === "notice" && m.tone === "error") return { key: `notice:${m.id}`, text: m.text };
        if (m.kind === "assistant" && m.error && !isStopError(m.error)) return { key: `error:${m.id}`, text: m.error };
      }
      return null;
    }
    return null;
  }, [items, timeline?.error, timeline?.loaded, sessionId]);

  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const pressing = useRef(false);
  const scrollFrame = useRef(0);
  const [showJump, setShowJump] = useState(false);

  // Clamp to the real range: while the tools panel animates its width the
  // thread reflows every frame, and a stale scrollHeight would leave the
  // viewport past the last row. Resize-driven follow is coalesced to one write
  // per frame; explicit jumps (session change, send, jump button) stay instant.
  const scrollToBottom = useCallback((smooth = false, immediate = false) => {
    const el = scroller.current;
    if (!el) return;
    const max = () => Math.max(0, el.scrollHeight - el.clientHeight);
    if (smooth) {
      if (scrollFrame.current) {
        cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = 0;
      }
      el.scrollTo({ top: max(), behavior: "smooth" });
      return;
    }
    if (immediate) {
      if (scrollFrame.current) {
        cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = 0;
      }
      el.scrollTop = max();
      return;
    }
    if (scrollFrame.current) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = 0;
      const box = scroller.current;
      // Re-check: a wheel/touch scroll that unpinned between scheduling and
      // this frame must win over the resize-driven follow.
      if (box && pinned.current && !pressing.current) box.scrollTop = Math.max(0, box.scrollHeight - box.clientHeight);
    });
  }, []);

  useEffect(() => () => cancelAnimationFrame(scrollFrame.current), []);

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
      else {
        // Growing content is fine to sit still on, but a shrink must not leave
        // the viewport past the last row. Never move the list under a held pointer.
        const box = scroller.current;
        if (box && !pressing.current) box.scrollTop = Math.min(box.scrollTop, Math.max(0, box.scrollHeight - box.clientHeight));
      }
    });
    ro.observe(el);
    ro.observe(box);
    return () => ro.disconnect();
  }, [scrollToBottom]);

  useLayoutEffect(() => {
    pinned.current = true;
    scrollToBottom(false, true);
  }, [sessionId, scrollToBottom]);

  // Lifting the pointer ends the hold above; catch up once the click has been
  // dispatched, so the catch-up scroll can't disturb the button that just ran.
  useEffect(() => {
    const release = () => {
      if (!pressing.current) return;
      pressing.current = false;
      if (!pinned.current) return;
      requestAnimationFrame(() => {
        if (pinned.current) scrollToBottom(false, true);
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
    // A new session's first message has nowhere to scroll from.
    const opening = seenUser.current === null;
    seenUser.current = lastUser;
    if (first) return;
    pinned.current = true;
    scrollToBottom(!opening);
  }, [lastUser, timeline?.loaded, scrollToBottom]);

  // Only the user's own scrolling unpins; our programmatic (and smooth) scrolls
  // pass through intermediate positions that must not count as "scrolled up".
  const touching = useRef(false);
  const userAt = useRef(0);
  const lastTop = useRef(0);
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

  // A small first page can leave the thread shorter than the viewport, where
  // there is nothing to scroll and the older messages would be unreachable.
  // Fill the screen before the user tries; stops as soon as it scrolls.
  useEffect(() => {
    if (!timeline?.loaded || !timeline.older || timeline.loading) return;
    const el = scroller.current;
    if (!el || el.scrollHeight > el.clientHeight + 40) return;
    void loadOlder(sessionId);
  }, [timeline?.loaded, timeline?.older, timeline?.loading, timeline?.messages.length, sessionId, loadOlder]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    const up = el.scrollTop < lastTop.current;
    lastTop.current = el.scrollTop;
    // The user's hand decides: any move up lets go of the bottom, even inside
    // the last 80px, so streaming never drags them back down mid-read; coming
    // back near the bottom holds on again. Scrolls the thread makes itself
    // only ever confirm being at the very bottom.
    if (touching.current || pressing.current || performance.now() - userAt.current < 300) pinned.current = up ? false : pinned.current || dist < 80;
    else if (dist < 2) pinned.current = true;
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

  // A centred time above a message that starts a new stretch of conversation: the first, and any after an hour's quiet.
  const stamps = useMemo(() => {
    const out = new Map<string, number>();
    let prev = 0;
    for (const it of items) {
      const t = it.type === "turn" ? it.msgs[0]?.time ?? 0 : it.msg.time;
      if (it.type === "user" && t && (!prev || t - prev > 3_600_000)) out.set(it.key, t);
      if (it.type === "turn") prev = it.msgs.reduce((a, m) => Math.max(a, m.time), prev);
      else if (t) prev = Math.max(prev, t);
    }
    return out;
  }, [items]);
  const now = useNow(true, 60_000);

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
        // Older messages dissolve into dots under the header instead of being sliced off by it.
        className="dither-fade-top scroll-quiet absolute inset-0 overflow-y-auto overscroll-contain outline-none">
        <div ref={content} className="mx-auto w-full max-w-[824px] px-5 pt-8 sm:px-8" style={{ paddingBottom: bottomInset + 20 }}>
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
            if (it.type === "user") {
              const at = stamps.get(it.key);
              return (
                <div key={it.key}>
                  {at && <div className="mt-6 mb-1 text-center font-mono text-[11px] text-faint tabular-nums first:mt-0">{stamp(at, now)}</div>}
                  <UserBubble msg={it.msg} sessionId={sessionId} />
                </div>
              );
            }
            if (it.type === "notice") return <NoticeRow key={it.key} msg={it.msg} />;
            const live = busy && i === items.length - 1;
            return <Turn key={it.key} msgs={it.msgs} live={live} start={it.start} retry={live ? retry : undefined} sessionId={sessionId} forkBefore={nextUsers[i]} />;
          })}
          {revert && hidden > 0 && <RevertBar sessionId={sessionId} files={revert.files?.length ?? 0} count={(timeline?.messages ?? []).slice(cut).filter((m) => m.kind === "user").length} />}
          {awaitingFirst && <Working doing="Thinking" />}
        </div>
      </div>
      {/* The run's two voices: polite for where it is, assertive for one that failed. Keyed so a new session starts from what's on screen, not what the last one said. */}
      <TurnStatus key={sessionId} busy={busy} retry={retry} error={runError} />
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
    <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }} className="group/user mt-5 mb-3 flex flex-col items-end">
      <MessageAttachments attachments={msg.attachments} files={msg.files} pending={msg.pending} />
      {msg.text && (
        <div className={`selectable relative max-w-[min(560px,80%)] rounded-[20px] bg-bubble-me px-4 py-2.5 text-[15px] leading-[1.45] whitespace-pre-wrap text-on-bubble-me ${msg.pending ? "opacity-60" : ""}`}>
          <div className={long && !expanded ? "max-h-[220px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]" : ""}>{msg.text}</div>
          {long && (
            <button className="mt-1 text-[13px] font-medium underline underline-offset-2 opacity-80 hover:opacity-100" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}
      {/* Actions sit under the bubble, right-aligned with it, shown on hover (always on phones). */}
      {real && (
        <div className="mt-0.5 -mr-1 flex h-7 shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/user:opacity-100 focus-within:opacity-100 max-[760px]:opacity-100">
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
          <ActionButton label="Fork from here into a new session" onClick={() => void useChat.getState().fork(sessionId, msg.id, msg.text, msg)}>
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

function segmentsOf(msgs: UIMessage[], thinking: boolean): Segment[] {
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
      } else if (b.kind !== "reasoning" || thinking) {
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

const isHandoff = (b: Block) => b.kind === "tool" && toolKind(b.name) === "subagent";

type TurnProps = { msgs: UIMessage[]; live: boolean; start: number; retry?: { attempt: number; message: string; next: number }; sessionId: string; forkBefore: string | null };

const Turn = memo(function Turn({ msgs, live, start, retry, sessionId, forkBefore }: TurnProps) {
  const thinking = useUI((s) => s.showThinking);
  const segs = useMemo(() => segmentsOf(msgs, thinking), [msgs, thinking]);
  const assistants = msgs.filter((m): m is Assistant => m.kind === "assistant");
  const end = assistants.reduce((acc, m) => Math.max(acc, m.completed ?? 0), 0);
  const text = segs.filter((s) => s.kind === "text").map((s) => (s as { text: string }).text).join("\n\n");
  const model = assistants.find((m) => m.model)?.model;
  const blocks = useMemo(() => msgs.flatMap((m) => (m.kind === "assistant" ? m.blocks : [])), [msgs]);
  // The reply's own words streaming in say it's working; anything else gets the status line.
  const writing = live && segs.some((s) => s.kind === "text" && s.streaming);
  const doing = live ? stepNow(blocks) : "";
  // A live run of steps carries the status line as its own heading, and a handoff still going
  // says what's happening on its own line; anywhere else the status line stands alone.
  const last = segs.at(-1);
  const tail = last?.kind === "activity" ? last.blocks : [];
  const handoffs = tail.slice(tail.findLastIndex((b) => !isHandoff(b)) + 1);
  const headed = live && tail.length > 0 && (handoffs.length === 0 || handoffs.some((b) => b.kind === "tool" && (b.status === "running" || b.status === "streaming")));

  return (
    <div className="group/turn mb-4 last:mb-0">
      {segs.map((s, i) => {
        if (s.kind === "text")
          return (
            <motion.div key={s.key} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }} className="bubble my-1.5 w-fit max-w-[min(640px,92%)] rounded-[20px] bg-bubble px-4 py-2.5">
              <Markdown text={s.text} streaming={live && s.streaming} />
            </motion.div>
          );
        if (s.kind === "activity") return <ActivityGroup key={s.key} blocks={s.blocks} live={live && i === segs.length - 1} retry={retry} />;
        if (s.kind === "shell") return <ShellCard key={s.key} msg={s.msg} />;
        if (s.kind === "subagent") return <SubagentReport key={s.key} msg={s.msg} />;
        return <ErrorCard key={s.key} text={s.text} />;
      })}
      {!live && <TurnArtifacts blocks={blocks} />}
      {live ? (
        !headed && (!writing || retry) && <Working doing={doing} retry={retry} />
      ) : (
        text && <TurnFooter text={text} took={end && start ? end - start : 0} model={model?.id} speed={turnSpeed(assistants)} onFork={() => void useChat.getState().fork(sessionId, forkBefore)} />
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
  if (a.live !== b.live || a.start !== b.start || a.retry !== b.retry || a.sessionId !== b.sessionId || a.forkBefore !== b.forkBefore) return false;
  if (a.msgs === b.msgs) return true;
  if (a.msgs.length !== b.msgs.length) return false;
  for (let i = 0; i < a.msgs.length; i++) if (a.msgs[i] !== b.msgs[i]) return false;
  return true;
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

/** Copy and fork as quiet icons; how long it took sits beside them, with the model and speed in its tooltip. */
function TurnFooter({ text, took, model, speed, onFork }: { text: string; took: number; model?: string; speed: number | null; onFork: () => void }) {
  const [copied, setCopied] = useState(false);
  const detail = [model, speed ? `${Math.round(speed)} tok/s` : ""].filter(Boolean).join(" · ");
  const btn = "grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-hover hover:text-ink";
  return (
    <div className="mt-1 flex h-7 min-w-0 items-center gap-0.5 text-[12px] whitespace-nowrap text-faint opacity-0 transition-opacity duration-200 group-hover/turn:opacity-100 max-[760px]:opacity-100">
      <button
        className={btn}
        aria-label={copied ? "Copied" : "Copy"}
        data-tip={copied ? "Copied" : "Copy"}
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      <button className={btn} aria-label="Fork" data-tip="Continue from here in a new session" onClick={onFork}>
        <GitFork size={14} />
      </button>
      {took > 0 && (
        <span className="ml-1 cursor-default px-1 tabular-nums" tabIndex={detail ? 0 : undefined} data-tip={detail || undefined} data-tip-tap={detail ? "" : undefined}>
          {duration(took)}
          {detail && <span className="sr-only"> · {detail}</span>}
        </span>
      )}
    </div>
  );
}

function ErrorCard({ text }: { text: string }) {
  const freeTier = /free tier/i.test(text);
  return (
    <div className="selectable my-3 flex items-start gap-2.5 rounded-[16px] border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[14px] text-ink">
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
              <div className="mt-3 rounded-2xl border border-line px-4 py-3 text-[13px] text-ink-2">
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
    <div className="my-3 overflow-hidden rounded-[16px] border border-line" style={{ background: "var(--code-bg)" }}>
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
      <div className="ml-auto h-10 w-2/5 rounded-[20px] bg-bubble" />
      <div className="h-24 w-3/4 rounded-[20px] bg-bubble" />
      <div className="ml-auto h-10 w-1/3 rounded-[20px] bg-bubble" />
      <div className="h-16 w-3/5 rounded-[20px] bg-bubble" />
    </div>
  );
}
