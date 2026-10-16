import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  Brain,
  Braces,
  ChevronRight,
  FilePen,
  FilePlus2,
  FolderSearch,
  Globe,
  Link2,
  ListChecks,
  MessageCircleQuestion,
  Sparkles,
  Square,
  SquareArrowOutUpRight,
  SquareTerminal,
  TextSearch,
  Users,
  Wrench,
} from "lucide-react";
import { memo, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Block, UIMessage } from "../../lib/opencode/projection";
import {
  diffStats,
  fileDiffs,
  firstChangedLine,
  inputOf,
  lineCount,
  memoryCalls,
  memorySearch,
  subagentOf,
  subagentPhase,
  summarizeTools,
  toolKind,
  toolLabel,
  isStopError,
  toolFailed,
  type SubagentReportLite,
  type ToolBlock,
} from "../../lib/opencode/tools";
import { duration } from "../../lib/format";
import { useNow } from "../../hooks/useNow";
import { useChat } from "../../state/chat";
import { openSubagent } from "../../state/subagent";
import { useMemory } from "../../state/memory";
import { agentColor } from "../../lib/agentColor";
import { AgentClock } from "../ui/AgentClock";
import { TeammateFace, type FaceState } from "../ui/TeammateFace";
import { useAgentName, useTeammate } from "../../state/teammates";
import { ErrorBlock, ProseBox, ToolBody } from "./ToolBody";
import { ImageStrip } from "./ImageStrip";
import { browserSteps, type BrowserStep } from "../../lib/browserSteps";
import { CopyButton, FileIcon, PathLabel, Section, ThreadSession, ToolBoundary, useOpenFile } from "./ToolParts";

type ReasonBlock = Extract<Block, { kind: "reasoning" }>;

const ease = [0.22, 1, 0.36, 1] as const;
const isSubagent = (b: Block): b is ToolBlock => b.kind === "tool" && toolKind(b.name) === "subagent";
const isLive = (b: ToolBlock) => b.status === "running" || b.status === "streaming";

/**
 * A run of tool calls and thoughts between two pieces of prose. Tools fold
 * into one summary line ("Edited 2 files · ran 3 commands") that opens into a
 * tree of rows; subagents stand on their own, in order, since they run long
 * and have a conversation of their own to open.
 */
export const ActivityGroup = memo(function ActivityGroup({ blocks, live }: { blocks: Block[]; live: boolean }) {
  const segments = useMemo(() => {
    const out: ({ kind: "tools"; blocks: Block[]; key: string } | { kind: "agent"; b: ToolBlock })[] = [];
    for (const b of blocks) {
      if (isSubagent(b)) out.push({ kind: "agent", b });
      else {
        const last = out.at(-1);
        if (last?.kind === "tools") last.blocks.push(b);
        else out.push({ kind: "tools", blocks: [b], key: b.key });
      }
    }
    return out;
  }, [blocks]);
  return (
    <div className="my-1.5">
      {segments.map((s, i) =>
        s.kind === "agent" ? <SubagentRow key={s.b.key} b={s.b} /> : <ToolRun key={s.key} blocks={s.blocks} live={live && i === segments.length - 1} />,
      )}
    </div>
  );
});

