/**
 * Teammate memory, on top of the simple-memory OpenCode plugin
 * (@knikolov/opencode-plugin-simple-memory, MIT). Otto doesn't run a memory
 * engine: the plugin gives agents nine `memory_*` tools and stores what they
 * save as plain logfmt files in `<project>/.opencode/memory/`. Otto installs
 * it, reads those files for the Memory panel, and edits them in the plugin's
 * own format, so the agent and the app always see the same thing.
 *
 * Format (one memory per line, daily files `YYYY-MM-DD.logfmt`):
 *   ts=2026-05-28T10:00:00.000Z type=context scope=api content="…" issue=#51 tags=a,b
 * Edits and deletes append an audit line to `deletions.logfmt`, as the
 * plugin's own `memory_update` / `memory_forget` do.
 */
import type { OpenCode } from "./opencode/client";
import type { GlobalConfig } from "./opencode/config";

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

export const MEMORY_PLUGIN = "@knikolov/opencode-plugin-simple-memory";
/**
 * Pinned: OpenCode doesn't update plugins on its own, and a new major could
 * change the file format under the Memory panel. 2.0.0 is the first release
 * with the OpenCode 2 entrypoint. Read the source before bumping.
 */
export const MEMORY_PLUGIN_VERSION = "2.0.0";
/**
 * `autoLoad` puts relevant memories in front of each reply. `autoSave` stays
 * off: its "remember …" matcher also fires on "do you remember…" and
 * "remember to…", and teammates already save explicitly (see the prompt).
 */
export const MEMORY_PLUGIN_OPTIONS = { autoLoad: true, autoSave: false };

type PluginEntry = string | { package?: string; options?: Record<string, unknown> };

const isMemorySpec = (spec: unknown) => typeof spec === "string" && (spec === MEMORY_PLUGIN || spec.startsWith(`${MEMORY_PLUGIN}@`));
const isMemoryEntry = (e: PluginEntry) => isMemorySpec(typeof e === "string" ? e : e?.package);

/** Installed in the global config, under either key OpenCode reads. */
export function memoryInstalled(cfg: GlobalConfig): boolean {
  return [cfg.plugins, cfg.plugin].some((list) => Array.isArray(list) && (list as PluginEntry[]).some(isMemoryEntry));
}

/** Adds the pinned plugin unless some version of it is already there (that one is the user's call). */
export function withMemoryPlugin(cfg: GlobalConfig): GlobalConfig {
  if (memoryInstalled(cfg)) return cfg;
  const plugins = Array.isArray(cfg.plugins) ? (cfg.plugins as PluginEntry[]) : [];
  return { ...cfg, plugins: [...plugins, { package: `${MEMORY_PLUGIN}@${MEMORY_PLUGIN_VERSION}`, options: { ...MEMORY_PLUGIN_OPTIONS } }] };
}

/** Removes every entry for the plugin. The memory files stay where they are. */
export function withoutMemoryPlugin(cfg: GlobalConfig): GlobalConfig {
  const next = { ...cfg };
  for (const key of ["plugins", "plugin"] as const) {
    const list = next[key];
    if (!Array.isArray(list)) continue;
    const kept = (list as PluginEntry[]).filter((e) => !isMemoryEntry(e));
    if (kept.length) next[key] = kept;
    else delete next[key];
  }
  return next;
}

/** The plugin's tools, for per-tool permissions. Actions match the tool names. */
export const MEMORY_TOOLS: { action: string; label: string; hint?: string }[] = [
  { action: "memory_remember", label: "Save a memory" },
  { action: "memory_recall", label: "Look up memories" },
  { action: "memory_context", label: "Gather memories for a task" },
  { action: "memory_list", label: "List what's remembered" },
  { action: "memory_update", label: "Change a memory" },
  { action: "memory_forget", label: "Forget memories" },
  { action: "memory_compact", label: "Tidy memory files", hint: "Removes exact duplicates" },
  { action: "memory_export", label: "Export memories" },
  { action: "memory_import", label: "Import memories" },
];

