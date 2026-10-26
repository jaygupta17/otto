import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Blocks,
  Bookmark,
  Brain,
  Braces,
  ChevronRight,
  FilePen,
  FilePlus2,
  FolderSearch,
  Globe,
  Image as ImageIcon,
  Link2,
  ListChecks,
  MessageCircleQuestion,
  Sparkles,
  SendToBack,
  Square,
  SquareArrowOutUpRight,
  SquareTerminal,
  TextSearch,
  Users,
  Wrench,
} from "lucide-react";
import { memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Block, UIMessage } from "../../lib/opencode/projection";
import {
  backgroundShellID,
  appOf,
  backgroundShellPhase,
  diffStats,
  fileDiffs,
  firstChangedLine,
  inputOf,
  lineCount,
  memoryCalls,
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
import { appLogo } from "../../lib/composio";
import { duration } from "../../lib/format";
import { useNow } from "../../hooks/useNow";
import { useChat } from "../../state/chat";
import { useShells } from "../../state/shells";
import { openSubagent, useSiblings } from "../../state/subagent";
import { useMemory } from "../../state/memory";
import { AgentMark, type FaceState } from "../ui/Bird";
import { useFace } from "../../state/face";
import { useAgentName } from "../../state/teammates";
import { Loader, stepNow, type Retry } from "./Working";
import { useDoing } from "../../state/tiers";
import { ErrorBlock, ProseBox, ToolBody } from "./ToolBody";
import { browserSteps, type BrowserStep } from "../../lib/browserSteps";
import { CopyButton, FileIcon, PathLabel, Section, ThreadSession, ToolBoundary, useOpenFile } from "./ToolParts";

type ReasonBlock = Extract<Block, { kind: "reasoning" }>;

const ease = [0.22, 1, 0.36, 1] as const;
const isSubagent = (b: Block): b is ToolBlock => b.kind === "tool" && toolKind(b.name) === "subagent";
const isLive = (b: ToolBlock) => b.status === "running" || b.status === "streaming";

/**
 * A run of tool calls and thoughts between two pieces of prose. Tools fold
 * into one line ("Worked 55s") that opens into a tree of rows; while the run
 * is the live end of a turn, that line is the turn's status ("Reading
 * Thread.tsx…"). Subagents stand on their own, in order, since they run long
 * and have a conversation of their own to open.
 */
export const ActivityGroup = memo(function ActivityGroup({ blocks, live, retry }: { blocks: Block[]; live: boolean; retry?: Retry }) {
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
        s.kind === "agent" ? <SubagentRow key={s.b.key} b={s.b} /> : <ToolRun key={s.key} blocks={s.blocks} live={live && i === segments.length - 1} retry={retry} />,
      )}
    </div>
  );
});