const ToolRun = memo(function ToolRun({ blocks, live }: { blocks: Block[]; live: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const browser = useMemo(() => browserSteps(blocks), [blocks]);
  const stepOf = useMemo(() => new Map(browser.map((s) => [s.b.key, s.step])), [browser]);
  const running = blocks.some((b) => (b.kind === "tool" && isLive(b)) || (b.kind === "reasoning" && b.streaming));
  const open = userOpen ?? (live || running);
  const failed = blocks.filter(toolFailed).length;
  // "Worked for 1m 12s" leads; what was done follows quietly. Thinking alone reads as "Thought".
  const actions = useMemo(() => blocks.filter((b) => b.kind === "tool"), [blocks]);
  const detail = actions.length ? summarizeTools(actions) : "";
  const first = Math.min(...blocks.map((b) => (b.kind === "tool" || b.kind === "reasoning" ? b.started : Infinity)));
  const last = Math.max(...blocks.map((b) => (b.kind === "tool" || b.kind === "reasoning" ? (b.ended ?? b.started) : 0)));
  const now = useNow(running);
  const took = (running ? now : last) - first;
  const verb = actions.length ? (running ? "Working" : "Worked") : running ? "Thinking" : "Thought";
  return (
    <div>
      <button
        aria-expanded={open}
        onClick={() => setUserOpen(!open)}
        className="group -ml-1 flex max-w-full items-center gap-1.5 rounded-md px-1 py-1 text-[14px] text-muted transition-colors hover:text-ink"
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18, ease }} className="text-faint group-hover:text-ink">
          <ChevronRight size={15} />
        </motion.span>
        {running && <AgentClock size={12} />}
        <span className="shrink-0 text-ink-2 group-hover:text-ink">
          {verb}
          {Number.isFinite(took) && took >= 1000 && <span className="tabular-nums"> for {duration(took)}</span>}
        </span>
        {detail && <span className="min-w-0 truncate text-faint">· {detail.charAt(0).toLowerCase() + detail.slice(1)}</span>}
        {failed > 0 && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-px text-[12px] font-medium text-danger" title={`${failed} failed`}>
            <AlertTriangle size={11} /> {failed}
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease }} className="overflow-hidden">
            <div className="relative ml-[7px] border-l border-line py-1 pl-4">
              {blocks.map((b) => (b.kind === "tool" ? <ToolRow key={b.key} b={b} step={stepOf.get(b.key)} /> : b.kind === "reasoning" ? <ThoughtRow key={b.key} b={b} /> : null))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Images it looked at stay in view when the run folds. */}
      <ImageStrip blocks={blocks} />
    </div>
  );
});

function iconFor(b: ToolBlock, size = 15): ReactNode {
  if (memoryCalls(b)) return <Bookmark size={size} />;
  switch (toolKind(b.name)) {
    case "read":
      return <BookOpen size={size} />;
    case "edit":
    case "patch":
      return <FilePen size={size} />;
    case "write":
      return <FilePlus2 size={size} />;
    case "grep":
      return <TextSearch size={size} />;
    case "glob":
      return <FolderSearch size={size} />;
    case "shell":
      return <SquareTerminal size={size} />;
    case "execute":
      return <Braces size={size} />;
    case "webfetch":
      return <Link2 size={size} />;
    case "websearch":
      return <Globe size={size} />;
    case "subagent":
      return <Users size={size} />;
    case "question":
      return <MessageCircleQuestion size={size} />;
    case "skill":
      return <Sparkles size={size} />;
    case "todo":
      return <ListChecks size={size} />;
    default:
      return <Wrench size={size} />;
  }
}

