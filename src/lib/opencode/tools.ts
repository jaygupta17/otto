/**
 * OpenCode v2's tools, and the one place the chat branches on a tool name.
 *
 * v2 renamed the built-ins (`bash` → `shell`, `task` → `subagent`,
 * `apply_patch` → `patch`; `todowrite`, `list`, `multiedit` are gone), file
 * tools take `path`, and a tool state carries no server-rendered title, so
 * every row describes itself from the call's input and result metadata.
 * Unknown names (MCP servers, plugins) fall through to generic handling.
 *
 * `input` / `metadata` are whatever the model and the tool produced: every
 * accessor reads only the fields it understands and tolerates garbage.
 */
import type { Block } from "./projection";
import { APPS, appName } from "../composio";

export type ToolBlock = Extract<Block, { kind: "tool" }>;
type Json = Record<string, unknown>;

export type ToolKind =
  | "shell"
  | "read"
  | "edit"
  | "write"
  | "patch"
  | "grep"
  | "glob"
  | "webfetch"
  | "websearch"
  | "subagent"
  | "question"
  | "skill"
  | "execute"
  | "todo"
  | "session"
  | "memory"
  | "present"
  | "other";

/** `opencode.session_rename:2` → `session_rename`; lowercased, last namespace segment, no dedup suffix. */
export function normalizeToolName(name?: string): string {
  const t = name?.trim().toLowerCase().replace(/:\d+$/, "") ?? "";
  if (!t.includes(".")) return t;
  return t.split(".").filter(Boolean).pop() ?? t;
}

const KINDS: Record<string, ToolKind> = {
  shell: "shell",
  bash: "shell",
  read: "read",
  view: "read",
  edit: "edit",
  multiedit: "edit",
  str_replace: "edit",
  write: "write",
  create: "write",
  patch: "patch",
  apply_patch: "patch",
  grep: "grep",
  glob: "glob",
  list: "glob",
  ls: "glob",
  webfetch: "webfetch",
  fetch: "webfetch",
  websearch: "websearch",
  subagent: "subagent",
  task: "subagent",
  question: "question",
  skill: "skill",
  execute: "execute",
  todowrite: "todo",
  todoread: "todo",
  session_rename: "session",
  session_move: "session",
  models: "session",
  present: "present",
};

export function toolKind(name?: string): ToolKind {
  const n = normalizeToolName(name);
  if (KINDS[n]) return KINDS[n];
  if (MEMORY_TOOL.test(n)) return "memory";
  // MCP / plugin tools named like built-ins (`github_search_code`, `fs_read_file`…).
  if (/(^|_)(read|view|cat|open)_?(file)?$/.test(n)) return "read";
  if (/(write|create)_?file/.test(n)) return "write";
  if (/(edit|replace|patch)/.test(n)) return "edit";
  if (/(bash|shell|exec|command|terminal)/.test(n)) return "shell";
  if (/(search|grep|find)/.test(n)) return "grep";
  if (/(fetch|http|browse|url)/.test(n)) return "webfetch";
  return "other";
}

/** Coarse groups for the "Edited 2 files · ran 3 commands" summary. */
export type ToolCategory = "read" | "edit" | "search" | "run" | "web" | "task" | "think" | "memory" | "show" | "other";

export function toolCategory(name: string): ToolCategory {
  switch (toolKind(name)) {
    case "read":
    case "skill":
      return "read";
    case "edit":
    case "write":
    case "patch":
      return "edit";
    case "grep":
    case "glob":
      return "search";
    case "shell":
    case "execute":
      return "run";
    case "webfetch":
    case "websearch":
      return "web";
    case "subagent":
      return "task";
    case "todo":
    case "question":
      return "think";
    case "memory":
      return "memory";
    case "present":
      return "show";
    default:
      return "other";
  }
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function inputOf(b: ToolBlock): Json {
  if (b.input && typeof b.input === "object") return b.input;
  if (!b.inputText) return {};
  try {
    const v = JSON.parse(b.inputText);
    return v && typeof v === "object" ? (v as Json) : {};
  } catch {
    return partialJson(b.inputText);
  }
}

/** Pull string fields out of JSON that's still streaming in (`{"command": "npm te`). */
function partialJson(s: string): Json {
  const out: Json = {};
  const re = /"(\w+)"\s*:\s*"((?:[^"\\]|\\.)*)/g;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    try {
      out[m[1]] = JSON.parse(`"${m[2].replace(/\\$/, "")}"`);
    } catch {
      out[m[1]] = m[2];
    }
  }
  return out;
}

export const inputPath = (input: Json) => str(input.path) ?? str(input.filePath) ?? str(input.file_path) ?? str(input.file);

export type FileDiff = { file: string; patch?: string; additions?: number; deletions?: number; status?: "added" | "deleted" | "modified" };

