/**
 * Building blocks for tool-call bodies: paths, sections with copy, scroll
 * boxes that fade and follow, output that knows when it's JSON, diffs with
 * line numbers, and an error boundary so one odd result can't take down
 * the chat.
 */
import { Check, ChevronRight, Copy, FileCode2, FileText, Columns2, Rows2, SquareArrowOutUpRight } from "lucide-react";
import { Component, createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { parseDiff, type DiffLine } from "../../lib/opencode/tools";
import { HIGHLIGHT_LIMIT, highlight, langFromPath } from "./highlight";

/** The session a thread shows, so rows resolve paths and find their subagent's reports there. */
export const ThreadSession = createContext<string | null>(null);

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function useSessionRoot() {
  const sid = useContext(ThreadSession);
  return useChat((s) => (sid ? s.sessions[sid]?.location.directory : null) ?? (s.activeId ? s.sessions[s.activeId]?.location.directory : null) ?? s.homeDir ?? "");
}

export function useOpenFile() {
  const openInEditor = useUI((s) => s.openInEditor);
  const root = useSessionRoot();
  return (p: string, line?: number) => openInEditor(absolute(root, p), line);
}

const absolute = (root: string, p: string) => (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) ? p : `${root.replace(/\/$/, "")}/${p.replace(/^\.\//, "")}`);

/** `p` relative to `root` when it's inside it. */
export function relPath(root: string, p: string) {
  const r = root.replace(/\/$/, "");
  return r && p.startsWith(`${r}/`) ? p.slice(r.length + 1) : p;
}

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|rs|go|py|swift|kt|java|c|cc|cpp|h|hpp|cs|rb|php|vue|svelte|astro|css|scss|less|html|json|jsonc|toml|ya?ml|sh|zsh|sql|lua|zig|ex|exs|dart)$/i;

export function FileIcon({ path, size = 13 }: { path: string; size?: number }) {
  return CODE_EXT.test(path) ? <FileCode2 size={size} className="shrink-0 text-muted" /> : <FileText size={size} className="shrink-0 text-muted" />;
}

/**
 * `dir/` + `name`: the name always shows, the directory gives way from its
 * start (RTL truncation keeps the part nearest the file).
 */