/** Waits two frames before mounting, so opening a heavy body never delays the click. */
function useDeferred(on: boolean) {
  const [ready, setReady] = useState(on);
  useEffect(() => {
    if (!on) return setReady(false);
    let b = 0;
    const a = requestAnimationFrame(() => (b = requestAnimationFrame(() => setReady(true))));
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, [on]);
  return ready;
}

/** The facts worth a glance on the row itself: +/− lines, exit code, hits, range. */
function rowBadges(b: ToolBlock): ReactNode[] {
  const kind = toolKind(b.name);
  const input = inputOf(b);
  const md = b.metadata ?? {};
  const out: ReactNode[] = [];
  if (kind === "edit" || kind === "patch" || kind === "write") {
    const stats = diffStats(fileDiffs(md));
    const add = stats?.add ?? (kind === "write" && typeof input.content === "string" ? lineCount(input.content) : undefined);
    const del = stats?.del;
    if (add || del)
      out.push(
        <span key="d" className="font-mono text-[12px] tabular-nums">
          {add ? <span className="text-ok">+{add}</span> : null}
          {add && del ? " " : null}
          {del ? <span className="text-danger">−{del}</span> : null}
        </span>,
      );
  }
  if (kind === "shell") {
    const exit = typeof md.exit === "number" ? md.exit : typeof md.exitCode === "number" ? md.exitCode : undefined;
    if (exit !== undefined && exit !== 0) out.push(<span key="x" className="font-mono text-[12px] text-danger">exit {exit}</span>);
  }
  if ((kind === "grep" || kind === "glob") && b.status === "completed") {
    const n = typeof md.matches === "number" ? md.matches : typeof md.count === "number" ? md.count : undefined;
    if (n !== undefined) out.push(<span key="n" className="text-[12px] text-faint tabular-nums">{n === 0 ? "none" : `${n} ${kind === "glob" ? "path" : "hit"}${n === 1 ? "" : "s"}`}</span>);
  }
  if (kind === "read") {
    const off = typeof input.offset === "number" ? input.offset : undefined;
    const lim = typeof input.limit === "number" ? input.limit : undefined;
    if (off || lim) out.push(<span key="r" className="font-mono text-[12px] text-faint tabular-nums">L{off ?? 1}{lim ? `–${(off ?? 1) + lim - 1}` : "+"}</span>);
  }
  return out;
}

const TIMED = new Set(["shell", "execute", "webfetch", "websearch", "other"]);

const ToolRow = memo(function ToolRow({ b, step }: { b: ToolBlock; step?: BrowserStep }) {
  const [open, setOpen] = useState(false);
  const ready = useDeferred(open);
  const openFile = useOpenFile();
  // A browser step reads as what it did ("Clicked “Sign in”"), not the command behind it.
  const label = step ? { verb: step.verb, target: step.target } : toolLabel(b);
  const kind = toolKind(b.name);
  const active = isLive(b);
  const stopped = b.status === "error" && isStopError(b.error);
  const failed = (b.status === "error" && !stopped) || !!step?.failed;
  const now = useNow(active && TIMED.has(kind));
  const elapsed = (b.ended ?? (active ? now : b.started)) - b.started;
  const mono = !step && (kind === "shell" || kind === "glob");
  const badges = rowBadges(b);
  const files = label.files ?? [];
  const mem = memoryCalls(b);
  const jumpLine = kind === "read" ? (typeof inputOf(b).offset === "number" ? (inputOf(b).offset as number) : undefined) : firstChangedLine(fileDiffs(b.metadata)[0]?.patch);

  return (
    <div className="relative">
      <span className="absolute top-[14px] -left-4 h-px w-3 bg-line" />
      <div className="group/row flex min-w-0 items-center gap-1 rounded-md pr-1 transition-colors hover:bg-hover">
        <button
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-[14px] outline-none"
          title={b.name}
        >
          <span className={`relative grid h-5 w-5 shrink-0 place-items-center rounded-md ${failed ? "text-danger" : "text-muted"}`}>
            {active ? (
              <AgentClock size={12} />
            ) : (
              <>
                <span className={`transition-opacity ${open ? "opacity-0" : "group-hover/row:opacity-0 group-focus-within/row:opacity-0"}`}>{step ? <Globe size={15} /> : iconFor(b)}</span>
                <ChevronRight
                  size={14}
                  className={`absolute text-faint transition-[opacity,transform] ${open ? "rotate-90 opacity-100" : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"}`}
                />
              </>
            )}
          </span>
          <span className={`shrink-0 ${failed ? "text-danger" : active ? "text-ink" : "text-ink-2"}`}>{label.verb}</span>
          {label.path ? (
            <PathLabel path={label.path} className="text-[13.5px]" />
          ) : files.length > 1 ? (
            <span className="flex min-w-0 items-center gap-1 overflow-hidden">
              {files.slice(0, 3).map((f) => (
                <span key={f} className="inline-flex max-w-[180px] min-w-0 items-center gap-1 rounded-md border border-line bg-raised px-1.5 py-px text-[12.5px] text-ink-2" title={f}>
                  <FileIcon path={f} size={12} />
                  <span className="truncate">{f.split("/").pop()}</span>
                </span>
              ))}
              {files.length > 3 && <span className="shrink-0 text-[12px] text-faint">+{files.length - 3}</span>}
            </span>
          ) : (
            <span className={`min-w-0 truncate ${mono ? "font-mono text-[12.5px]" : ""} text-muted`}>{label.target || (b.status === "streaming" ? "…" : "")}</span>
          )}
          {badges.length > 0 && <span className="flex shrink-0 items-center gap-2">{badges}</span>}
          {stopped && <span className="shrink-0 text-[12px] text-faint">stopped</span>}
        </button>
        {label.path && kind !== "other" && !(kind === "write" && active) && (
          <button
            aria-label={`Open ${label.path}`}
            title="Open file"
            onClick={() => openFile(label.path!, jumpLine)}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-active hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <SquareArrowOutUpRight size={12} />
          </button>
        )}
        {mem && !active && !failed && (
          <button
            aria-label="Show in Memory"
            title="Show in Memory"
            onClick={() => useMemory.getState().show(memorySearch(mem))}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-active hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <SquareArrowOutUpRight size={12} />
          </button>
        )}
        {(active ? TIMED.has(kind) && elapsed > 1500 : elapsed > 1500) && <span className="shrink-0 pl-1 text-[12px] text-faint tabular-nums">{duration(elapsed)}</span>}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease }} className="overflow-hidden">
            <div className="relative mb-2 ml-[9px] pl-[18px]">
              <button aria-label="Collapse" title="Collapse" onClick={() => setOpen(false)} className="group/line absolute top-0 bottom-0 left-0 w-3 -translate-x-1/2 cursor-pointer">
                <span className="absolute top-1 bottom-1 left-1/2 w-px -translate-x-1/2 bg-line transition-colors group-hover/line:bg-line-strong" />
              </button>
              <div className="pt-0.5">
                {ready ? (
                  <ToolBoundary name={label.verb.toLowerCase()}>
                    <ToolBody b={b} />
                  </ToolBoundary>
                ) : (
                  <div className="h-8" />
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Subagents
// ---------------------------------------------------------------------------

/**
 * Who a task went to: a teammate's face (wearing the task's state) and name,
 * or a plain agent's colour dot.
 */
function Assignee({ agent, state = "idle" }: { agent?: string; state?: FaceState }) {
  const t = useTeammate(agent);
  const name = useAgentName(agent);
  return (
    <>
      {t ? <TeammateFace seed={t.face} color={t.color} accessory={t.accessory} size={22} state={state} /> : <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: agentColor(agent) }} />}
      <span className="min-w-0 truncate font-medium text-ink">{name || "Subagent"}</span>
    </>
  );
}

/** Is `sid` the child or a descendant of it (a subagent's own subagents ask through it)? */
function within(parents: Record<string, string>, sid: string, child: string) {
  for (let s: string | undefined = sid, i = 0; s && i < 8; s = parents[s], i++) if (s === child) return true;
  return false;
}

/** The child's latest step, when its conversation is loaded: "Edit · Thread.tsx". */
function useLatestStep(child: string | undefined): { b: ToolBlock; steps: number } | null {
  const msgs = useChat((st) => (child ? st.timelines[child]?.messages : undefined));
  return useMemo(() => {
    if (!msgs) return null;
    let steps = 0;
    let last: ToolBlock | null = null;
    for (const m of msgs) if (m.kind === "assistant") for (const b of m.blocks) if (b.kind === "tool") (steps++, (last = b));
    return last ? { b: last, steps } : null;
  }, [msgs]);
}

/**
 * A delegated task as a card: who's on it, how it stands, what it's doing
 * right now, and its result. Stopping tells the parent agent first that it
 * was the user, so the cancellation doesn't read as a failure to retry.
 */
const SubagentRow = memo(function SubagentRow({ b }: { b: ToolBlock }) {
  const [open, setOpen] = useState(false);
  const sid = useContext(ThreadSession);
  const s = subagentOf(b);
  const child = s.childID;
  const childBusy = useChat((st) => (child ? !!st.busy[child] : false));
  const report = useChat((st): SubagentReportLite | undefined => {
    if (!child || !sid) return undefined;
    const msgs = st.timelines[sid]?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.kind === "subagent" && m.childID === child) return m;
    }
    return undefined;
  });
  const stopped = useChat((st) => !!child && !!sid && !!st.timelines[sid]?.messages.some((m) => m.kind === "stopped" && m.childID === child));
  const asking = useChat(
    (st) => !!child && (Object.values(st.permissions).some((p) => within(st.parents, p.sessionID, child)) || Object.values(st.forms).some((f) => within(st.parents, f.sessionID, child))),
  );
  const stopSubagent = useChat((st) => st.stopSubagent);
  const [stopping, setStopping] = useState(false);

  const { phase, output, error, ended } = subagentPhase(b, { childBusy, report, stopped: stopped || stopping });
  const running = phase === "running" || (phase === "background" && childBusy);
  const now = useNow(running);
  const took = (ended ?? (running ? now : b.ended ?? b.started)) - b.started;

  // A running child's conversation, so the card can say what it's doing now.
  useEffect(() => {
    if (!child || !running) return;
    const t = useChat.getState().timelines[child];
    if (!t || (!t.loaded && !t.loading)) void useChat.getState().loadTimeline(child);
  }, [child, running]);
  const latest = useLatestStep(child);
  const step = latest?.b ? toolLabel(latest.b) : null;

  const status = asking
    ? "Needs you"
    : phase === "running"
      ? s.background && !isLive(b)
        ? "Running in background"
        : "Working"
      : phase === "background"
        ? "Started in background"
        : phase === "stopped"
          ? "Stopped"
          : phase === "error"
            ? "Failed"
            : "Done";
  const tone = asking ? "text-info" : phase === "error" ? "text-danger" : "text-faint";
  const teammate = !!useTeammate(s.agent);
  const face: FaceState = asking ? "needs" : running ? "working" : phase === "done" ? "done" : "idle";

  const stop = async () => {
    if (!child || !sid) return;
    setStopping(true);
    try {
      await stopSubagent(sid, child, s.description);
    } catch {
      setStopping(false);
    }
  };

  return (
    <div className={`my-2 overflow-hidden rounded-xl border bg-raised ${asking ? "border-info/50" : "border-line"}`}>
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
        <button aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left text-[14px]">
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18, ease }} className="shrink-0 text-faint">
            <ChevronRight size={14} />
          </motion.span>
          <Assignee agent={s.agent} state={face} />
          <span className="min-w-0 shrink-[8] truncate text-muted">{s.description ?? ""}</span>
        </button>
        <span className={`flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums ${tone}`}>
          {running && !asking && !teammate && <AgentClock size={11} />}
          {/* A teammate's face already says it's working; the time is enough. */}
          {!(teammate && status === "Working") && <span className="max-sm:max-w-[84px] max-sm:truncate">{status}</span>}
          {took > 1500 && <span>{duration(took)}</span>}
        </span>
        {child && running && (
          <button
            aria-label="Stop subagent"
            title="Stop this subagent"
            disabled={stopping}
            onClick={() => void stop()}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-danger hover:bg-danger-soft disabled:opacity-50"
          >
            <Square size={10} className="fill-current" />
            <span className="hidden sm:inline">{stopping ? "Stopping" : "Stop"}</span>
          </button>
        )}
        {child && (
          <button
            aria-label="Open the subagent's conversation"
            onClick={() => openSubagent(child, s.agent, s.description)}
            className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted hover:bg-hover hover:text-ink"
          >
            Open <SquareArrowOutUpRight size={11} />
          </button>
        )}
      </div>

      {/* What it's doing right now (or that it's waiting on you). */}
      {running && (asking || step) && (
        <div className="-mt-1 flex min-w-0 items-center gap-2 px-3 pb-2 pl-[38px] text-[12.5px] text-muted">
          {asking ? (
            <span className="text-info">Waiting for your approval or answer below</span>
          ) : step && latest?.b ? (
            <>
              <span className="shrink-0 text-faint">{iconFor(latest.b, 12)}</span>
              <span className="shrink-0 text-ink-2">{step.verb}</span>
              {step.path ? <PathLabel path={step.path} /> : <span className="min-w-0 truncate">{step.target}</span>}
              {latest.steps > 1 && <span className="ml-auto shrink-0 text-faint">{latest.steps} steps</span>}
            </>
          ) : null}
        </div>
      )}

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease }} className="overflow-hidden">
            <div className="space-y-2.5 border-t border-line px-3 py-2.5">
              {s.prompt && (
                <Section title="Task" actions={<CopyButton text={s.prompt} label="Copy task" />}>
                  <ProseBox text={s.prompt} />
                </Section>
              )}
              {output && (
                <Section title={phase === "stopped" ? "Partial result" : "Result"} actions={<CopyButton text={output} label="Copy result" />}>
                  <ProseBox text={output} />
                </Section>
              )}
              {phase === "stopped" && (
                <div className="text-[12.5px] text-faint">{stopped ? "You stopped this subagent. The agent was told it was you, not a failure." : "Stopped before it finished."}</div>
              )}
              {phase === "background" && <div className="text-[12.5px] text-faint">Runs in the background; its report lands here when it's done.</div>}
              {error && <ErrorBlock text={error} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/** A subagent's report with no call in view to fold into (older history paged out, or another chat). */
export const SubagentReport = memo(function SubagentReport({ msg }: { msg: Extract<UIMessage, { kind: "subagent" }> }) {
  const failed = msg.state === "error" || msg.state === "failed";
  const stopped = msg.state === "interrupted" || msg.state === "cancelled";
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-line bg-raised">
      <div className="flex min-w-0 items-center gap-2 border-b border-line px-3 py-2 text-[13.5px]">
        <Assignee agent={msg.agent} state={failed || stopped ? "idle" : "done"} />
        <span className={`shrink-0 ${failed ? "text-danger" : "text-muted"}`}>{failed ? "failed" : stopped ? "stopped" : "reported back"}</span>
        {msg.description && <span className="min-w-0 shrink-[8] truncate text-faint">· {msg.description}</span>}
        <div className="ml-auto flex shrink-0 items-center">
          {msg.text && <CopyButton text={msg.text} label="Copy report" />}
          {msg.childID && (
            <button onClick={() => openSubagent(msg.childID!, msg.agent, msg.description)} className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted hover:bg-hover hover:text-ink">
              Open <SquareArrowOutUpRight size={11} />
            </button>
          )}
        </div>
      </div>
      {msg.text && (
        <div className="p-2">
          <ProseBox text={msg.text} />
        </div>
      )}
    </div>
  );
});

const ThoughtRow = memo(function ThoughtRow({ b }: { b: ReasonBlock }) {
  const [open, setOpen] = useState(false);
  const secs = b.ended ? Math.max(1, Math.round((b.ended - b.started) / 1000)) : 0;
  return (
    <div className="relative">
      <span className="absolute top-[14px] -left-4 h-px w-3 bg-line" />
      <button aria-expanded={open || b.streaming} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-md py-1 text-left text-[14px] hover:bg-hover">
        <span className="grid h-5 w-5 place-items-center text-muted">{b.streaming ? <AgentClock size={12} /> : <Brain size={15} />}</span>
        <span className={b.streaming ? "text-ink" : "text-ink-2"}>{b.streaming ? "Thinking" : "Thought process"}</span>
        {secs > 0 && <span className="text-[12px] text-faint">{secs}s</span>}
      </button>
      <AnimatePresence initial={false}>
        {(open || b.streaming) && b.text && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease }} className="overflow-hidden">
            <div className={`selectable mb-2 ml-7 border-l border-line pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted ${b.streaming ? "flex max-h-[120px] flex-col justify-end overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_30%)]" : ""}`}>
              {b.streaming ? b.text.slice(-600) : b.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
