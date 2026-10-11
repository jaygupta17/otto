import { AnimatePresence, motion } from "motion/react";
import {
  BookOpen,
  Brain,
  ChevronRight,
  FileCode2,
  FilePen,
  FileText,
  Globe,
  ListTodo,
  Search,
  SquareTerminal,
  Users,
  Wrench,
  AlertTriangle,
  Braces,
} from "lucide-react";
import { memo, useState, type ReactNode } from "react";
import { safeJson, summarizeTools, toolCategory, toolLabel, type Block } from "../../lib/opencode/projection";
import { duration } from "../../lib/format";
import { useUI } from "../../state/ui";
import { useChat } from "../../state/chat";
import { AgentClock } from "../ui/AgentClock";
import { CodeBlock } from "./CodeBlock";
import { langFromPath } from "./highlight";

type ToolBlock = Extract<Block, { kind: "tool" }>;
type ReasonBlock = Extract<Block, { kind: "reasoning" }>;

const ease = [0.22, 1, 0.36, 1] as const;

/**
 * A run of tool calls / thoughts between two pieces of prose, shown as one
 * quiet summary line ("Edited 1 file · read 2 files") that expands into a tree.
 */
export const ActivityGroup = memo(function ActivityGroup({ blocks, live }: { blocks: Block[]; live: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? live;
  const running = blocks.some((b) => (b.kind === "tool" && (b.status === "running" || b.status === "streaming")) || (b.kind === "reasoning" && b.streaming));
  const failed = blocks.filter((b) => b.kind === "tool" && b.status === "error").length;

  return (
    <div className="my-1.5">
      <button onClick={() => setUserOpen(!open)} className="group -ml-1 flex max-w-full items-center gap-1.5 rounded-md px-1 py-1 text-[14px] text-muted transition-colors hover:text-ink">
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.18, ease }} className="text-faint group-hover:text-ink">
          <ChevronRight size={15} />
        </motion.span>
        {running && <AgentClock size={12} />}
        <span className="truncate">{summarizeTools(blocks)}</span>
        {failed > 0 && (
          <span className="ml-1 inline-flex items-center gap-1 rounded-md bg-danger-soft px-1.5 py-px text-[12px] font-medium text-danger">
            <AlertTriangle size={11} /> {failed}
          </span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24, ease }} className="overflow-hidden">
            <div className="relative ml-[7px] border-l border-line py-1 pl-4">
              {blocks.map((b) => (b.kind === "tool" ? <ToolRow key={b.key} b={b} /> : b.kind === "reasoning" ? <ThoughtRow key={b.key} b={b} /> : null))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

function iconFor(b: ToolBlock): ReactNode {
  const s = 15;
  switch (toolCategory(b.name)) {
    case "read":
      return <BookOpen size={s} />;
    case "edit":
      return <FilePen size={s} />;
    case "search":
      return <Search size={s} />;
    case "run":
      return <SquareTerminal size={s} />;
    case "web":
      return <Globe size={s} />;
    case "task":
      return <Users size={s} />;
    case "think":
      return <ListTodo size={s} />;
    default:
      return b.name.includes("execute") || b.name.includes("code") ? <Braces size={s} /> : <Wrench size={s} />;
  }
}

function FileChip({ path }: { path: string }) {
  const openInEditor = useUI((s) => s.openInEditor);
  const root = useChat((s) => (s.activeId ? s.sessions[s.activeId]?.location.directory : null) ?? s.homeDir ?? "");
  const open = (p: string) => openInEditor(p.startsWith("/") ? p : `${root.replace(/\/$/, "")}/${p.replace(/^\.\//, "")}`);
  const name = path.split("/").filter(Boolean).pop() ?? path;
  const code = /\.(tsx?|jsx?|rs|go|py|swift|kt|java|c|cpp|cs|rb|php|vue|svelte|css|scss|html|json|toml|ya?ml)$/i.test(name);
  return (
    <span
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          open(path);
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        open(path);
      }}
      className="inline-flex max-w-[260px] items-center gap-1.5 truncate rounded-md border border-line bg-raised px-1.5 py-px text-[13px] text-ink transition-colors hover:border-line-strong"
      title={path}
    >
      {code ? <FileCode2 size={13} className="shrink-0 text-muted" /> : <FileText size={13} className="shrink-0 text-muted" />}
      <span className="truncate">{name}</span>
    </span>
  );
}

const ToolRow = memo(function ToolRow({ b }: { b: ToolBlock }) {
  const [open, setOpen] = useState(false);
  const { verb, target } = toolLabel(b);
  const cat = toolCategory(b.name);
  const isFile = (cat === "read" || cat === "edit") && target;
  const input = b.input ?? safeJson(b.inputText);
  const path = (input?.path ?? input?.filePath ?? input?.file) as string | undefined;
  const active = b.status === "running" || b.status === "streaming";

  return (
    <div className="relative">
      <span className="absolute top-[14px] -left-4 h-px w-3 bg-line" />
      <button onClick={() => setOpen((v) => !v)} className="flex w-full min-w-0 items-center gap-2 rounded-md py-1 pr-2 text-left text-[14px] transition-colors hover:bg-hover">
        <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md ${b.status === "error" ? "text-danger" : "text-muted"}`}>{active ? <AgentClock size={12} /> : iconFor(b)}</span>
        <span className={`shrink-0 ${b.status === "error" ? "text-danger" : "text-ink-2"}`}>{verb}</span>
        {isFile && path ? (
          <FileChip path={path} />
        ) : (
          <span className={`min-w-0 truncate ${cat === "run" ? "font-mono text-[12.5px]" : ""} text-muted`}>{target || (b.status === "streaming" ? "…" : "")}</span>
        )}
        {b.ended && b.ended - b.started > 1500 && <span className="ml-auto shrink-0 pl-2 text-[12px] text-faint tabular-nums">{duration(b.ended - b.started)}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease }} className="overflow-hidden">
            <ToolDetail b={b} input={input} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

function ToolDetail({ b, input }: { b: ToolBlock; input?: Record<string, unknown> }) {
  const cat = toolCategory(b.name);
  const diff = (b.metadata?.diff ?? b.metadata?.patch) as string | undefined;
  const path = (input?.path ?? input?.filePath) as string | undefined;
  const command = (input?.command ?? input?.cmd) as string | undefined;
  const code = (input?.code ?? input?.script) as string | undefined;
  return (
    <div className="mb-2 ml-7 space-y-2">
      {command && <CodeBlock code={command} lang="bash" maxHeight={160} />}
      {code && !command && <CodeBlock code={code} lang={/python/.test(b.name) ? "python" : "typescript"} maxHeight={260} />}
      {!command && !code && cat !== "read" && input && Object.keys(input).length > 0 && !diff && (
        <CodeBlock code={JSON.stringify(input, null, 2)} lang="json" maxHeight={200} />
      )}
      {diff && <CodeBlock code={diff} lang="diff" maxHeight={360} />}
      {!diff && cat === "edit" && typeof input?.content === "string" && <CodeBlock code={input.content as string} lang={path ? langFromPath(path) : "text"} maxHeight={320} />}
      {b.error && <div className="selectable rounded-lg bg-danger-soft px-3 py-2 font-mono text-[12px] whitespace-pre-wrap text-ink">{b.error}</div>}
      {b.output && cat !== "edit" && <CodeBlock code={trimOutput(b.output)} lang={cat === "read" && path ? langFromPath(path) : "text"} maxHeight={300} />}
    </div>
  );
}

function trimOutput(s: string) {
  return s.length > 20_000 ? s.slice(0, 20_000) + "\n… (truncated)" : s;
}

const ThoughtRow = memo(function ThoughtRow({ b }: { b: ReasonBlock }) {
  const [open, setOpen] = useState(false);
  const secs = b.ended ? Math.max(1, Math.round((b.ended - b.started) / 1000)) : 0;
  return (
    <div className="relative">
      <span className="absolute top-[14px] -left-4 h-px w-3 bg-line" />
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-md py-1 text-left text-[14px] hover:bg-hover">
        <span className="grid h-5 w-5 place-items-center text-muted">
          <Brain size={15} />
        </span>
        <span className={b.streaming ? "" : "text-ink-2"}>{b.streaming ? "Thinking" : "Thought process"}</span>
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