const ToolRun = memo(function ToolRun({ blocks, live, retry }: { blocks: Block[]; live: boolean; retry?: Retry }) {
  // Folded until you open it, live or not: the line says what it's on.
  const [open, setOpen] = useState(false);
  const browser = useMemo(() => browserSteps(blocks), [blocks]);
  const stepOf = useMemo(() => new Map(browser.map((s) => [s.b.key, s.step])), [browser]);
  const running = blocks.some((b) => (b.kind === "tool" && isLive(b)) || (b.kind === "reasoning" && b.streaming));
  const failed = blocks.filter(toolFailed).length;
  // "Worked 1m 12s" leads; what was done follows quietly. Thinking alone reads as "Thought".
  const actions = useMemo(() => blocks.filter((b) => b.kind === "tool"), [blocks]);
  const detail = actions.length ? summarizeTools(actions) : "";
  const first = Math.min(...blocks.map((b) => (b.kind === "tool" || b.kind === "reasoning" ? b.started : Infinity)));
  const last = Math.max(...blocks.map((b) => (b.kind === "tool" || b.kind === "reasoning" ? (b.ended ?? b.started) : 0)));
  const now = useNow(running);
  const took = (running ? now : last) - first;
  const verb = actions.length ? (running ? "Working" : "Worked") : running ? "Thinking" : "Thought";
  // Commands it left running keep going after the run folds; say so on the line.
  const ids = useMemo(() => blocks.flatMap((b) => (b.kind === "tool" ? (backgroundShellID(b) ?? []) : [])), [blocks]);
  const going = useShells((st) => ids.filter((id) => st.byId[id]?.status === "running" && !st.stopped[id]).length);
  // Folded, a long command holding up the turn still offers to carry on by itself.
  const holding = live && !open ? blocks.findLast((b): b is ToolBlock => b.kind === "tool" && isLive(b) && toolKind(b.name) === "shell" && !backgroundShellID(b) && typeof b.metadata?.shellID === "string") : undefined;
  const sid = useContext(ThreadSession);
  const [sending, setSending] = useState(false);
  return (
    <div>
      <div className="flex max-w-full items-center gap-1">
        <button
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          data-tip={detail || undefined}
          className={`group -ml-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 text-[13px] text-muted transition-colors hover:text-ink ${live ? "h-7" : "py-1"}`}
        >
          {live ? (
            <Loader doing={stepNow(blocks)} retry={retry} />
          ) : (
            <>
              <span className={`shrink-0 ${running ? "shimmer" : "text-ink-2 group-hover:text-ink"}`}>{verb}</span>
              {Number.isFinite(took) && took >= 1000 && <span className="shrink-0 text-faint tabular-nums">{duration(took)}</span>}
            </>
          )}
          {/* What was done shows on hover; the line itself stays a quiet "Worked 55s". */}
          {detail && <span className="sr-only">: {detail}</span>}
          {!running && going > 0 && <span className="shimmer shrink-0">· {going} still running</span>}
          {failed > 0 && (
            <span className="ml-1 inline-flex items-center gap-1 text-[12px] text-danger" aria-label={`${failed} failed`}>
              <AlertTriangle size={12} /> {failed}
            </span>
          )}
          <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18, ease }} className="shrink-0 text-faint group-hover:text-ink">
            <ChevronRight size={14} />
          </motion.span>
        </button>
        {holding && sid && now - holding.started > 4000 && (
          <button
            aria-label="Keep running in the background"
            title="Keep running in the background"
            disabled={sending}
            onClick={async () => {
              setSending(true);
              await useChat.getState().background(sid);
              setSending(false);
            }}
            className={`${rowIcon} disabled:opacity-50`}
          >
            <SendToBack size={13} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease }} className="overflow-hidden">
            <div className="relative ml-[7px] border-l border-line py-1 pl-4">
              {blocks.map((b) => (b.kind === "tool" ? <ToolRow key={b.key} b={b} step={stepOf.get(b.key)} /> : b.kind === "reasoning" ? <ThoughtRow key={b.key} b={b} /> : null))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

function iconFor(b: ToolBlock, size = 15): ReactNode {
  if (memoryCalls(b)) return <Bookmark size={size} />;
  const app = appOf(b);
  if (app) return <img src={appLogo(app)} alt="" width={size - 2} height={size - 2} draggable={false} className="rounded-[3px]" />;
  if (app === "") return <Blocks size={size} />;
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
    case "present":
      return <ImageIcon size={size} />;
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
    if (n !== undefined) out.push(<span key="n" className="text-[12px] text-faint font-mono tabular-nums">{n === 0 ? "none" : `${n} ${kind === "glob" ? "path" : "hit"}${n === 1 ? "" : "s"}`}</span>);
  }
  if (kind === "read") {
    const off = typeof input.offset === "number" ? input.offset : undefined;
    const lim = typeof input.limit === "number" ? input.limit : undefined;
    if (off || lim) out.push(<span key="r" className="font-mono text-[12px] text-faint tabular-nums">L{off ?? 1}{lim ? `–${(off ?? 1) + lim - 1}` : "+"}</span>);
  }
  return out;
}

const TIMED = new Set(["shell", "execute", "webfetch", "websearch", "other"]);

/**
 * A command the agent left running, as its row sees it: the call settled at
 * once, so its state, output and end come from the live list and then from
 * the report it sends back. Output is read once a second while you watch.
 */
function useBackgroundShell(call: ToolBlock, watching: boolean) {
  const id = backgroundShellID(call);
  const sid = useContext(ThreadSession);
  const report = useChat((st) => {
    if (!id || !sid) return undefined;
    const msgs = st.timelines[sid]?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.kind === "shellReport" && m.shellID === id) return m;
    }
    return undefined;
  });
  const noted = useChat((st) => !!id && !!sid && !!st.timelines[sid]?.messages.some((m) => m.kind === "stopped" && m.shellID === id));
  const live = useShells((st) => (id ? st.byId[id] : undefined));
  const stoppedHere = useShells((st) => !!id && !!st.stopped[id]);
  const tail = useShells((st) => (id ? st.tails[id]?.text : undefined));
  const { phase, exit, error } = backgroundShellPhase(report, live, noted || stoppedHere);
  useEffect(() => {
    if (!id || !watching || phase !== "running") return;
    const read = () => void useShells.getState().read(id);
    read();
    const t = setInterval(read, 1000);
    return () => clearInterval(t);
  }, [id, watching, phase]);
  if (!id) return null;
  // A stop's report only says the command is gone; what it printed until then is the story.
  const output = phase === "stopped" ? tail : (report?.text ?? tail);
  const settled = phase === "done" || phase === "error" || phase === "stopped";
  const view: ToolBlock = {
    ...call,
    status: phase === "running" ? "running" : "completed",
    output: output || undefined,
    ended: settled ? report?.time : undefined,
    metadata: { ...call.metadata, exit, output: undefined },
  };
  return { id, phase, error, view, stop: () => useShells.getState().stop(id) };
}

