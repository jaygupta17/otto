/**
 * What a tool call did, shaped per tool: the command and its output, the
 * diff per file with line numbers and errors, the hits of a search grouped
 * by file, the answers to a question. Arguments are only ever shown as
 * labelled fields, for tools we don't know.
 */
import { AlertTriangle, Bookmark, Check, Circle, CircleDot, CircleX, ExternalLink, FileWarning } from "lucide-react";
import { memo, useMemo, useState } from "react";
import {
  asJson,
  diagnosticsFor,
  executeCalls,
  executeTruncation,
  fileDiffs,
  firstChangedLine,
  inputOf,
  inputPath,
  memoryCallText,
  memoryCalls,
  normalizeToolName,
  type MemoryCall,
  patchFiles,
  questionAnswers,
  questionsOf,
  toolKind,
  webHits,
  type DiffLine,
  type FileDiff,
  type ToolBlock,
} from "../../lib/opencode/tools";
import { AgentClock } from "../ui/AgentClock";
import { Markdown } from "./Markdown";
import { useMemory } from "../../state/memory";
import { useTeammates } from "../../state/teammates";
import type { Teammate } from "../../lib/teammates";
import { AgentMark } from "../ui/TeammateFace";
import { Code, CopyButton, DiffView, FileIcon, OpenButton, OutputView, PathLabel, ScrollBox, Section, SplitToggle, langOf, useOpenFile, useSplitDiff } from "./ToolParts";

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const nonEmpty = (s?: string) => (s && s.trim() ? s : undefined);

export const ToolBody = memo(function ToolBody({ b }: { b: ToolBlock }) {
  const input = inputOf(b);
  return (
    <div className="space-y-2.5">
      <KindBody b={b} input={input} />
      {b.error && <ErrorBlock text={b.error} />}
    </div>
  );
});

function KindBody({ b, input }: { b: ToolBlock; input: Json }) {
  const mem = memoryCalls(b);
  if (mem) return <MemoryBody b={b} input={input} calls={mem} />;
  switch (toolKind(b.name)) {
    case "shell":
      return <ShellBody b={b} input={input} />;
    case "read":
      return <ReadBody b={b} input={input} />;
    case "edit":
    case "patch":
    case "write":
      return <EditBody b={b} input={input} />;
    case "grep":
      return <GrepBody b={b} />;
    case "glob":
      return <GlobBody b={b} />;
    case "webfetch":
      return <FetchBody b={b} input={input} />;
    case "websearch":
      return <SearchBody b={b} />;
    case "question":
      return <QuestionBody b={b} input={input} />;
    case "skill":
      return <SkillBody b={b} input={input} />;
    case "execute":
      return <ExecuteBody b={b} input={input} />;
    case "todo":
      return <TodoBody input={input} />;
    default:
      return <GenericBody b={b} input={input} />;
  }
}