export const isMemoryTool = (name: string) => /^memory_[a-z]+$/.test(name);

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export const MEMORY_TYPES = ["preference", "decision", "context", "pattern", "learning", "blocker"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const TYPE_LABEL: Record<MemoryType, string> = {
  preference: "Preference",
  decision: "Decision",
  context: "Context",
  pattern: "Pattern",
  learning: "Learning",
  blocker: "Blocker",
};

/** The scope teammates use for facts about the user that every teammate should know. */
export const USER_SCOPE = "user";
/** The scope for facts about the project itself. Any other scope is a teammate's id. */
export const PROJECT_SCOPE = "project";

export interface Memory {
  ts: string;
  type: MemoryType;
  scope: string;
  content: string;
  issue?: string;
  tags?: string[];
}

export interface MemoryEntry extends Memory {
  /** Absolute path of the daily file it lives in. */
  file: string;
  /** The exact line, to find it again before an edit. */
  raw: string;
}

const isMemoryType = (v: string): v is MemoryType => (MEMORY_TYPES as readonly string[]).includes(v);

// Ported from the plugin (src/index.ts @ 2.0.0) so both sides agree byte for byte.

const escapeValue = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/"/g, '\\"');

function unescapeValue(v: string) {
  let out = "";
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = v[++i];
    if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === '"') out += '"';
    else if (n === "\\") out += "\\";
    else if (n !== undefined) out += `\\${n}`;
  }
  return out;
}

const needsQuotes = (v: string) => v === "" || /\s|"|\\/.test(v);
const field = (k: string, v: string, quote = false) => (!quote && !needsQuotes(v) ? `${k}=${v}` : `${k}="${escapeValue(v)}"`);

function parseFields(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < line.length) {
    while (line[i] === " ") i++;
    const start = i;
    while (i < line.length && line[i] !== "=" && line[i] !== " ") i++;
    const key = line.slice(start, i);
    if (!key || line[i] !== "=") break;
    i++;
    if (line[i] === '"') {
      i++;
      let v = "";
      while (i < line.length) {
        const c = line[i];
        if (c === '"') {
          i++;
          break;
        }
        if (c === "\\" && i + 1 < line.length) {
          v += c + line[i + 1];
          i += 2;
          continue;
        }
        v += c;
        i++;
      }
      out[key] = unescapeValue(v);
      continue;
    }
    const vs = i;
    while (i < line.length && line[i] !== " ") i++;
    out[key] = line.slice(vs, i);
  }
  return out;
}

export function parseMemory(line: string): Memory | null {
  const f = parseFields(line);
  if (!f.ts || !f.type || !f.scope || !isMemoryType(f.type)) return null;
  return { ts: f.ts, type: f.type, scope: f.scope, content: f.content || "", issue: f.issue, tags: f.tags ? f.tags.split(",").filter(Boolean) : undefined };
}

export function encodeMemory(m: Memory): string {
  const parts = [field("ts", m.ts), field("type", m.type), field("scope", m.scope), field("content", m.content, true)];
  if (m.issue) parts.push(field("issue", m.issue));
  if (m.tags?.length) parts.push(field("tags", m.tags.join(",")));
  return parts.join(" ");
}