const ToolRow = memo(function ToolRow({ b: call, step }: { b: ToolBlock; step?: BrowserStep }) {
  const [open, setOpen] = useState(false);
  const ready = useDeferred(open);
  const openFile = useOpenFile();
  const bg = useBackgroundShell(call, open);
  const b = bg?.view ?? call;
  // A browser step reads as what it did ("Clicked “Sign in”"), not the command behind it.
  const label = step ? { verb: step.verb, target: step.target } : toolLabel(b);
  const kind = toolKind(b.name);
  const active = isLive(b);
  const stopped = bg ? bg.phase === "stopped" : b.status === "error" && isStopError(b.error);
  const failed = (b.status === "error" && !stopped) || bg?.phase === "error" || !!step?.failed;
  // A long command holding up the turn can carry on by itself while the agent moves on.
  const sid = useContext(ThreadSession);
  const blocking = !bg && active && kind === "shell" && typeof call.metadata?.shellID === "string";
  const [sending, setSending] = useState(false);
  const now = useNow(active && TIMED.has(kind));
  const elapsed = (b.ended ?? (active ? now : b.started)) - b.started;
  const mono = !step && (kind === "shell" || kind === "glob");
  const badges = rowBadges(b);
  const files = label.files ?? [];
  const mem = memoryCalls(b);
  const jumpLine = kind === "read" ? (typeof inputOf(b).offset === "number" ? (inputOf(b).offset as number) : undefined) : firstChangedLine(fileDiffs(b.metadata)[0]?.patch);

  return (
    <div className="relative">
      <TrailNode tone={failed ? "failed" : active ? "live" : "done"} />
      <div className="group/row flex min-w-0 items-center gap-1 rounded-md pr-1 transition-colors hover:bg-hover">
        <button
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-[14px] outline-none"
          title={b.name}
        >
          <span className={`relative grid h-5 w-5 shrink-0 place-items-center rounded-md ${failed ? "text-danger" : "text-muted"}`}>
            {/* The turn's status line says it's live; the row keeps its icon. */}
            <span className={`transition-opacity ${open ? "opacity-0" : "group-hover/row:opacity-0 group-focus-within/row:opacity-0"}`}>{step ? <Globe size={15} /> : iconFor(b)}</span>
            <ChevronRight
              size={14}
              className={`absolute text-faint transition-[opacity,transform] ${open ? "rotate-90 opacity-100" : "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"}`}
            />
          </span>
          <span className={`shrink-0 ${failed ? "text-danger" : active ? "shimmer" : "text-ink-2"}`}>{label.verb}</span>
          {label.path ? (
            <PathLabel path={label.path} className="text-[13px]" />
          ) : files.length > 1 ? (
            <span className="flex min-w-0 items-center gap-1 overflow-hidden">
              {files.slice(0, 3).map((f) => (
                <span key={f} className="inline-flex max-w-[180px] min-w-0 items-center gap-1 rounded-md border border-line bg-raised px-1.5 py-px text-[12px] text-ink-2" title={f}>
                  <FileIcon path={f} size={12} />
                  <span className="truncate">{f.split("/").pop()}</span>
                </span>
              ))}
              {files.length > 3 && <span className="shrink-0 text-[12px] text-faint">+{files.length - 3}</span>}
            </span>
          ) : (
            <span className={`min-w-0 truncate ${mono ? "font-mono text-[12px]" : ""} text-muted`}>{label.target || (b.status === "streaming" ? "…" : "")}</span>
          )}
          {badges.length > 0 && <span className="flex shrink-0 items-center gap-2">{badges}</span>}
          {stopped && <span className="shrink-0 text-[12px] text-faint">stopped</span>}
          {(bg?.phase === "running" || bg?.phase === "background") && <span className="shrink-0 text-[12px] text-faint">in the background</span>}
        </button>
        {bg?.phase === "running" && (
          <button aria-label="Stop command" title="Stop" onClick={() => void bg.stop()} className={`${rowIcon} hover:!text-danger`}>
            <Square size={10} className="fill-current" />
          </button>
        )}
        {blocking && sid && now - call.started > 4000 && (
          <button
            aria-label="Keep running in the background"
            title="Keep running in the background"
            disabled={sending}
            onClick={async () => {
              setSending(true);
              await useChat.getState().background(sid);
              setSending(false);
            }}
            className={`${rowIcon} disabled:opacity-50`}
          >
            <SendToBack size={13} />
          </button>
        )}
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
            onClick={() => useMemory.getState().show()}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-active hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <SquareArrowOutUpRight size={12} />
          </button>
        )}
        {(active ? TIMED.has(kind) && elapsed > 1500 : elapsed > 1500) && <span className="shrink-0 pl-1 text-[12px] text-faint font-mono tabular-nums">{duration(elapsed)}</span>}
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
                    {bg && <BackgroundNote phase={bg.phase} error={bg.error} />}
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

/** A step's mark on the trail: a square pixel on the rail, lit while it runs and red when it failed. */
function TrailNode({ tone }: { tone: "done" | "live" | "failed" }) {
  const color = tone === "live" ? "bg-accent" : tone === "failed" ? "bg-danger" : "bg-line-strong";
  return <span aria-hidden className={`absolute top-[12px] -left-[18px] z-[1] h-[5px] w-[5px] ${color}`} />;
}

/** Row actions that wait at the end of a line until you reach for it (always shown on touch). */
const rowIcon =
  "grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-active hover:text-ink focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

function BackgroundNote({ phase, error }: { phase: string; error?: string }) {
  const text =
    phase === "running"
      ? "Runs in the background while the agent carries on. It hears back when the command ends."
      : phase === "background"
        ? "Runs in the background. Its output lands here when it's done."
        : phase === "stopped"
          ? "You stopped it. The agent was told it was you, not a failure."
          : error;
  return text ? <div className={`mt-2.5 text-[12px] ${phase === "error" ? "text-danger" : "text-faint"}`}>{text}</div> : null;
}

// ---------------------------------------------------------------------------
// Subagents
// ---------------------------------------------------------------------------

/**
 * Who a task went to: their bird (a helper's glyph, a plain agent's orb) wearing the task's
 * state, so it is the spinner, the check and the alert at once. The name
 * waits in its tooltip; the line beside it is for what they're doing. On a
 * phone a tap on the bird says who it is instead of opening the row.
 */
function Avatar({ agent, name, state = "idle" }: { agent?: string; name: string; state?: FaceState }) {
  const touch = useRef(false);
  return (
    <span
      data-tip={name}
      data-tip-tap
      onPointerDown={(e) => (touch.current = e.pointerType !== "mouse")}
      onClick={(e) => touch.current && e.stopPropagation()}
      className="grid shrink-0 place-items-center"
    >
      <AgentMark id={agent} size={40} state={state} label={name} />
    </span>
  );
}

const chevron = (open: boolean) => (
  <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18, ease }} className="shrink-0 text-faint group-hover/line:text-ink">
    <ChevronRight size={14} />
  </motion.span>
);