/** Per-file diffs `edit` / `patch` report in `metadata.files`. Bad entries are skipped, not fatal. */
export function fileDiffs(metadata?: Json): FileDiff[] {
  const files = metadata?.files;
  if (!Array.isArray(files)) return [];
  const out: FileDiff[] = [];
  for (const f of files as Json[]) {
    const file = str(f?.file);
    if (!file) continue;
    const status = f.status === "added" || f.status === "deleted" || f.status === "modified" ? f.status : undefined;
    out.push({ file, patch: str(f.patch), additions: num(f.additions), deletions: num(f.deletions), status });
  }
  return out;
}

const PATCH_HEADER = /^\*\*\* (Add|Update|Delete) File: (.+)$/;

/** Files a `patch` call names in its own text, before (or without) its reported diffs. */
export function patchFiles(input: Json): { file: string; op: "add" | "update" | "delete" }[] {
  const text = str(input.patchText) ?? str(input.patch);
  if (!text) return [];
  const out: { file: string; op: "add" | "update" | "delete" }[] = [];
  for (const line of text.split("\n")) {
    const m = PATCH_HEADER.exec(line.trim());
    if (m && !out.some((x) => x.file === m[2].trim())) out.push({ file: m[2].trim(), op: m[1].toLowerCase() as "add" | "update" | "delete" });
  }
  return out;
}

export type ExecuteCall = { tool: string; status?: string; input?: string; args?: Json };