function encodeDeletion(m: Memory, reason: string): string {
  const parts = [
    field("ts", new Date().toISOString()),
    field("action", "deleted"),
    field("original_ts", m.ts),
    field("type", m.type),
    field("scope", m.scope),
    field("content", m.content, true),
    field("reason", reason, true),
  ];
  if (m.issue) parts.push(field("issue", m.issue));
  if (m.tags?.length) parts.push(field("tags", m.tags.join(",")));
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export const memoryDir = (root: string) => `${root.replace(/\/$/, "")}/.opencode/memory`;
const DELETIONS = "deletions.logfmt";
const dayFile = (root: string, ts: string) => `${memoryDir(root)}/${ts.split("T")[0]}.logfmt`;

/** Is `name` a folder directly inside `dir`? */
async function hasFolder(client: OpenCode, root: string, dir: string, name: string) {
  const entries = await client.listDir(dir, root);
  return entries.some((e) => e.type === "directory" && e.path.replace(/\/$/, "").split("/").pop() === name);
}

/** File names in the memory folder, or null when the project has none yet. */
async function memoryFiles(client: OpenCode, root: string): Promise<string[] | null> {
  const dir = memoryDir(root);
  try {
    const entries = await client.listDir(dir, root);
    return entries.filter((e) => e.type === "file").map((e) => e.path.split("/").pop()!);
  } catch (e) {
    // A missing folder comes back as a bare 500: check before calling it an error.
    const base = root.replace(/\/$/, "");
    if (!(await hasFolder(client, root, base, ".opencode"))) return null;
    if (!(await hasFolder(client, root, `${base}/.opencode`, "memory"))) return null;
    throw e;
  }
}

/** Every memory saved in this project, newest first. */
export async function readMemories(client: OpenCode, root: string): Promise<MemoryEntry[]> {
  const dir = memoryDir(root);
  const names = await memoryFiles(client, root);
  if (!names) return [];
  const files = names.filter((n) => n.endsWith(".logfmt") && n !== DELETIONS);
  const out: MemoryEntry[] = [];
  await Promise.all(
    files.map(async (n) => {
      const file = `${dir}/${n}`;
      const text = await client.readFile(file, root);
      for (const raw of text.split("\n")) {
        const m = parseMemory(raw);
        if (m) out.push({ ...m, file, raw });
      }
    }),
  );
  return out.sort((a, b) => b.ts.localeCompare(a.ts));
}

async function readText(client: OpenCode, root: string, file: string) {
  try {
    return await client.readFile(file, root);
  } catch (e) {
    if ((e as { status?: number }).status === 404) return "";
    throw e;
  }
}

const joinLines = (lines: string[]) => (lines.length ? `${lines.join("\n")}\n` : "");

// One write at a time per machine, so two quick edits don't read the same old file.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

async function appendLine(client: OpenCode, root: string, file: string, line: string) {
  const text = await readText(client, root, file);
  const lines = text.split("\n").filter((l) => l.length > 0);
  await client.writeFile(file, joinLines([...lines, line]), root);
}

/** Re-read the entry's file and replace (or drop) its line. Fails if it changed meanwhile. */
async function rewriteLine(client: OpenCode, root: string, entry: MemoryEntry, next: string | null) {
  const lines = (await readText(client, root, entry.file)).split("\n").filter((l) => l.length > 0);
  const i = lines.indexOf(entry.raw);
  if (i < 0) throw new Error("This memory changed since you opened it. Refresh and try again.");
  if (next === null) lines.splice(i, 1);
  else lines[i] = next;
  await client.writeFile(entry.file, joinLines(lines), root);
}

export function addMemory(client: OpenCode, root: string, m: Omit<Memory, "ts">): Promise<Memory> {
  return serial(async () => {
    const memory: Memory = { ...m, ts: new Date().toISOString(), scope: m.scope.trim(), content: m.content.trim() };
    await appendLine(client, root, dayFile(root, memory.ts), encodeMemory(memory));
    return memory;
  });
}

/** Same as the plugin's memory_update: new timestamp, audit line for the old text. */
export function updateMemory(client: OpenCode, root: string, entry: MemoryEntry, patch: Pick<Memory, "content" | "type">): Promise<void> {
  return serial(async () => {
    const next: Memory = { ts: new Date().toISOString(), type: patch.type, scope: entry.scope, content: patch.content.trim(), issue: entry.issue, tags: entry.tags };
    await rewriteLine(client, root, entry, encodeMemory(next));
    await appendLine(client, root, `${memoryDir(root)}/${DELETIONS}`, encodeDeletion(entry, `Updated in Otto to: ${next.content}`));
  });
}

/** Same as the plugin's memory_forget for one memory. */
export function forgetMemory(client: OpenCode, root: string, entry: MemoryEntry): Promise<void> {
  return serial(async () => {
    await rewriteLine(client, root, entry, null);
    await appendLine(client, root, `${memoryDir(root)}/${DELETIONS}`, encodeDeletion(entry, "Deleted in Otto"));
  });
}

/** Stable key for lists. */
export const memoryKey = (m: MemoryEntry) => `${m.file}\n${m.raw}`;