export function PathLabel({ path, className = "" }: { path: string; className?: string }) {
  const root = useSessionRoot();
  const shown = relPath(root, path);
  const i = shown.lastIndexOf("/");
  const dir = i > 0 ? shown.slice(0, i) : i === 0 ? "" : "";
  const name = i >= 0 ? shown.slice(i + 1) : shown;
  return (
    <span className={`inline-flex min-w-0 items-baseline overflow-hidden ${className}`} title={path}>
      {i >= 0 && (
        <>
          {/* RTL box, LTR text: the overflow (and ellipsis) falls on the left, keeping the folders nearest the file. */}
          <span className="min-w-0 shrink truncate text-faint" style={{ direction: "rtl", textAlign: "left" }}>
            <span dir="ltr" style={{ unicodeBidi: "embed" }}>
              {dir}
            </span>
          </span>
          <span className="shrink-0 text-faint">/</span>
        </>
      )}
      <span className="shrink-0 text-ink-2">{name}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sections, copy, scroll boxes
// ---------------------------------------------------------------------------

export function CopyButton({ text, label = "Copy" }: { text: string | (() => string); label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={done ? "Copied" : label}
      title={done ? "Copied" : label}
      onClick={(e) => {
        e.stopPropagation();
        void navigator.clipboard.writeText(typeof text === "function" ? text() : text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-ink"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

/** A labelled part of a tool body ("Command", "Output"…) with actions on the right. */
export function Section({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  // No label: the actions sit in the box's corner instead of taking a row.
  if (!title)
    return (
      <div className="group/section relative min-w-0">
        {children}
        {actions && <div className="absolute top-1 right-1 z-10 flex items-center rounded-md bg-sunken/90 opacity-0 transition-opacity group-hover/section:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">{actions}</div>}
      </div>
    );
  return (
    <div className="min-w-0">
      {(title || actions) && (
        <div className="mb-1 flex h-6 min-w-0 items-center gap-1">
          {title && <div className="min-w-0 flex-1 truncate text-[11px] font-medium text-faint">{title}</div>}
          {!title && <div className="flex-1" />}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * A scroll area that fades at the edge with more to see, and (with `follow`)
 * sticks to the bottom as content streams in until the user scrolls up.
 */
export function ScrollBox({ children, maxHeight = 320, follow, className = "" }: { children: ReactNode; maxHeight?: number; follow?: boolean; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  const [fade, setFade] = useState({ top: false, bottom: false });
  const measure = () => {
    const el = box.current;
    if (!el) return;
    const top = el.scrollTop > 4;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
    setFade((f) => (f.top === top && f.bottom === bottom ? f : { top, bottom }));
  };
  useLayoutEffect(() => {
    const el = box.current;
    const c = inner.current;
    if (!el || !c) return;
    if (follow) el.scrollTop = el.scrollHeight;
    measure();
    const ro = new ResizeObserver(() => {
      if (follow && stuck.current) el.scrollTop = el.scrollHeight;
      measure();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [follow]);
  return (
    <div
      ref={box}
      tabIndex={0}
      onScroll={() => {
        const el = box.current!;
        stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        measure();
      }}
      className={`scroll-quiet selectable overflow-auto overscroll-contain rounded-lg bg-sunken outline-none focus-visible:ring-1 focus-visible:ring-line-strong ${fade.top ? "scroll-fade-top" : ""} ${fade.bottom ? "scroll-fade-bottom" : ""} ${className}`}
      style={{ maxHeight }}
    >
      <div ref={inner}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code and output
// ---------------------------------------------------------------------------

/** Highlighted code without chrome (the section around it has the copy button). */
export const Code = memo(function Code({ code, lang, streaming, wrap }: { code: string; lang: string; streaming?: boolean; wrap?: boolean }) {
  const [html, setHtml] = useState<{ for: string; html: string } | null>(null);
  useEffect(() => {
    if (streaming || lang === "text" || code.length > HIGHLIGHT_LIMIT) return;
    let live = true;
    void highlight(code, lang).then((h) => live && h && setHtml({ for: code, html: h }));
    return () => {
      live = false;
    };
  }, [code, lang, streaming]);
  // The surrounding box pads; the bare <pre> shouldn't again.
  const cls = `code-body [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!text-[12px] ${wrap ? "[&_pre]:break-words [&_pre]:whitespace-pre-wrap" : ""}`;
  return html && html.for === code ? <div className={cls} dangerouslySetInnerHTML={{ __html: html.html }} /> : <div className={cls}><pre className="text-ink-2">{code}</pre></div>;
});

const SHOW = 40_000;
const MAX = 1_000_000;

/**
 * Tool output: a JSON viewer when it's JSON, highlighted when a language is
 * known, plain otherwise. Long text shows its head (or, for streaming logs,
 * its tail) with a way to see the rest; past 1 MB it stays cut.
 */
export function OutputView({ text, lang = "text", follow, tail, maxHeight = 320, json }: { text: string; lang?: string; follow?: boolean; tail?: boolean; maxHeight?: number; json?: unknown }) {
  const [all, setAll] = useState(false);
  if (json !== undefined) return <JsonView value={json} raw={text} />;
  const long = text.length > SHOW;
  const limit = all ? MAX : SHOW;
  const shown = text.length <= limit ? text : tail ? text.slice(-limit) : text.slice(0, limit);
  const cut = text.length - shown.length;
  return (
    <>
      <ScrollBox maxHeight={maxHeight} follow={follow}>
        {tail && cut > 0 && <MoreNote cut={cut} all={all} onAll={() => setAll(true)} where="earlier" />}
        <div className="px-3 py-2">
          <Code code={shown} lang={lang} streaming={follow} wrap={lang === "text"} />
        </div>
        {!tail && cut > 0 && <MoreNote cut={cut} all={all} onAll={() => setAll(true)} where="more" />}
      </ScrollBox>
      {long && all && text.length > MAX && <div className="mt-1 text-[11px] text-faint">Output past 1 MB isn't shown.</div>}
    </>
  );
}

function MoreNote({ cut, all, onAll, where }: { cut: number; all: boolean; onAll: () => void; where: "earlier" | "more" }) {
  const size = cut > 1024 * 1024 ? `${(cut / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(cut / 1024)} KB`;
  return (
    <div className="px-3 pt-2 text-[11px] text-faint">
      {all ? `${size} ${where === "earlier" ? "earlier" : "more"} not shown` : (
        <button className="hover:text-ink hover:underline" onClick={onAll}>
          {where === "earlier" ? `Show ${size} of earlier output` : `Show ${size} more`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

type JsonTab = "summary" | "tree" | "raw";

/** JSON results three ways: what's in it, a browsable tree, or the text. */
export function JsonView({ value, raw }: { value: unknown; raw: string }) {
  const [tab, setTab] = useState<JsonTab>("summary");
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return raw;
    }
  }, [value, raw]);
  return (
    <div className="min-w-0">
      <div role="tablist" aria-label="JSON view" className="mb-1 flex items-center gap-0.5">
        {(["summary", "tree", "raw"] as JsonTab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-2 py-0.5 text-[11px] capitalize transition-colors ${tab === t ? "bg-active text-ink" : "text-faint hover:text-ink"}`}
          >
            {t}
          </button>
        ))}
        <div className="flex-1" />
        <CopyButton text={pretty} label="Copy JSON" />
      </div>
      <ScrollBox maxHeight={340}>
        <div className="px-3 py-2 font-mono text-[12px] leading-relaxed">
          {tab === "summary" ? <JsonSummary value={value} /> : tab === "tree" ? <JsonNode value={value} open depth={0} /> : <Code code={pretty.length > MAX ? pretty.slice(0, MAX) : pretty} lang="json" />}
        </div>
      </ScrollBox>
    </div>
  );
}

const typeOf = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? `array · ${v.length}` : typeof v === "object" ? `object · ${Object.keys(v as object).length}` : typeof v);

function preview(v: unknown, n = 80): string {
  if (typeof v === "string") return JSON.stringify(v.length > n ? `${v.slice(0, n)}…` : v);
  if (v === null || typeof v !== "object") return String(v);
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? "" : "s"}]`;
  const keys = Object.keys(v as object);
  return `{ ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} }`;
}

function JsonSummary({ value }: { value: unknown }) {
  const rows: [string, unknown][] = Array.isArray(value)
    ? value.slice(0, 30).map((v, i) => [String(i), v])
    : value && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).slice(0, 40)
      : [["value", value]];
  const total = Array.isArray(value) ? value.length : value && typeof value === "object" ? Object.keys(value).length : 1;
  return (
    <div className="font-sans">
      <div className="mb-1.5 text-[12px] text-faint">{Array.isArray(value) ? `Array of ${total} item${total === 1 ? "" : "s"}` : value && typeof value === "object" ? `Object with ${total} field${total === 1 ? "" : "s"}` : typeOf(value)}</div>
      <dl className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate font-mono text-faint">{k}</dt>
            <dd className="min-w-0 truncate font-mono text-ink-2" title={typeof v === "string" ? v : undefined}>
              {preview(v)}
            </dd>
          </div>
        ))}
      </dl>
      {total > rows.length && <div className="mt-1 text-[12px] text-faint">+{total - rows.length} more</div>}
    </div>
  );
}

function JsonNode({ k, value, open, depth }: { k?: string; value: unknown; open?: boolean; depth: number }) {
  const label = k !== undefined && <span className="text-ink-2">{k}: </span>;
  if (value === null || typeof value !== "object") {
    const color = typeof value === "string" ? "text-ok" : typeof value === "number" ? "text-info" : "text-muted";
    return (
      <div className="break-all">
        {label}
        <span className={color}>{typeof value === "string" ? JSON.stringify(value) : String(value)}</span>
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value as Record<string, unknown>);
  return (
    <details open={open || depth < 1} className="group/json">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded hover:bg-hover [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} className="shrink-0 text-faint transition-transform group-open/json:rotate-90" />
        {label}
        <span className="text-faint">{typeOf(value)}</span>
      </summary>
      <div className="ml-[5px] border-l border-line pl-3">
        {entries.slice(0, 200).map(([ck, v]) => (
          <JsonNode key={ck} k={ck} value={v} depth={depth + 1} />
        ))}
        {entries.length > 200 && <div className="text-faint">+{entries.length - 200} more</div>}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------

const DIFF_ROWS = 1500;

/** A unified diff with old/new line numbers, unified or side by side. */
export const DiffView = memo(function DiffView({ patch, lines: given, split, onLine }: { patch?: string; lines?: DiffLine[]; split?: boolean; onLine?: (line: number) => void }) {
  const parsed = useMemo(() => given ?? parseDiff(patch ?? ""), [patch, given]);
  const [all, setAll] = useState(false);
  const rows = all ? parsed : parsed.slice(0, DIFF_ROWS);
  if (!parsed.length) return <div className="px-3 py-2 text-[12px] text-faint">No textual changes</div>;
  return (
    <ScrollBox maxHeight={420}>
      <div className="min-w-max py-1 font-mono text-[12px] leading-[1.55]">{split ? <SplitRows rows={rows} onLine={onLine} /> : <UnifiedRows rows={rows} onLine={onLine} />}</div>
      {parsed.length > rows.length && (
        <button className="px-3 pb-2 text-[11px] text-faint hover:text-ink hover:underline" onClick={() => setAll(true)}>
          Show {parsed.length - rows.length} more lines
        </button>
      )}
    </ScrollBox>
  );
});

function Gutter({ n, onLine }: { n?: number; onLine?: (line: number) => void }) {
  return (
    <span
      className={`inline-block w-[3.2em] shrink-0 pr-2 text-right text-faint select-none ${n && onLine ? "cursor-pointer hover:text-ink" : ""}`}
      onClick={n && onLine ? () => onLine(n) : undefined}
    >
      {n ?? ""}
    </span>
  );
}

function UnifiedRows({ rows, onLine }: { rows: DiffLine[]; onLine?: (line: number) => void }) {
  return (
    <>
      {rows.map((l, i) =>
        l.t === "hunk" ? (
          <div key={i} className="px-3 py-0.5 text-[11px] text-faint">
            {i > 0 && "⋯ "}
            {l.text}
          </div>
        ) : (
          <div key={i} className={`flex pr-3 ${l.t === "add" ? "diff-add" : l.t === "del" ? "diff-del" : ""}`}>
            <Gutter n={l.a} />
            <Gutter n={l.b} onLine={onLine} />
            <span className="diff-sign w-4 shrink-0 text-faint select-none">{l.t === "add" ? "+" : l.t === "del" ? "−" : " "}</span>
            <span className="whitespace-pre text-ink-2">{l.text || " "}</span>
          </div>
        ),
      )}
    </>
  );
}

/** Deletions on the left, additions on the right, paired within each change. */
function SplitRows({ rows, onLine }: { rows: DiffLine[]; onLine?: (line: number) => void }) {
  const pairs: { l?: DiffLine; r?: DiffLine; hunk?: string }[] = [];
  for (let i = 0; i < rows.length; ) {
    const l = rows[i];
    if (l.t === "hunk") {
      pairs.push({ hunk: l.text });
      i++;
    } else if (l.t === "ctx") {
      pairs.push({ l, r: l });
      i++;
    } else {
      const dels: DiffLine[] = [];
      const adds: DiffLine[] = [];
      while (i < rows.length && rows[i].t === "del") dels.push(rows[i++]);
      while (i < rows.length && rows[i].t === "add") adds.push(rows[i++]);
      for (let j = 0; j < Math.max(dels.length, adds.length); j++) pairs.push({ l: dels[j], r: adds[j] });
    }
  }
  const cell = (d: DiffLine | undefined, side: "l" | "r") => (
    <div className={`flex min-w-0 flex-1 pr-3 ${d?.t === "add" ? "diff-add" : d?.t === "del" ? "diff-del" : d ? "" : "bg-sunken"}`}>
      <Gutter n={side === "l" ? d?.a : d?.b} onLine={side === "r" ? onLine : undefined} />
      <span className="whitespace-pre text-ink-2">{d ? d.text || " " : ""}</span>
    </div>
  );
  return (
    <>
      {pairs.map((p, i) =>
        p.hunk !== undefined ? (
          <div key={i} className="px-3 py-0.5 text-[11px] text-faint">
            {i > 0 && "⋯ "}
            {p.hunk}
          </div>
        ) : (
          <div key={i} className="flex">
            {cell(p.l, "l")}
            <div className="w-px shrink-0 bg-line" />
            {cell(p.r, "r")}
          </div>
        ),
      )}
    </>
  );
}

/** Remembered unified / split choice for diffs. */
const splitPref = { value: false, subs: new Set<(v: boolean) => void>() };
try {
  splitPref.value = localStorage.getItem("otto.diffSplit") === "1";
} catch {
  /* storage blocked */
}
export function useSplitDiff(): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(splitPref.value);
  useEffect(() => {
    splitPref.subs.add(setV);
    return () => void splitPref.subs.delete(setV);
  }, []);
  return [
    v,
    (next) => {
      splitPref.value = next;
      try {
        localStorage.setItem("otto.diffSplit", next ? "1" : "0");
      } catch {
        /* storage blocked */
      }
      for (const s of splitPref.subs) s(next);
    },
  ];
}

export function SplitToggle() {
  const [split, setSplit] = useSplitDiff();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setSplit(!split);
      }}
      aria-label={split ? "Show diff as one column" : "Show diff side by side"}
      title={split ? "One column" : "Side by side"}
      className="hidden h-6 w-6 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink sm:grid"
    >
      {split ? <Rows2 size={12} /> : <Columns2 size={12} />}
    </button>
  );
}

export function OpenButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink"
    >
      <SquareArrowOutUpRight size={12} />
    </button>
  );
}

export const langOf = (path?: string) => (path ? langFromPath(path) : "text");

// ---------------------------------------------------------------------------
// Error boundary
// ---------------------------------------------------------------------------

/** One tool that renders badly shows a note instead of blanking the conversation. */
export class ToolBoundary extends Component<{ children: ReactNode; name: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn(`[otto] couldn't render ${this.props.name}`, e);
  }
  render() {
    if (this.state.failed) return <div className="rounded-lg bg-sunken px-3 py-2 text-[12px] text-faint">Couldn't show the details of this {this.props.name} call.</div>;
    return this.props.children;
  }
}