/** A handoff is a line on the chat itself: no box, no fill. */
const runCard = "group/agent relative my-1";

/** Small icon actions at the end of a handoff line: Stop and their conversation are always in reach. */
const rowAction = "grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink";

/** Is `sid` the child or a descendant of it (a subagent's own subagents ask through it)? */
function within(parents: Record<string, string>, sid: string, child: string) {
  for (let s: string | undefined = sid, i = 0; s && i < 8; s = parents[s], i++) if (s === child) return true;
  return false;
}

/**
 * A delegated task as a line: the teammate's bird and what they're doing
 * right now, shimmering while it's live. Done, it says how long it took and
 * nothing more; it opens into the brief and the whole result. Their
 * conversation and Stop wait at the end of the line. Stopping tells the parent
 * agent first that it was the user, so the cancellation doesn't read as a
 * failure to retry.
 */
const SubagentRow = memo(function SubagentRow({ b }: { b: ToolBlock }) {
  const [open, setOpen] = useState(false);
  const sid = useContext(ThreadSession);
  const s = subagentOf(b);
  const child = s.childID;
  const childBusy = useChat((st) => (child ? !!st.busy[child] : false));
  const childFace = useFace(child);
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
  const name = useAgentName(s.agent) || "Subagent";
  const [stopping, setStopping] = useState(false);
  // What tells it apart from the others handed a part in the same turn: its task, or a letter.
  const sibs = useSiblings(child, sid ?? undefined);
  const label = (sibs.at >= 0 ? sibs.labels[sibs.at] : s.description?.trim()) || "";

  const { phase, output, error, ended } = subagentPhase(b, { childBusy, report, stopped: stopped || stopping });
  const running = phase === "running" || (phase === "background" && childBusy);
  const now = useNow(running);
  const took = (ended ?? (running ? now : b.ended ?? b.started)) - b.started;

  // What the child is doing now, from its conversation (loaded while it runs).
  const doing = useDoing(child, running);

  const face: FaceState = asking
    ? "needs"
    : running
      ? childFace === "writing" || childFace === "retrying"
        ? childFace
        : "working"
      : phase === "done"
        ? "done"
        : phase === "error"
          ? "failed"
          : phase === "stopped"
            ? "stopped"
            : "idle";
  // One phrase carries the state: live work shimmers, trouble takes the status hue, a finish is just its time.
  const line = asking ? (
    <span className="min-w-0 truncate text-info">Needs you</span>
  ) : running ? (
    <span className="shimmer min-w-0 truncate">{doing || (label ? "Working" : s.description || "Working")}</span>
  ) : phase === "background" ? (
    <span className="min-w-0 truncate text-muted">In the background</span>
  ) : phase === "error" ? (
    <span className="min-w-0 truncate text-danger">Couldn't finish</span>
  ) : phase === "stopped" ? (
    <span className="min-w-0 truncate text-faint">{took >= 1000 ? `Stopped after ${duration(took)}` : "Stopped"}</span>
  ) : (
    <span className="min-w-0 truncate text-muted">Finished in {duration(took)}</span>
  );

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
    <div className={runCard}>
      <div className="flex min-w-0 items-center gap-0.5 py-1">
        <button aria-expanded={open} onClick={() => setOpen((v) => !v)} className="group/line flex min-w-0 flex-1 items-center gap-3 py-0.5 text-left outline-none">
          <Avatar agent={s.agent} name={name} state={face} />
          <span className="flex min-w-0 flex-1 items-baseline gap-2 text-[14px]">
            {label && <span className="min-w-0 max-w-[60%] truncate font-medium text-ink-2">{label}</span>}
            {line}
            {running && took > 1500 && <span className="shrink-0 font-mono text-[12px] text-faint tabular-nums">{duration(took)}</span>}
          </span>
          {chevron(open)}
        </button>
        {child && (
          <>
            {sid && phase === "running" && !s.background && took > 4000 && (
              <button aria-label="Keep working in the background" title="Keep working in the background" onClick={() => void useChat.getState().background(sid)} className={rowAction}>
                <SendToBack size={13} />
              </button>
            )}
            {running && (
              <button aria-label={`Stop ${name}`} title={stopping ? "Stopping" : `Stop ${name}`} disabled={stopping} onClick={() => void stop()} className={`${rowAction} hover:!text-danger disabled:opacity-50`}>
                <Square size={10} className="fill-current" />
              </button>
            )}
            <button aria-label={`Open ${label && label !== name ? `${name}'s conversation: ${label}` : `${name}'s conversation`}`} title={`Open ${name}'s conversation`} onClick={() => openSubagent(child, s.agent, s.description)} className={rowAction}>
              <ArrowUpRight size={14} />
            </button>
          </>
        )}
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease }} className="overflow-hidden">
            <div className="ml-[19px] space-y-2.5 border-l border-line py-2 pl-[32px]">
              {s.prompt && (
                <Section title="Brief" actions={<CopyButton text={s.prompt} label="Copy brief" />}>
                  <ProseBox text={s.prompt} />
                </Section>
              )}
              {output && (
                <Section title={phase === "stopped" ? "Partial result" : "Result"} actions={<CopyButton text={output} label="Copy result" />}>
                  <ProseBox text={output} />
                </Section>
              )}
              {phase === "stopped" && <div className="text-[12px] text-faint">{stopped ? `You stopped ${name}. They were told it was you, not a failure.` : "Stopped before it finished."}</div>}
              {phase === "background" && <div className="text-[12px] text-faint">The report lands here when it's done.</div>}
              {error && <ErrorBlock text={error} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

/** A subagent's report with no call in view to fold into (older history paged out, or another chat). The same line, folded the same way. */
export const SubagentReport = memo(function SubagentReport({ msg }: { msg: Extract<UIMessage, { kind: "subagent" }> }) {
  const [open, setOpen] = useState(false);
  const failed = msg.state === "error" || msg.state === "failed";
  const stopped = msg.state === "interrupted" || msg.state === "cancelled";
  const name = useAgentName(msg.agent) || "Subagent";
  const text = msg.text;
  return (
    <div className={runCard}>
      <div className="flex min-w-0 items-center gap-0.5 py-1">
        <button aria-expanded={text ? open : undefined} onClick={() => text && setOpen((v) => !v)} className={`group/line flex min-w-0 flex-1 items-center gap-3 py-0.5 text-left outline-none ${text ? "" : "cursor-default"}`}>
          <Avatar agent={msg.agent} name={name} state={failed ? "failed" : stopped ? "stopped" : "done"} />
          <span className="flex min-w-0 flex-1 items-baseline gap-2 text-[14px]">
            {msg.description?.trim() && <span className="min-w-0 max-w-[60%] truncate font-medium text-ink-2">{msg.description.trim()}</span>}
            <span className={`min-w-0 truncate ${failed ? "text-danger" : stopped ? "text-faint" : "text-muted"}`}>{failed ? "Couldn't finish" : stopped ? "Stopped" : "Finished"}</span>
          </span>
          {text && chevron(open)}
        </button>
        {msg.childID && (
          <button aria-label={`Open ${name}'s conversation`} title={`Open ${name}'s conversation`} onClick={() => openSubagent(msg.childID!, msg.agent, msg.description)} className={rowAction}>
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && text && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease }} className="overflow-hidden">
            <div className="ml-[19px] border-l border-line py-2 pl-[32px]">
              <Section title={failed ? "What went wrong" : stopped ? "Partial result" : "Result"} actions={<CopyButton text={text} label="Copy report" />}>
                <ProseBox text={text} />
              </Section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

const ThoughtRow = memo(function ThoughtRow({ b }: { b: ReasonBlock }) {
  const [open, setOpen] = useState(false);
  const secs = b.ended ? Math.max(1, Math.round((b.ended - b.started) / 1000)) : 0;
  return (
    <div className="relative">
      <TrailNode tone={b.streaming ? "live" : "done"} />
      <button aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-md py-1 text-left text-[14px] hover:bg-hover">
        <span className="grid h-5 w-5 place-items-center text-muted"><Brain size={15} /></span>
        <span className={b.streaming ? "shimmer" : "text-ink-2"}>{b.streaming ? "Thinking" : "Thought"}</span>
        {secs > 0 && <span className="text-faint tabular-nums">{secs}s</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && b.text && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease }} className="overflow-hidden">
            <div className={`selectable mb-2 ml-7 border-l border-line pl-3 text-[13px] leading-relaxed whitespace-pre-wrap text-muted ${b.streaming ? "dither-fade-top flex max-h-[120px] flex-col justify-end overflow-hidden" : ""}`}>
              {b.streaming ? b.text.slice(-600) : b.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