/** Tools an `execute` (code mode) script called, from `metadata.toolCalls`. */
export function executeCalls(metadata?: Json): ExecuteCall[] {
  const calls = metadata?.toolCalls;
  if (!Array.isArray(calls)) return [];
  const out: ExecuteCall[] = [];
  for (const c of calls as Json[]) {
    const tool = str(c?.tool);
    if (!tool) continue;
    let input: string | undefined;
    try {
      const j = c.input === undefined || c.input === null ? "" : JSON.stringify(c.input);
      if (j && j !== "{}") input = j.length > 160 ? `${j.slice(0, 160)}…` : j;
    } catch {
      /* unserialisable: leave off */
    }
    out.push({ tool, status: str(c.status), input, args: c.input && typeof c.input === "object" ? (c.input as Json) : undefined });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Apps (opencode-composio's tools, and the Composio MCP server's in older sessions)
// ---------------------------------------------------------------------------

/** The Composio MCP server Otto used before the plugin: `composio_composio_<op>`. */
const APP_TOOL = /^composio[._]composio_([a-z_]+)$/i;

/** What one call did to your apps. */
type AppOp = { op: "use"; app: string; what: string } | { op: "connect" | "disconnect" | "wait"; app: string } | { op: "check"; app?: string } | { op: "search"; app?: string; query?: string } | { op: "data" };

const isApp = (ns: unknown): ns is string => typeof ns === "string" && APPS.some((a) => a.slug === ns);
const words = (name: string) => name.replace(/_/g, " ");

/** "GOOGLECALENDAR_EVENTS_LIST" → the app and what it did ("events list"). */
function appAction(slug: string): { app: string; what: string } {
  const lower = slug.toLowerCase();
  const app = APPS.find((a) => lower.startsWith(`${a.slug}_`))?.slug ?? lower.split("_")[0];
  return { app, what: words(lower.slice(app.length + 1)) };
}

/**
 * What a script's calls did to your apps, or null when any of them was about
 * something else. Plugin calls are `gmail.send_email`, `apps.run`… (and
 * OpenCode's own tool `search` within an app's namespace).
 */
function appOps(calls: ExecuteCall[]): AppOp[] | null {
  const out: AppOp[] = [];
  for (const c of calls) {
    const a = c.args ?? {};
    const legacy = APP_TOOL.exec(c.tool)?.[1]?.toLowerCase();
    if (legacy) {
      const toolkits = Array.isArray(a.toolkits) ? (a.toolkits as unknown[]) : [];
      const kit = (t: unknown) => (typeof t === "string" ? t : (str((t as Json)?.name) ?? "")).toLowerCase();
      if (legacy === "multi_execute_tool") out.push(...(Array.isArray(a.tools) ? (a.tools as Json[]) : []).map((t) => str(t?.tool_slug)).filter((x): x is string => !!x).map((t) => ({ op: "use" as const, ...appAction(t) })));
      else if (legacy === "manage_connections")
        for (const t of toolkits) {
          const act = str((t as Json)?.action) ?? "add";
          out.push({ op: act === "add" ? "connect" : act === "remove" ? "disconnect" : "check", app: kit(t) });
        }
      else if (legacy === "wait_for_connections") out.push(...toolkits.map((t) => ({ op: "wait" as const, app: kit(t) })));
      else if (legacy === "search_tools" || legacy === "get_tool_schemas") out.push({ op: "search", query: (Array.isArray(a.queries) ? (a.queries as Json[]) : []).map((x) => str(x?.use_case)).find(Boolean) });
      else out.push({ op: "data" });
      continue;
    }
    const m = /^([a-z0-9_]+)\.([a-z0-9_]+)$/.exec(c.tool);
    if (m && isApp(m[1])) out.push({ op: "use", app: m[1], what: words(m[2]) });
    else if (m?.[1] === "apps") {
      if (m[2] === "run" && str(a.action)) out.push({ op: "use", ...appAction(str(a.action)!) });
      else if (m[2] === "connect" && str(a.app)) out.push({ op: "connect", app: str(a.app)!.toLowerCase() });
      else if (m[2] === "search") out.push({ op: "search", query: str(a.task) });
      else out.push({ op: "check" });
    } else if (c.tool === "search" && (isApp(a.namespace) || a.namespace === "apps")) out.push({ op: "search", app: a.namespace === "apps" ? undefined : (a.namespace as string), query: str(a.query) });
    else return null;
  }
  return out.length ? out : null;
}

/** `tools.gmail.send_email(` calls in a script's code, before it reports what it called. */
function codeAppCalls(code?: string): ExecuteCall[] {
  return [...(code ?? "").matchAll(/\btools\.([a-z0-9_]+)\.([a-z0-9_]+)\s*\(/g)].filter((m) => isApp(m[1])).map((m) => ({ tool: `${m[1]}.${m[2]}` }));
}

/** The one app a script worked with (for its logo), "" when it only touched apps in general, null when it wasn't an app script. */
export function appOf(b: ToolBlock): string | null {
  if (normalizeToolName(b.name) !== "execute") return null;
  const calls = executeCalls(b.metadata);
  const ops = appOps(calls.length ? calls : codeAppCalls(str(inputOf(b).code)));
  if (!ops) return null;
  const apps = new Set(ops.flatMap((o) => ("app" in o && o.app ? [o.app] : [])));
  return apps.size === 1 ? [...apps][0] : "";
}

/** Apps a script used, for the turn's summary ("used Gmail"); [] when it only looked around; null when it wasn't an app script. */
function appsUsed(b: ToolBlock): string[] | null {
  if (toolKind(b.name) !== "execute") return null;
  const ops = appOps(executeCalls(b.metadata));
  return ops && [...new Set(ops.flatMap((o) => (o.op === "use" ? [appName(o.app)] : [])))];
}

/**
 * A script that only touched apps reads as what happened to them: "Used
 * Gmail · send email", "Asked to connect Slack", "Looked through Google
 * Calendar". Null when the script did anything else.
 */
function appCalls(calls: ExecuteCall[], done: boolean): { verb: string; target: string } | null {
  const ops = appOps(calls);
  if (!ops) return null;
  const all = <K extends AppOp["op"]>(op: K) => ops.filter((o): o is Extract<AppOp, { op: K }> => o.op === op);
  const names = (list: { app: string }[]) => [...new Set(list.map((o) => appName(o.app)))].join(", ");
  const used = all("use");
  if (used.length) return { verb: `${done ? "Used" : "Using"} ${names(used)}`, target: [...new Set(used.map((o) => o.what))].slice(0, 3).join(", ") };
  if (all("connect").length) return { verb: "Asked to connect", target: names(all("connect")) };
  if (all("disconnect").length) return { verb: "Disconnected", target: names(all("disconnect")) };
  if (all("wait").length) return { verb: done ? "Waited for" : "Waiting for", target: names(all("wait")) };
  const search = all("search");
  if (search.length) {
    const apps = [...new Set(search.flatMap((o) => (o.app ? [appName(o.app)] : [])))];
    return { verb: apps.length ? "Looked through" : "Looked through your apps", target: apps.length ? apps.join(", ") : search[0].query ? firstLine(search[0].query, 80) : "" };
  }
  const checked = all("check").filter((o): o is { op: "check"; app: string } => !!o.app);
  if (all("check").length) return { verb: "Checked", target: checked.length ? names(checked) : "your apps" };
  return { verb: done ? "Worked with app data" : "Working with app data", target: "" };
}

// ---------------------------------------------------------------------------
// Memory (the simple-memory plugin's `memory_*` tools)
// ---------------------------------------------------------------------------

const MEMORY_TOOL = /^memory_[a-z]+$/;

export type MemoryCall = { action: string; input: Json; status?: string };

/**
 * The memory calls a block made: itself when it's a `memory_*` tool, or a
 * code-mode script that called nothing but memory tools. Null otherwise.
 */
export function memoryCalls(b: ToolBlock): MemoryCall[] | null {
  const n = normalizeToolName(b.name);
  if (MEMORY_TOOL.test(n)) return [{ action: n, input: inputOf(b), status: b.status }];
  if (n !== "execute") return null;
  const calls = b.metadata?.toolCalls;
  if (!Array.isArray(calls) || !calls.length) return null;
  const out: MemoryCall[] = [];
  for (const c of calls as Json[]) {
    const action = normalizeToolName(str(c?.tool));
    if (!MEMORY_TOOL.test(action)) return null;
    const input = c.input && typeof c.input === "object" && !Array.isArray(c.input) ? (c.input as Json) : {};
    out.push({ action, input, status: str(c.status) });
  }
  return out;
}

const MEMORY_VERB: Record<string, [string, string]> = {
  memory_remember: ["Remembered", "Remember"],
  memory_recall: ["Recalled", "Recall"],
  memory_context: ["Checked memory", "Check memory"],
  memory_list: ["Listed memories", "List memories"],
  memory_update: ["Updated memory", "Update memory"],
  memory_forget: ["Forgot", "Forget"],
  memory_compact: ["Tidied memory", "Tidy memory"],
  memory_export: ["Exported memories", "Export memories"],
  memory_import: ["Imported memories", "Import memories"],
};

/** The words worth showing for one call: what was saved, or what was looked for. */
export function memoryCallText(c: MemoryCall): string {
  const i = c.input;
  if (c.action === "memory_remember" || c.action === "memory_update") return firstLine(str(i.content) ?? "", 120);
  const q = str(i.query);
  if (q) return `“${firstLine(q, 100)}”`;
  return str(i.scope) ?? "";
}

/** What to search the Memory panel for: the saved text, or the query. Everything when it's a mix. */
export function memorySearch(calls: MemoryCall[]): string {
  if (calls.length !== 1) return "";
  return memoryCallText(calls[0]).replace(/^“|”$/g, "").replace(/…$/, "");
}

function memoryLabel(calls: MemoryCall[], done: boolean): { verb: string; target: string } {
  const actions = [...new Set(calls.map((c) => c.action))];
  const verb = (a: string) => MEMORY_VERB[a]?.[done ? 0 : 1] ?? titleCase(a.replace(/^memory_/, ""));
  if (actions.length === 1) {
    const texts = calls.map(memoryCallText).filter(Boolean);
    return { verb: verb(actions[0]), target: texts.length > 1 ? `${texts[0]} +${texts.length - 1}` : (texts[0] ?? "") };
  }
  return { verb: done ? "Used memory" : "Use memory", target: actions.map((a) => a.replace(/^memory_/, "")).join(", ") };
}

export type SubagentCall = { agent?: string; description?: string; prompt?: string; childID?: string; background: boolean };

export function subagentOf(b: ToolBlock): SubagentCall {
  const input = inputOf(b);
  const md = b.metadata ?? {};
  return {
    agent: str(input.agent) ?? str(input.subagent_type),
    description: str(input.description),
    prompt: str(input.prompt),
    childID: str(md.sessionID) ?? str(md.sessionId),
    // OpenCode marks every handoff "running" as it starts; one left running in the background is a call that settled that way.
    background: input.background === true || (b.status === "completed" && md.status === "running"),
  };
}

export type QuestionItem = { question: string; header?: string; options: string[]; multiple?: boolean };

export function questionsOf(input: Json): QuestionItem[] {
  const qs = input.questions;
  if (!Array.isArray(qs)) return [];
  return (qs as Json[])
    .map((q) => ({
      question: str(q?.question) ?? str(q?.text) ?? "",
      header: str(q?.header),
      multiple: q?.multiple === true || q?.multiSelect === true,
      options: Array.isArray(q?.options) ? (q.options as unknown[]).map((o) => (typeof o === "string" ? o : str((o as Json)?.label) ?? str((o as Json)?.value) ?? "")).filter(Boolean) : [],
    }))
    .filter((q) => q.question);
}

// ---------------------------------------------------------------------------
// Row labels
// ---------------------------------------------------------------------------

const base = (p: string) => p.split("/").filter(Boolean).pop() ?? p;
const firstLine = (s: string, n = 120) => {
  const l = s.split("\n")[0];
  return l.length > n ? `${l.slice(0, n)}…` : l;
};
const titleCase = (s: string) => s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** The row: a verb, what it acted on, and (for file tools) the file path to chip. */
export function toolLabel(b: ToolBlock): { verb: string; target: string; path?: string; files?: string[] } {
  const input = inputOf(b);
  const md = b.metadata ?? {};
  const done = b.status === "completed";
  switch (toolKind(b.name)) {
    case "shell":
      return { verb: done ? "Ran" : "Run", target: firstLine(str(input.description) && !str(input.command) ? str(input.description)! : (str(input.command) ?? str(input.cmd) ?? "")) };
    case "read": {
      const p = inputPath(input) ?? str(input.uri);
      return { verb: "Read", target: p ? base(p) : "", path: p };
    }
    case "write": {
      const p = inputPath(input) ?? fileDiffs(md)[0]?.file;
      return { verb: done ? "Wrote" : "Write", target: p ? base(p) : "", path: p };
    }
    case "edit": {
      const p = inputPath(input) ?? fileDiffs(md)[0]?.file;
      return { verb: done ? "Edited" : "Edit", target: p ? base(p) : "", path: p };
    }
    case "patch": {
      const files = fileDiffs(md).map((f) => f.file);
      const all = files.length ? files : patchFiles(input).map((f) => f.file);
      if (all.length === 1) return { verb: done ? "Edited" : "Edit", target: base(all[0]), path: all[0] };
      return { verb: done ? "Edited" : "Edit", target: all.length ? `${all.length} files` : "", files: all };
    }
    case "grep": {
      const pattern = str(input.pattern) ?? str(input.query) ?? str(input.regex) ?? "";
      const where = inputPath(input) ?? str(input.directory) ?? str(input.include);
      return { verb: "Search", target: [pattern && `“${pattern}”`, where && `in ${base(where)}`].filter(Boolean).join(" ") };
    }
    case "glob": {
      const pattern = str(input.pattern) ?? str(input.glob) ?? inputPath(input) ?? "";
      return { verb: "Find", target: pattern };
    }
    case "webfetch": {
      const url = str(input.url) ?? "";
      let host = url;
      try {
        const u = new URL(url);
        host = u.host + (u.pathname === "/" ? "" : u.pathname);
      } catch {
        /* not a URL */
      }
      return { verb: done ? "Fetched" : "Fetch", target: host };
    }
    case "websearch":
      return { verb: done ? "Searched the web" : "Search the web", target: str(input.query) ? `“${str(input.query)}”` : "" };
    case "subagent": {
      const s = subagentOf(b);
      return { verb: s.agent ? titleCase(s.agent) : "Subagent", target: s.description ?? (s.prompt ? firstLine(s.prompt, 80) : "") };
    }
    case "question": {
      const n = questionsOf(input).length;
      return { verb: "Asked", target: n ? `${n} question${n === 1 ? "" : "s"}` : "" };
    }
    case "skill":
      return { verb: "Loaded skill", target: str(md.name) ?? str(input.name) ?? str(input.id) ?? "" };
    case "memory":
      return memoryLabel(memoryCalls(b)!, done);
    case "execute": {
      const mem = memoryCalls(b);
      if (mem) return memoryLabel(mem, done);
      const calls = executeCalls(md);
      if (!calls.length) {
        // Still running: the app calls its code makes say more than its first line.
        const apps = appCalls(codeAppCalls(str(input.code)), done);
        return apps ?? { verb: "Ran script", target: str(input.code) ? firstLine(str(input.code)!, 80) : "" };
      }
      const apps = appCalls(calls, done);
      if (apps) return apps;
      const counts = new Map<string, number>();
      for (const c of calls) counts.set(c.tool, (counts.get(c.tool) ?? 0) + 1);
      const named = [...counts].slice(0, 3).map(([t, n]) => (n > 1 ? `${normalizeToolName(t)} ×${n}` : normalizeToolName(t)));
      return { verb: "Ran script", target: named.join(", ") + (counts.size > 3 ? ` +${counts.size - 3}` : "") };
    }
    case "present": {
      // What it showed, named the way the artifact list names it.
      const source = str(input.source) ?? "";
      return { verb: done ? "Presented" : "Present", target: str(input.title) ?? (source.startsWith("<") ? "Markup" : base(source)), path: source && !source.startsWith("<") && !/^https?:\/\//i.test(source) ? source : undefined };
    }
    case "todo":
      return { verb: "Updated plan", target: "" };
    case "session": {
      const n = normalizeToolName(b.name);
      if (n === "session_rename") return { verb: "Renamed session", target: str(input.title) ?? "" };
      if (n === "session_move") return { verb: "Moved session", target: str(input.directory) ?? "" };
      return { verb: "Looked up models", target: str(input.search) ?? str(input.provider) ?? "" };
    }
    default: {
      const n = b.name;
      // MCP tools arrive as `server_tool` or `server.tool`: show the tool, name the server quietly.
      const parts = n.split(/[.]/);
      const verb = titleCase(parts.at(-1) ?? n);
      const target = str(input.description) ?? str(input.query) ?? str(input.title) ?? str(input.url) ?? inputPath(input) ?? str(input.command) ?? str(input.name) ?? "";
      return { verb, target: firstLine(target, 100), path: inputPath(input) };
    }
  }
}

/** A live call as a status line says it: "Reading Thread.tsx", "Running bun test", "Waiting on Explore". */
export function toolDoing(b: ToolBlock): string {
  const { verb, target } = toolLabel(b);
  const say = (doing: string, what = target) => (what ? `${doing} ${what}` : doing);
  switch (toolKind(b.name)) {
    case "shell":
      return say("Running", firstLine(target, 60));
    case "read":
      return say("Reading");
    case "write":
      return say("Writing");
    case "edit":
    case "patch":
      return say("Editing");
    case "grep":
      return say("Searching");
    case "glob":
      return say("Looking for");
    case "webfetch":
      return say("Opening");
    case "websearch":
      return say("Searching the web for");
    case "subagent": {
      const s = subagentOf(b);
      return s.agent ? `Waiting on ${titleCase(s.agent)}` : "Waiting on a helper";
    }
    case "question":
      return "Waiting for you";
    case "skill":
      return target ? `Loading the ${target} skill` : "Loading a skill";
    case "memory":
    case "execute": {
      const mem = memoryCalls(b);
      if (mem) return mem.every((c) => c.action === "memory_remember") ? "Remembering" : "Checking memory";
      // An app at work says itself ("Using Gmail"); other code is just a script.
      return /^(Using|Waiting) /.test(verb) ? say(verb) : "Running a script";
    }
    case "present":
      return say("Showing");
    case "todo":
      return "Planning";
    case "session":
      return "Tidying the session";
    default:
      return `Using ${verb}`;
  }
}

// ---------------------------------------------------------------------------
// Summary line
// ---------------------------------------------------------------------------

const PHRASE: Record<ToolCategory, [string, string]> = {
  read: ["read", "file"],
  edit: ["edited", "file"],
  search: ["searched", "time"],
  run: ["ran", "command"],
  web: ["fetched", "page"],
  task: ["delegated", "task"],
  think: ["planned", "step"],
  memory: ["used memory", "time"],
  show: ["showed", "artifact"],
  other: ["used", "tool"],
};

/** "Thought once · edited 2 files · ran 3 commands". Edits count distinct files, not calls. */
export function summarizeTools(blocks: Block[]): string {
  const counts = new Map<ToolCategory, number>();
  const edited = new Set<string>();
  let thoughts = 0;
  let browser = 0;
  const apps = new Set<string>();
  for (const b of blocks) {
    if (b.kind === "tool") {
      // The agent's browser runs through the shell; say so instead of "ran 5 commands".
      if (toolKind(b.name) === "shell" && /otto-browser\s+[a-z]/.test(String(inputOf(b).command ?? ""))) {
        browser += 1;
        continue;
      }
      // Scripts that only touched apps: "used Gmail" instead of "ran 2 commands".
      const used = appsUsed(b);
      if (used) {
        if (used.length) for (const n of used) apps.add(n);
        else apps.add("");
        continue;
      }
      const c = memoryCalls(b) ? "memory" : toolCategory(b.name);
      if (c === "edit") {
        const l = toolLabel(b);
        const files = l.files?.length ? l.files : l.path ? [l.path] : [b.id];
        for (const f of files) edited.add(f);
        continue;
      }
      counts.set(c, (counts.get(c) ?? 0) + 1);
    } else if (b.kind === "reasoning") thoughts += 1;
  }
  if (edited.size) counts.set("edit", edited.size);
  const order: ToolCategory[] = ["edit", "read", "search", "run", "web", "task", "think", "memory", "show", "other"];
  const parts: string[] = [];
  if (thoughts) parts.push(`thought ${thoughts === 1 ? "once" : `${thoughts} times`}`);
  if (browser) parts.push(`used the browser${browser === 1 ? "" : ` (${browser} steps)`}`);
  if (apps.size) {
    const named = [...apps].filter(Boolean);
    parts.push(named.length ? `used ${named.slice(0, 2).join(" and ")}${named.length > 2 ? ` +${named.length - 2}` : ""}` : "checked your apps");
  }
  for (const c of order) {
    const n = counts.get(c);
    if (!n) continue;
    const [verb, noun] = PHRASE[c];
    parts.push(c === "search" || c === "memory" ? `${verb} ${n === 1 ? "once" : `${n} times`}` : `${verb} ${n} ${noun}${n === 1 ? "" : "s"}`);
  }
  const s = parts.join(" · ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Result parsers (each returns null / [] when the text isn't what it expects)
// ---------------------------------------------------------------------------

/** `question` output: `User has answered your questions: "Q"="A", "Q2"="A2". You can now…` */
export function questionAnswers(output?: string): { question: string; answer: string }[] {
  const m = output?.match(/^User has answered your questions:\s*([\s\S]+?)\.\s*You can now/);
  if (!m) return [];
  const out: { question: string; answer: string }[] = [];
  const re = /"((?:[^"\\]|\\.)+)"="((?:[^"\\]|\\.)*)"/g;
  for (let p = re.exec(m[1]); p; p = re.exec(m[1])) out.push({ question: p[1].replace(/\\"/g, '"'), answer: p[2].replace(/\\"/g, '"') });
  return out;
}

export type WebHit = { title: string; url: string; published?: string; snippet: string };

/** `websearch` output: one `## [title](url)` block per hit, an optional `Published:` line, then the snippet. */
export function webHits(output?: string): WebHit[] {
  if (!output || !/^\s*## \[/.test(output)) return [];
  const hits: WebHit[] = [];
  for (const chunk of output.split(/^(?=## \[)/m)) {
    const head = /^## \[([\s\S]*?)\]\((\S+?)\)\s*$/m.exec(chunk.split("\n")[0]);
    if (!head) continue;
    let rest = chunk.split("\n").slice(1);
    let published: string | undefined;
    if (/^Published:\s*/.test(rest[0] ?? "")) {
      published = rest[0].replace(/^Published:\s*/, "").trim();
      rest = rest.slice(1);
    }
    hits.push({ title: head[1], url: head[2], published, snippet: rest.join("\n").trim() });
  }
  return hits;
}

export type Diagnostic = { message: string; line: number; character: number };

/** LSP errors a file tool reported for `path` (`metadata.diagnostics[path]`), errors only. */
export function diagnosticsFor(metadata: Json | undefined, path: string | undefined): { items: Diagnostic[]; more: number } | null {
  const all = metadata?.diagnostics;
  if (!path || !all || typeof all !== "object") return null;
  const map = all as Record<string, unknown>;
  const key = Object.keys(map).find((k) => k === path || k.endsWith(`/${path.replace(/^\.?\//, "")}`) || path.endsWith(`/${k.replace(/^\.?\//, "")}`));
  const list = key ? map[key] : undefined;
  if (!Array.isArray(list)) return null;
  const items: Diagnostic[] = [];
  for (const d of list as Json[]) {
    const message = str(d?.message)?.trim();
    if (!message || (typeof d.severity === "number" && d.severity !== 1)) continue;
    const start = ((d.range as Json)?.start ?? {}) as Json;
    items.push({ message, line: (num(start.line) ?? 0) + 1, character: (num(start.character) ?? 0) + 1 });
  }
  if (!items.length) return null;
  return { items: items.slice(0, 5), more: Math.max(0, items.length - 5) };
}

/** `execute` output that was cut, and where the full text went. */
export function executeTruncation(metadata?: Json): { path?: string } | null {
  if (!metadata?.truncated) return null;
  return { path: str(metadata.outputPath) };
}

// ---------------------------------------------------------------------------
// Diffs
// ---------------------------------------------------------------------------

export type DiffLine = { t: "ctx" | "add" | "del" | "hunk" | "meta"; text: string; a?: number; b?: number };

/** A unified diff as rows with old (`a`) and new (`b`) line numbers. Headers are dropped. */
export function parseDiff(patch: string): DiffLine[] {
  const out: DiffLine[] = [];
  let a = 0;
  let b = 0;
  let inHunk = false;
  for (const line of patch.split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (h) {
      a = Number(h[1]);
      b = Number(h[2]);
      inHunk = true;
      out.push({ t: "hunk", text: h[3].trim() });
      continue;
    }
    if (!inHunk) continue; // Index:, ===, ---, +++ lines
    if (line.startsWith("\\")) continue; // \ No newline at end of file
    if (line.startsWith("+")) out.push({ t: "add", text: line.slice(1), b: b++ });
    else if (line.startsWith("-")) out.push({ t: "del", text: line.slice(1), a: a++ });
    else out.push({ t: "ctx", text: line.slice(1), a: a++, b: b++ });
  }
  // Trailing blank context from a final newline.
  while (out.length && out.at(-1)!.t === "ctx" && out.at(-1)!.text === "") out.pop();
  return out;
}

/** The first changed line on the new side (to open the file there). */
export function firstChangedLine(patch?: string): number | undefined {
  if (!patch) return undefined;
  for (const l of parseDiff(patch)) if (l.t === "add" || l.t === "del") return l.b ?? l.a;
  return undefined;
}

/** Diff stats only when every file reported them (a partial sum would mislead). */
export function diffStats(diffs: FileDiff[]): { add: number; del: number } | null {
  if (!diffs.length || diffs.some((f) => f.additions === undefined || f.deletions === undefined)) return null;
  return { add: diffs.reduce((n, f) => n + f.additions!, 0), del: diffs.reduce((n, f) => n + f.deletions!, 0) };
}

export const lineCount = (s: string) => (s ? s.split("\n").length - (s.endsWith("\n") ? 1 : 0) : 0);

/** Parse text as JSON only when it plainly is (object / array), for the output viewer. */
export function asJson(text?: string): unknown {
  const t = text?.trim();
  if (!t || !((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) || t.length > 2_000_000) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Subagents
// ---------------------------------------------------------------------------

/** A finished subagent's report, as the parent transcript received it. */
export type SubagentReportLite = { childID?: string; state?: string; text: string; time: number };

export type SubagentPhase = "running" | "done" | "error" | "stopped" | "background";

/**
 * Where a subagent call stands. A foreground call settles with its result; a
 * background one settles at once (`metadata.status: "running"`) and its result
 * arrives later as a report. A stop shows up as a cancellation, which is the
 * user's doing, not a failure.
 */
export function subagentPhase(
  b: ToolBlock,
  ctx: { childBusy: boolean; report?: SubagentReportLite; stopped: boolean },
): { phase: SubagentPhase; output?: string; error?: string; ended?: number } {
  const s = subagentOf(b);
  if (b.status === "running" || b.status === "streaming") return { phase: "running" };
  if (b.status === "error") {
    const cancelled = ctx.stopped || /cancel|interrupt|abort/i.test(b.error ?? "");
    return cancelled ? { phase: "stopped", ended: b.ended } : { phase: "error", error: b.error, ended: b.ended };
  }
  if (s.background) {
    const r = ctx.report;
    if (r) {
      if (r.state === "cancelled" || r.state === "interrupted" || (ctx.stopped && r.state !== "completed")) return { phase: "stopped", output: r.text || undefined, ended: r.time };
      if (r.state === "error" || r.state === "failed") return { phase: "error", error: r.text, ended: r.time };
      if (r.state === "running") return { phase: "running" };
      return { phase: "done", output: r.text, ended: r.time };
    }
    if (ctx.childBusy) return { phase: "running" };
    return { phase: ctx.stopped ? "stopped" : "background" };
  }
  const out = b.output?.trim();
  return { phase: "done", output: out ? (/^\s*<subagent\b[^>]*>\n?([\s\S]*?)\n?<\/subagent>\s*$/.exec(out)?.[1] ?? out).trim() : undefined, ended: b.ended };
}

/** Marks a subagent the user stopped, so the agent doesn't read the cancellation as a failure. */
export const STOP_NOTE_KEY = "ottoSubagentCancellation";
/** OpenChamber writes the same note under its own key; honour both. */
const STOP_NOTE_KEYS = [STOP_NOTE_KEY, "openchamberSubagentCancellation"];

export function stopNoteChild(metadata?: Json): string | undefined {
  for (const k of STOP_NOTE_KEYS) {
    const v = metadata?.[k] as Json | undefined;
    if (v && typeof v.sessionID === "string") return v.sessionID;
  }
  return undefined;
}

/** The model-facing note that precedes a stop. Never shown in the chat. */
export function subagentStopNote(childID: string, description?: string) {
  const named = description ? `the subagent "${description}"` : "a subagent";
  return {
    text: [
      `The user stopped ${named} (sessionID: ${childID}).`,
      "The result for it that follows reports that the subagent was cancelled.",
      "That is how the stop shows up: the subagent did not fail on its own, the user cancelled it.",
      "Do not start it again just because of that result. The same work is fine to delegate later when the task or the user needs it.",
    ].join(" "),
    description: "Subagent stopped by the user",
    metadata: { [STOP_NOTE_KEY]: { sessionID: childID } },
  };
}

// ---------------------------------------------------------------------------
// Background commands
// ---------------------------------------------------------------------------

/**
 * The command a shell call left running: a background call settles at once
 * with `metadata.status: "running"` (so does one moved to the background
 * mid-run), and its output arrives later as a report.
 */
export function backgroundShellID(b: ToolBlock): string | undefined {
  const md = b.metadata ?? {};
  return b.status === "completed" && md.status === "running" && typeof md.shellID === "string" ? md.shellID : undefined;
}

/** A finished background command, as the transcript received it. */
export type ShellReportLite = { shellID: string; state?: string; exit?: number; signal?: string; timeout?: boolean; text: string; time: number };

/** Marks a command the user stopped, so the agent doesn't read the cancellation as a failure. */
export const SHELL_STOP_NOTE_KEY = "ottoShellCancellation";
const SHELL_STOP_NOTE_KEYS = [SHELL_STOP_NOTE_KEY, "openchamberShellCancellation"];

export function stopNoteShell(metadata?: Json): string | undefined {
  for (const k of SHELL_STOP_NOTE_KEYS) {
    const v = metadata?.[k] as Json | undefined;
    if (v && typeof v.shellID === "string") return v.shellID;
  }
  return undefined;
}

/** The model-facing note that precedes a stop. Never shown in the chat. */
export function shellStopNote(shellID: string, command?: string) {
  const named = command ? `the background command \`${command.length > 200 ? `${command.slice(0, 200)}…` : command}\`` : "a background command";
  return {
    text: [
      `The user stopped ${named} (shell ID: ${shellID}).`,
      "The completion notice for it that follows reports an error such as Shell.NotFoundError or says that nothing ran.",
      "That is how the stop shows up: the command did not fail on its own, the user cancelled it.",
      "Do not start it again just because of that notice. The command itself is fine to run later when the task or the user needs it.",
    ].join(" "),
    description: "Command stopped by the user",
    metadata: { [SHELL_STOP_NOTE_KEY]: { shellID } },
  };
}

/**
 * Where a background command stands: its report decides once it's in (a
 * stop reads as stopped, never as a failure); until then the live list does.
 */
export function backgroundShellPhase(
  report: ShellReportLite | undefined,
  live: { status: string; exit?: number } | undefined,
  stopped: boolean,
): { phase: "running" | "done" | "error" | "stopped" | "background"; exit?: number; error?: string } {
  if (stopped) return { phase: "stopped" };
  if (report) {
    // Killed from elsewhere with no note: the command is just gone.
    if (report.state === "cancelled" || /^\s*Shell\.NotFoundError\s*$/.test(report.text)) return { phase: "stopped" };
    if (report.timeout) return { phase: "error", exit: report.exit, error: "Timed out" };
    if (report.signal) return { phase: "error", exit: report.exit, error: `Killed (${report.signal})` };
    if (report.state === "error" || (report.exit !== undefined && report.exit !== 0)) return { phase: "error", exit: report.exit, error: report.exit === undefined ? report.text.trim().split("\n")[0] || "Failed" : undefined };
    return { phase: "done", exit: report.exit };
  }
  if (live?.status === "running") return { phase: "running" };
  if (live) return live.exit !== undefined && live.exit !== 0 ? { phase: "error", exit: live.exit } : { phase: "done", exit: live.exit };
  return { phase: "background" };
}

/** An error that only says the run was stopped (by you, or a stop cutting a step short); it isn't a failure. */
export const isStopError = (text?: string) => !!text && /^(?:step |tool (?:execution )?)?(?:interrupted|aborted|cancell?ed)\.?$|\babort(?:ed)?\b.*\b(?:signal|by user)|operation was aborted/i.test(text.trim());

/** A tool that failed for real, not one a stop cut short. */
export const toolFailed = (b: Block) => b.kind === "tool" && b.status === "error" && !isStopError(b.error);