export function ErrorBlock({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2">
      <AlertTriangle size={13} className="mt-0.5 shrink-0 text-danger" />
      <div className="selectable min-w-0 flex-1 font-mono text-[12px] break-words whitespace-pre-wrap text-ink">{text.length > 8000 ? `${text.slice(0, 8000)}…` : text}</div>
      <CopyButton text={text} label="Copy error" />
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <div className="text-[12px] text-faint">{children}</div>;
const live = (b: ToolBlock) => b.status === "running" || b.status === "streaming";

// ---------------------------------------------------------------------------
// shell
// ---------------------------------------------------------------------------

function ShellBody({ b, input }: { b: ToolBlock; input: Json }) {
  const md = b.metadata ?? {};
  const command = str(input.command) ?? str(input.cmd);
  // Output streams into metadata while the command runs; the final text lands in `output`.
  const out = nonEmpty(b.output) ?? nonEmpty(str(md.output));
  const exit = typeof md.exit === "number" ? md.exit : typeof md.exitCode === "number" ? md.exitCode : undefined;
  const running = live(b);
  const desc = str(input.description);
  const cwd = str(input.workdir) ?? str(input.cwd);
  return (
    <>
      {command && (
        <Section title={desc && desc !== command ? desc : "Command"} actions={<CopyButton text={command} label="Copy command" />}>
          <ScrollBox maxHeight={160}>
            <div className="px-3 py-2">
              {cwd && <div className="mb-1 font-mono text-[11px] text-faint"><PathLabel path={cwd} /></div>}
              <Code code={`$ ${command}`} lang="bash" streaming={b.status === "streaming"} wrap />
            </div>
          </ScrollBox>
        </Section>
      )}
      {out ? (
        <Section
          title={
            <span className="flex items-center gap-1.5">
              Output
              {running && <AgentClock size={10} />}
              {exit !== undefined && exit !== 0 && <span className="font-mono text-danger">exit {exit}</span>}
            </span>
          }
          actions={<CopyButton text={out} label="Copy output" />}
        >
          <OutputView text={stripAnsi(out)} follow={running} tail />
        </Section>
      ) : b.status === "completed" ? (
        <Empty>{exit !== undefined && exit !== 0 ? `No output · exit ${exit}` : "No output"}</Empty>
      ) : running && command ? (
        <Empty>Running…</Empty>
      ) : null}
    </>
  );
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");

// ---------------------------------------------------------------------------
// read
// ---------------------------------------------------------------------------

/** `read` wraps the text in `<file>` / `<content>` and numbers each line (`00012| …`). */
function cleanRead(out: string): { text: string; first?: number } {
  let t = out.replace(/^\s*<(file|content|path)[^>]*>\n?/, "").replace(/\n?<\/(file|content)>[\s\S]*$/, "");
  const lines = t.split("\n");
  const numbered = lines.filter((l) => /^\s*\d+[|:\t]\s?/.test(l)).length;
  let first: number | undefined;
  if (numbered >= Math.max(1, lines.length * 0.6)) {
    t = lines
      .map((l) => {
        const m = /^\s*(\d+)[|:\t]\s?(.*)$/.exec(l);
        if (m && first === undefined) first = Number(m[1]);
        return m ? m[2] : l;
      })
      .join("\n");
  }
  // "(End of file - total N lines)" trailers.
  t = t.replace(/\n*\((End of file|File has more lines)[^)]*\)\s*$/, "");
  return { text: t, first };
}

function ReadBody({ b, input }: { b: ToolBlock; input: Json }) {
  const path = inputPath(input) ?? str(input.uri);
  const open = useOpenFile();
  const offset = typeof input.offset === "number" ? input.offset : undefined;
  const limit = typeof input.limit === "number" ? input.limit : undefined;
  const out = nonEmpty(b.output);
  const clean = useMemo(() => (out ? cleanRead(out) : null), [out]);
  const from = clean?.first ?? offset;
  return (
    <>
      {path && (
        <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
          <FileIcon path={path} />
          <PathLabel path={path} className="font-mono text-[12px]" />
          {(offset || limit) && (
            <span className="shrink-0 text-faint">
              · {offset ? `from line ${offset}` : "from the start"}
              {limit ? `, ${limit} lines` : ""}
            </span>
          )}
          <div className="flex-1" />
          <OpenButton label="Open file" onClick={() => open(path, from)} />
        </div>
      )}
      {clean?.text ? (
        <Section actions={<CopyButton text={clean.text} label="Copy contents" />}>
          <OutputView text={clean.text} lang={langOf(path)} />
        </Section>
      ) : b.status === "completed" && !b.files?.length ? (
        <Empty>Empty file</Empty>
      ) : null}
      <Attachments b={b} />
    </>
  );
}

// ---------------------------------------------------------------------------
// edit / patch / write
// ---------------------------------------------------------------------------

function EditBody({ b, input }: { b: ToolBlock; input: Json }) {
  const kind = toolKind(b.name);
  const diffs = fileDiffs(b.metadata);
  const path = inputPath(input);
  if (diffs.length) return <>{diffs.map((f) => <FileEntry key={f.file} f={f} b={b} />)}</>;

  // No reported diff (still running, older server, or it failed): build the best one the input allows.
  const legacy = str(b.metadata?.diff) ?? str(b.metadata?.patch);
  if (legacy) return <FileEntry f={{ file: path ?? "", patch: legacy }} b={b} />;
  if (kind === "write" && typeof input.content === "string") {
    const lines: DiffLine[] = input.content.split("\n").map((text, i) => ({ t: "add", text, b: i + 1 }));
    if (lines.at(-1)?.text === "") lines.pop();
    return <FileEntry f={{ file: path ?? "", additions: lines.length, deletions: 0, status: "added" }} lines={lines} b={b} />;
  }
  const oldS = typeof (input.oldString ?? input.old_string) === "string" ? String(input.oldString ?? input.old_string) : undefined;
  const newS = typeof (input.newString ?? input.new_string) === "string" ? String(input.newString ?? input.new_string) : undefined;
  if (oldS !== undefined || newS !== undefined) {
    const lines: DiffLine[] = [...(oldS ? oldS.split("\n").map((text) => ({ t: "del" as const, text })) : []), ...(newS ? newS.split("\n").map((text) => ({ t: "add" as const, text })) : [])];
    return <FileEntry f={{ file: path ?? "" }} lines={lines} b={b} />;
  }
  if (kind === "patch") {
    const files = patchFiles(input);
    const text = str(input.patchText) ?? str(input.patch);
    return (
      <>
        {files.length > 0 && (
          <ul className="space-y-0.5 text-[12px]">
            {files.map((f) => (
              <li key={f.file} className="flex min-w-0 items-center gap-1.5">
                <FileIcon path={f.file} />
                <PathLabel path={f.file} className="font-mono text-[12px]" />
                <span className={`shrink-0 text-[11px] ${f.op === "add" ? "text-ok" : f.op === "delete" ? "text-danger" : "text-faint"}`}>{f.op === "add" ? "new" : f.op === "delete" ? "deleted" : "update"}</span>
              </li>
            ))}
          </ul>
        )}
        {text && (
          <Section title="Patch" actions={<CopyButton text={text} label="Copy patch" />}>
            <OutputView text={text} lang="diff" follow={b.status === "streaming"} tail={b.status === "streaming"} />
          </Section>
        )}
      </>
    );
  }
  return nonEmpty(b.output) ? <div className="text-[12px] text-muted">{b.output}</div> : null;
}

/** One file of an edit: its header (open at the first change), its diff, and any errors it now has. */
function FileEntry({ f, lines, b }: { f: FileDiff; lines?: DiffLine[]; b: ToolBlock }) {
  const open = useOpenFile();
  const [split] = useSplitDiff();
  const first = lines ? lines.find((l) => l.t !== "ctx" && l.t !== "hunk")?.b : firstChangedLine(f.patch);
  const diag = diagnosticsFor(b.metadata, f.file);
  const copy = f.patch ?? lines?.map((l) => (l.t === "add" ? "+" : l.t === "del" ? "-" : " ") + l.text).join("\n") ?? "";
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-line">
      <div className="flex h-8 min-w-0 items-center gap-1.5 border-b border-line bg-raised pr-1 pl-2.5 text-[12px]">
        {f.file && <FileIcon path={f.file} />}
        {f.file ? <PathLabel path={f.file} className="font-mono text-[12px]" /> : <span className="text-faint">Changes</span>}
        {f.status === "added" && <span className="shrink-0 text-[11px] text-ok">new</span>}
        {f.status === "deleted" && <span className="shrink-0 text-[11px] text-danger">deleted</span>}
        {(f.additions || f.deletions) ? (
          <span className="shrink-0 font-mono text-[11px] tabular-nums">
            {f.additions ? <span className="text-ok">+{f.additions}</span> : null}
            {f.additions && f.deletions ? " " : null}
            {f.deletions ? <span className="text-danger">−{f.deletions}</span> : null}
          </span>
        ) : null}
        {diag && (
          <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-danger" title="Errors after this edit">
            <FileWarning size={11} /> {diag.items.length + diag.more}
          </span>
        )}
        <div className="flex-1" />
        <SplitToggle />
        {copy && <CopyButton text={copy} label="Copy diff" />}
        {f.file && f.status !== "deleted" && <OpenButton label="Open file at the change" onClick={() => open(f.file, first)} />}
      </div>
      <div className="[&>div]:rounded-none">
        {f.patch || lines ? (
          <DiffView patch={f.patch} lines={lines} split={split} onLine={f.file && f.status !== "deleted" ? (n) => open(f.file, n) : undefined} />
        ) : (
          <div className="px-3 py-2 text-[12px] text-faint">{f.status === "deleted" ? "File removed" : "No textual changes"}</div>
        )}
      </div>
      {diag && <Diagnostics path={f.file} items={diag.items} more={diag.more} />}
    </div>
  );
}

function Diagnostics({ path, items, more }: { path: string; items: { message: string; line: number; character: number }[]; more: number }) {
  const open = useOpenFile();
  return (
    <ul className="space-y-0.5 border-t border-line bg-danger-soft/40 px-2.5 py-1.5 text-[12px]">
      {items.map((d, i) => (
        <li key={i}>
          <button className="flex w-full min-w-0 items-start gap-1.5 rounded text-left hover:bg-hover" onClick={() => open(path, d.line)}>
            <CircleX size={12} className="mt-0.5 shrink-0 text-danger" />
            <span className="shrink-0 font-mono text-faint tabular-nums">
              {d.line}:{d.character}
            </span>
            <span className="min-w-0 break-words text-ink-2">{d.message}</span>
          </button>
        </li>
      ))}
      {more > 0 && <li className="pl-5 text-faint">+{more} more</li>}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// grep / glob
// ---------------------------------------------------------------------------

type GrepGroup = { file: string; hits: { line?: number; text: string }[] };

/** grep output: `path:line: text` (or a `path` header then `  Line N: text`), grouped by file. */
function grepGroups(out: string): { groups: GrepGroup[]; other: string[] } {
  const groups: GrepGroup[] = [];
  const other: string[] = [];
  let cur: GrepGroup | null = null;
  const at = (file: string) => {
    if (cur?.file === file) return cur;
    cur = groups.find((g) => g.file === file) ?? null;
    if (!cur) groups.push((cur = { file, hits: [] }));
    return cur;
  };
  for (const raw of out.split("\n")) {
    const l = raw.replace(/\s+$/, "");
    if (!l.trim()) continue;
    const inline = /^((?:[A-Za-z]:)?[^\s:][^:]*?\.[\w]+|\/[^:]+):(\d+):\s?(.*)$/.exec(l);
    if (inline) {
      at(inline[1]).hits.push({ line: Number(inline[2]), text: inline[3] });
      continue;
    }
    const lineOf = /^\s+Line (\d+):\s?(.*)$/.exec(l);
    if (lineOf && cur) {
      (cur as GrepGroup).hits.push({ line: Number(lineOf[1]), text: lineOf[2] });
      continue;
    }
    const header = /^((?:\/|\.\/|[\w@.-]+\/)\S*?)(:)?$/.exec(l);
    if (header && !/^Found \d+/.test(l)) {
      at(header[1]);
      continue;
    }
    if (/^(Found \d+ match|No files found|\(Results are truncated)/.test(l)) continue;
    other.push(l);
  }
  return { groups, other };
}

function GrepBody({ b }: { b: ToolBlock }) {
  const out = nonEmpty(b.output);
  const open = useOpenFile();
  const [all, setAll] = useState(false);
  const parsed = useMemo(() => (out ? grepGroups(out) : null), [out]);
  if (!out) return b.status === "completed" ? <Empty>No matches</Empty> : null;
  // MCP search tools land here too, often answering in JSON.
  if (!parsed?.groups.length) return <OutputView text={out} json={asJson(out)} />;
  const groups = all ? parsed.groups : parsed.groups.slice(0, 25);
  const truncated = /Results are truncated/.test(out);
  return (
    <Section actions={<CopyButton text={out} label="Copy results" />}>
      <ScrollBox maxHeight={340}>
        <div className="space-y-1.5 px-2 py-1.5 text-[12px]">
          {groups.map((g) => (
            <div key={g.file} className="min-w-0">
              <button className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-hover" onClick={() => open(g.file, g.hits[0]?.line)}>
                <FileIcon path={g.file} size={12} />
                <PathLabel path={g.file} className="font-mono" />
                {g.hits.length > 0 && <span className="shrink-0 text-faint">{g.hits.length}</span>}
              </button>
              {g.hits.slice(0, 30).map((h, i) => (
                <button key={i} className="flex w-full min-w-0 items-baseline gap-2 rounded py-px pr-1 pl-6 text-left font-mono hover:bg-hover" onClick={() => open(g.file, h.line)}>
                  {h.line !== undefined && <span className="w-[3em] shrink-0 text-right text-faint tabular-nums">{h.line}</span>}
                  <span className="min-w-0 truncate text-ink-2">{h.text.trim()}</span>
                </button>
              ))}
              {g.hits.length > 30 && <div className="pl-6 text-faint">+{g.hits.length - 30} more in this file</div>}
            </div>
          ))}
          {parsed.groups.length > groups.length && (
            <button className="px-1 text-faint hover:text-ink hover:underline" onClick={() => setAll(true)}>
              Show {parsed.groups.length - groups.length} more files
            </button>
          )}
          {truncated && <div className="px-1 text-faint">Results were cut short by the tool.</div>}
        </div>
      </ScrollBox>
    </Section>
  );
}

function GlobBody({ b }: { b: ToolBlock }) {
  const out = nonEmpty(b.output);
  const open = useOpenFile();
  const [all, setAll] = useState(false);
  if (!out) return b.status === "completed" ? <Empty>No files found</Empty> : null;
  const lines = out.split("\n").map((l) => l.trim()).filter((l) => l && !/^(No files found|\(Results are truncated)/.test(l));
  if (!lines.length) return <Empty>No files found</Empty>;
  const shown = all ? lines : lines.slice(0, 100);
  return (
    <Section title={`${lines.length} path${lines.length === 1 ? "" : "s"}`} actions={<CopyButton text={lines.join("\n")} label="Copy paths" />}>
      <ScrollBox maxHeight={300}>
        <ul className="px-2 py-1.5 text-[12px]">
          {shown.map((p) => (
            <li key={p}>
              <button className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-px text-left font-mono hover:bg-hover" onClick={() => open(p)}>
                <FileIcon path={p} size={12} />
                <PathLabel path={p} />
              </button>
            </li>
          ))}
          {lines.length > shown.length && (
            <li>
              <button className="px-1 text-faint hover:text-ink hover:underline" onClick={() => setAll(true)}>
                Show {lines.length - shown.length} more
              </button>
            </li>
          )}
        </ul>
      </ScrollBox>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// web
// ---------------------------------------------------------------------------

function FetchBody({ b, input }: { b: ToolBlock; input: Json }) {
  const url = str(input.url);
  const out = nonEmpty(b.output);
  const html = input.format === "html";
  return (
    <>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="flex max-w-full min-w-0 items-center gap-1.5 text-[12px] text-info hover:underline">
          <ExternalLink size={12} className="shrink-0" />
          <span className="truncate">{url}</span>
        </a>
      )}
      {out && (
        <Section title={html ? "HTML" : "Page"} actions={<CopyButton text={out} label="Copy page" />}>
          {html ? <OutputView text={out} lang="html" /> : <ProseBox text={out} />}
        </Section>
      )}
      <Attachments b={b} />
    </>
  );
}

function SearchBody({ b }: { b: ToolBlock }) {
  const out = nonEmpty(b.output);
  const hits = useMemo(() => webHits(out), [out]);
  if (!out) return b.status === "completed" ? <Empty>No results</Empty> : null;
  if (!hits.length) return <ProseBox text={out} />;
  return (
    <ScrollBox maxHeight={380}>
      <ol className="divide-y divide-line">
        {hits.map((h, i) => {
          let host = h.url;
          try {
            host = new URL(h.url).host.replace(/^www\./, "");
          } catch {
            /* keep */
          }
          return (
            <li key={i} className="px-3 py-2">
              <a href={h.url} target="_blank" rel="noreferrer" className="group block min-w-0">
                <div className="truncate text-[13px] text-ink group-hover:underline">{h.title || host}</div>
                <div className="truncate text-[11px] text-faint">
                  {host}
                  {h.published && ` · ${h.published}`}
                </div>
              </a>
              {h.snippet && <div className="selectable mt-1 line-clamp-3 text-[12px] text-muted">{h.snippet.replace(/\s+/g, " ")}</div>}
            </li>
          );
        })}
      </ol>
    </ScrollBox>
  );
}

/** Prose results (pages, skills): markdown, clipped with a way to read it all. */
export function ProseBox({ text }: { text: string }) {
  const [all, setAll] = useState(false);
  const long = text.length > 2400;
  const body = all ? (text.length > 120_000 ? `${text.slice(0, 120_000)}…` : text) : long ? `${text.slice(0, 2400)}…` : text;
  return (
    <ScrollBox maxHeight={all ? 480 : 300}>
      <div className="selectable px-3 py-2 text-[13px] text-ink-2">
        <Markdown text={body} />
        {long && (
          <button className="mt-1 text-[12px] text-faint hover:text-ink hover:underline" onClick={() => setAll((v) => !v)}>
            {all ? "Show less" : "Show all"}
          </button>
        )}
      </div>
    </ScrollBox>
  );
}

// ---------------------------------------------------------------------------
// question / skill / execute / todo
// ---------------------------------------------------------------------------

function QuestionBody({ b, input }: { b: ToolBlock; input: Json }) {
  const qs = questionsOf(input);
  const answers = questionAnswers(b.output);
  const answerFor = (q: string, i: number) => answers.find((a) => a.question === q)?.answer ?? answers[i]?.answer;
  const pending = live(b);
  return (
    <div className="space-y-1.5">
      {qs.map((q, i) => {
        const ans = answerFor(q.question, i);
        const picked = ans ? ans.split(/,\s*/) : [];
        return (
          <div key={i} className="rounded-lg bg-sunken px-3 py-2">
            {q.header && <div className="text-[12px] font-medium text-muted">{q.header}</div>}
            <div className="selectable text-[13px] text-ink">{q.question}</div>
            {q.options.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {q.options.map((o) => {
                  const on = picked.includes(o) || ans === o;
                  return (
                    <span key={o} className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[12px] ${on ? "border-accent/50 bg-accent-soft text-ink" : "border-line text-muted"}`}>
                      {on && <Check size={11} />}
                      {o}
                    </span>
                  );
                })}
              </div>
            )}
            {ans && !q.options.includes(ans) && !picked.every((p) => q.options.includes(p)) && (
              <div className="selectable mt-1.5 border-l-2 border-line-strong pl-2 text-[13px] text-ink-2">{ans}</div>
            )}
            {!ans && <div className="mt-1 text-[12px] text-faint">{pending ? "Waiting for your answer…" : b.status === "error" ? "Not answered" : "No answer"}</div>}
          </div>
        );
      })}
      {!qs.length && nonEmpty(b.output) && <div className="selectable text-[13px] whitespace-pre-wrap text-ink-2">{b.output}</div>}
    </div>
  );
}

function SkillBody({ b, input }: { b: ToolBlock; input: Json }) {
  const md = b.metadata ?? {};
  const name = str(md.name) ?? str(input.name) ?? str(input.id);
  const dir = str(md.dir) ?? str(md.directory);
  const open = useOpenFile();
  const out = nonEmpty(b.output);
  return (
    <>
      {(name || dir) && (
        <div className="flex min-w-0 items-center gap-1.5 text-[12px]">
          {name && <span className="shrink-0 font-medium text-ink-2">{name}</span>}
          {dir && <PathLabel path={dir} className="font-mono text-[12px]" />}
          <div className="flex-1" />
          {dir && <OpenButton label="Open SKILL.md" onClick={() => open(`${dir.replace(/\/$/, "")}/SKILL.md`)} />}
        </div>
      )}
      {out && <ProseBox text={out.replace(/^\s*<skill_content[^>]*>\n?|\n?<\/skill_content>\s*$/g, "")} />}
    </>
  );
}

function ExecuteBody({ b, input }: { b: ToolBlock; input: Json }) {
  const md = b.metadata ?? {};
  const calls = executeCalls(md);
  const code = str(input.code) ?? str(input.script);
  const out = nonEmpty(b.output);
  const cut = executeTruncation(md);
  const open = useOpenFile();
  const lang = /python/i.test(String(input.language ?? "")) ? "python" : "typescript";
  return (
    <>
      {code && (
        <Section title="Script" actions={<CopyButton text={code} label="Copy script" />}>
          <ScrollBox maxHeight={240}>
            <div className="px-3 py-2">
              <Code code={code} lang={lang} streaming={b.status === "streaming"} />
            </div>
          </ScrollBox>
        </Section>
      )}
      {calls.length > 0 && (
        <Section title={`Called ${calls.length} tool${calls.length === 1 ? "" : "s"}`}>
          <ScrollBox maxHeight={200}>
            <ul className="space-y-0.5 px-3 py-2 text-[12px]">
              {calls.map((c, i) => (
                <li key={i} className="flex min-w-0 items-center gap-2">
                  <StatusDot status={c.status} />
                  <span className="shrink-0 text-ink-2">{normalizeToolName(c.tool)}</span>
                  {c.input && <span className="min-w-0 truncate font-mono text-[11px] text-faint">{c.input}</span>}
                </li>
              ))}
            </ul>
          </ScrollBox>
        </Section>
      )}
      {out && (
        <Section title="Result" actions={<CopyButton text={out} label="Copy result" />}>
          <OutputView text={out} json={asJson(out)} follow={live(b)} />
        </Section>
      )}
      {cut && (
        <div className="flex items-center gap-1.5 text-[12px] text-faint">
          Output was cut short.
          {cut.path && (
            <button className="text-muted hover:text-ink hover:underline" onClick={() => open(cut.path!)}>
              Open the full output
            </button>
          )}
        </div>
      )}
    </>
  );
}

const MEMORY_ACTION: Record<string, string> = {
  memory_remember: "Saved",
  memory_recall: "Looked up",
  memory_context: "Gathered for a task",
  memory_list: "Listed",
  memory_update: "Changed",
  memory_forget: "Forgot",
  memory_compact: "Tidied",
  memory_export: "Exported",
  memory_import: "Imported",
};

/** Old chats still carry memory-tool calls; show them plainly without the live panel's types. */
function memoryScopeLabel(scope: string, roster: Record<string, Teammate> | null) {
  if (scope === "user") return "About you";
  if (scope === "project") return "This project";
  return roster?.[scope]?.name ?? scope;
}

function MemoryCallCard({ c }: { c: MemoryCall }) {
  const roster = useTeammates((s) => s.byId);
  const type = str(c.input.type);
  const scope = str(c.input.scope);
  const text = memoryCallText(c);
  return (
    <li className="rounded-lg border border-line px-3 py-2">
      {text && <div className="selectable text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink">{text}</div>}
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint ${text ? "mt-1.5" : ""}`}>
        <StatusDot status={c.status} />
        <span className="text-muted">{MEMORY_ACTION[c.action] ?? normalizeToolName(c.action)}</span>
        {type && <span className="rounded-md bg-hover px-1.5 py-px text-[11px] font-medium text-muted">{type.charAt(0).toUpperCase() + type.slice(1)}</span>}
        {scope && (
          <span className="flex items-center gap-1">
            {roster?.[scope] && <AgentMark id={scope} size={14} />}
            {memoryScopeLabel(scope, roster)}
          </span>
        )}
      </div>
    </li>
  );
}

function MemoryBody({ b, input, calls }: { b: ToolBlock; input: Json; calls: MemoryCall[] }) {
  const out = nonEmpty(b.output);
  const code = toolKind(b.name) === "execute" ? (str(input.code) ?? str(input.script)) : undefined;
  return (
    <>
      <ul className="space-y-1.5">
        {calls.map((c, i) => (
          <MemoryCallCard key={i} c={c} />
        ))}
      </ul>
      {out && (
        <Section title="Result" actions={<CopyButton text={out} label="Copy result" />}>
          <ProseBox text={out} />
        </Section>
      )}
      {code && (
        <Section title="Script" actions={<CopyButton text={code} label="Copy script" />}>
          <ScrollBox maxHeight={160}>
            <div className="px-3 py-2">
              <Code code={code} lang="typescript" />
            </div>
          </ScrollBox>
        </Section>
      )}
      {!live(b) && (
        <button
          onClick={() => useMemory.getState().show()}
          className="flex items-center gap-1.5 text-[12px] text-muted hover:text-ink hover:underline"
        >
          <Bookmark size={12} /> Show in Memory
        </button>
      )}
    </>
  );
}

function StatusDot({ status }: { status?: string }) {
  if (status === "error" || status === "failed") return <CircleX size={12} className="shrink-0 text-danger" />;
  if (status === "running" || status === "pending") return <AgentClock size={11} />;
  return <Check size={12} className="shrink-0 text-ok" />;
}

function TodoBody({ input }: { input: Json }) {
  const todos = Array.isArray(input.todos) ? (input.todos as Json[]) : [];
  if (!todos.length) return null;
  return (
    <ul className="space-y-1 text-[13px]">
      {todos.map((t, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className={`mt-0.5 shrink-0 ${t.status === "in_progress" ? "text-info" : "text-muted"}`}>
            {t.status === "completed" ? <Check size={13} /> : t.status === "in_progress" ? <CircleDot size={13} /> : t.status === "cancelled" ? <CircleX size={13} /> : <Circle size={13} />}
          </span>
          <span className={t.status === "completed" || t.status === "cancelled" ? "text-faint line-through" : "text-ink-2"}>{String(t.content ?? "")}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Anything else (MCP, plugins)
// ---------------------------------------------------------------------------

function GenericBody({ b, input }: { b: ToolBlock; input: Json }) {
  const out = nonEmpty(b.output);
  const json = useMemo(() => asJson(out), [out]);
  const path = inputPath(input);
  return (
    <>
      <Args input={input} />
      {out && (
        <Section title="Result" actions={<CopyButton text={out} label="Copy result" />}>
          <OutputView text={out} json={json} lang={json === undefined && path ? langOf(path) : "text"} follow={live(b)} />
        </Section>
      )}
      {!out && b.status === "completed" && !b.files?.length && <Empty>No output</Empty>}
      <Attachments b={b} />
    </>
  );
}

const humanKey = (k: string) => k.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** Arguments of a tool we don't know, as labelled fields; nested values open as JSON. */
function Args({ input }: { input: Json }) {
  const entries = Object.entries(input).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return null;
  return (
    <Section title="Arguments" actions={<CopyButton text={() => JSON.stringify(input, null, 2)} label="Copy arguments" />}>
      <dl className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg bg-sunken px-3 py-2 text-[12px]">
        {entries.map(([k, v]) => {
          const scalar = typeof v !== "object";
          const text = typeof v === "string" ? v : scalar ? String(v) : JSON.stringify(v, null, 2);
          const block = !scalar || text.length > 160 || text.includes("\n");
          return (
            <div key={k} className="contents">
              <dt className="truncate pt-px text-faint" title={k}>
                {humanKey(k)}
              </dt>
              <dd className={`selectable min-w-0 text-ink-2 ${block ? "scroll-quiet max-h-44 overflow-auto font-mono text-[11px] whitespace-pre-wrap" : "break-words"} ${typeof v === "string" ? "" : "font-mono"}`}>
                {text.length > 6000 ? `${text.slice(0, 6000)}…` : text}
              </dd>
            </div>
          );
        })}
      </dl>
    </Section>
  );
}

/** Files a tool returned. (Images it could show sit under the run, in the chat; see ImageStrip.) */
function Attachments({ b }: { b: ToolBlock }) {
  const files = (b.files ?? []).filter((f) => !(f.mime.startsWith("image/") && /^(data:|https?:)/.test(f.uri)));
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[12px] text-muted">
          <FileIcon path={f.name ?? ""} size={12} />
          {f.name ?? f.mime}
        </span>
      ))}
    </div>
  );
}
