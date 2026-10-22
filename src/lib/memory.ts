/**
 * Teammate memory: plain markdown in the OpenCode config folder, not a
 * plugin. One file, `memory/context.md`, is added to OpenCode's global
 * `instructions` so every new session starts with it; the rest is read on
 * demand through the tools agents already have (read, write, edit, grep).
 *
 * Layout, under the global config directory (usually ~/.config/opencode):
 *   memory/
 *     context.md              the only injected file; kept under 40 lines
 *     daily/YYYY-MM-DD.md     append-only, one line per event
 *     projects/<project>.md   state, decisions, open threads
 *     learnings/<topic>.md    durable, non-obvious findings
 *     agents/<agent-id>.md    private scratchpad
 *
 * Otto owns the injection line and the folder's shape; the files themselves
 * belong to the agents and the user, and the Memory panel edits the same
 * files. Nothing here ever deletes a memory: turning memory off removes the
 * instruction and the old plugin, and leaves every file where it is.
 */
import type { OpenCode } from "./opencode/client";
import { configLocation, sh, updateGlobalConfig, type GlobalConfig } from "./opencode/config";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export const MEMORY_DIR = "memory";
export const CONTEXT_FILE = "context.md";
/** The injected file stays short: it is paid for on every request. */
export const CONTEXT_LINE_LIMIT = 40;

/**
 * The plugin Otto used to install. It's gone from new machines, and install
 * and remove both strip it so upgraded ones stop loading memory tools that
 * write to a folder this app no longer reads.
 */
export const MEMORY_PLUGIN = "@knikolov/opencode-plugin-simple-memory";

export interface MemoryPaths {
  /** Absolute path of the memory folder. */
  root: string;
  context: string;
  daily: string;
  projects: string;
  learnings: string;
  agents: string;
}

const trimSlash = (p: string) => p.replace(/\/+$/, "") || "/";

/** The memory folder for a config dir. Split out so it can be tested without a server. */
export function memoryPathsAt(configDir: string): MemoryPaths {
  const root = `${trimSlash(configDir)}/${MEMORY_DIR}`;
  return {
    root,
    context: `${root}/${CONTEXT_FILE}`,
    daily: `${root}/daily`,
    projects: `${root}/projects`,
    learnings: `${root}/learnings`,
    agents: `${root}/agents`,
  };
}

/** Where memory lives on the connected machine. */
export async function memoryRoot(client: OpenCode): Promise<string> {
  const { dir } = await configLocation(client);
  return memoryPathsAt(dir).root;
}

export async function memoryPaths(client: OpenCode): Promise<MemoryPaths> {
  const { dir } = await configLocation(client);
  return memoryPathsAt(dir);
}

// ---------------------------------------------------------------------------
// Global config: the instructions entry and the old plugin
// ---------------------------------------------------------------------------

type PluginEntry = string | { package?: string; options?: Record<string, unknown> };

/** True for any instruction that points at our context file, absolute or not. */
export function isContextInstruction(value: unknown): value is string {
  return typeof value === "string" && /(^|[\\/])memory[\\/]context\.md$/.test(value.trim());
}

/** Memory is on when a new session is told to read `memory/context.md`. */
export function memoryInstalled(cfg: GlobalConfig): boolean {
  return Array.isArray(cfg.instructions) && cfg.instructions.some(isContextInstruction);
}

/** Keeps every other instruction, replaces our entry with the absolute path, never duplicates it. */
export function withMemoryInstructions(cfg: GlobalConfig, contextPath: string): GlobalConfig {
  const list = Array.isArray(cfg.instructions) ? cfg.instructions.filter((v): v is string => typeof v === "string") : [];
  const others = list.filter((v) => !isContextInstruction(v));
  return { ...cfg, instructions: [...others, contextPath] };
}

/** Removes only our entry. Other instructions and the files stay. */
export function withoutMemoryInstructions(cfg: GlobalConfig): GlobalConfig {
  const next = { ...cfg };
  if (!Array.isArray(next.instructions)) return next;
  const kept = next.instructions.filter((v) => !isContextInstruction(v));
  if (kept.length) next.instructions = kept;
  else delete next.instructions;
  return next;
}

const isMemorySpec = (spec: unknown) => typeof spec === "string" && (spec === MEMORY_PLUGIN || spec.startsWith(`${MEMORY_PLUGIN}@`));
const isMemoryPluginEntry = (e: PluginEntry) => isMemorySpec(typeof e === "string" ? e : e?.package);

/** Removes every entry for the old plugin from either key OpenCode reads. */
export function withoutMemoryPlugin(cfg: GlobalConfig): GlobalConfig {
  const next = { ...cfg };
  for (const key of ["plugins", "plugin"] as const) {
    const list = next[key];
    if (!Array.isArray(list)) continue;
    const kept = (list as PluginEntry[]).filter((e) => !isMemoryPluginEntry(e));
    if (kept.length) next[key] = kept;
    else delete next[key];
  }
  return next;
}

// ---------------------------------------------------------------------------
// Templates and small pure helpers
// ---------------------------------------------------------------------------

/** A fresh context.md: the shape every session should keep. */
export function contextTemplate(): string {
  return [
    "<!-- Injected into every new session. Keep this under 40 lines; rewrite it, don't append. -->",
    "",
    "# Memory",
    "",
    "## Now",
    "",
    "## Next",
    "",
    "## Blocked",
    "",
    "## Decisions",
    "",
    "## Pointers",
    "",
  ].join("\n");
}

/** A fresh project file. */
export function projectTemplate(name: string): string {
  return [`# ${name}`, "", "## State", "", "## Decisions", "", "## Open threads", ""].join("\n");
}

/** Visible lines, ignoring one trailing newline. */
export function lineCount(text: string): number {
  if (!text) return 0;
  const lines = text.split("\n");
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

/** "Piper Chen" or "/home/me/projects/otto" → "piper-chen" / "otto". */
export function projectSlug(name: string): string {
  const base =
    name
      .trim()
      .replace(/\/+$/, "")
      .split("/")
      .pop() || "project";
  return (
    base
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/, "") || "project"
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Machine-local day for a daily file: YYYY-MM-DD. */
export function dayStamp(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** One line for a daily file: "- 14:05 what happened". Newlines collapse. */
export function formatDailyLine(text: string, date: Date = new Date()): string {
  const one = text.replace(/\s*\n\s*/g, " ").trim();
  return `- ${pad(date.getHours())}:${pad(date.getMinutes())} ${one}`;
}

/** Absolute path of a day's file, without checking the server. */
export function dailyPath(paths: Pick<MemoryPaths, "root">, date: Date = new Date()): string {
  return `${paths.root}/daily/${dayStamp(date)}.md`;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** POSIX-normalize a path: no `.` segments, repeated slashes collapsed. */
function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") throw new Error("That path leaves the memory folder.");
    parts.push(part);
  }
  return `${absolute ? "/" : ""}${parts.join("/")}`;
}

/**
 * Resolves a path the panel or an agent handed us against the memory root.
 * Throws for anything that leaves the folder, including `..` and absolute
 * paths outside it. Symlinks aren't resolved here: the file API is the
 * backstop, and agents only ever see the same folder.
 */
export function resolveMemoryPath(root: string, path: string): string {
  if (typeof path !== "string" || !path.trim()) throw new Error("Choose a memory file.");
  if (path.includes("\0")) throw new Error("That isn't a file path.");
  const cleanRoot = trimSlash(root);
  const raw = path.trim().replace(/\\/g, "/");
  if (raw.split("/").includes("..")) throw new Error("That path leaves the memory folder.");
  const full = normalizePath(raw.startsWith("/") ? raw : `${cleanRoot}/${raw}`);
  if (full === cleanRoot || !full.startsWith(`${cleanRoot}/`)) throw new Error("That path leaves the memory folder.");
  return full;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export type MemoryKind = "context" | "daily" | "project" | "learning" | "agent" | "other";

export interface MemoryFile {
  kind: MemoryKind;
  /** Display name: "context", "2026-10-22", "otto", "tauri-paths", "patch". */
  name: string;
  /** Absolute path on the machine. */
  path: string;
  size: number;
  /** Epoch milliseconds. */
  modified: number;
}

export interface MemoryState {
  root: string;
  /** context.md, or "" when it doesn't exist yet. */
  context: string;
  files: MemoryFile[];
}

/** Classify a path relative to the memory root. */
export function classifyMemoryPath(relative: string): { kind: MemoryKind; name: string } {
  const clean = relative.replace(/^\.?\//, "");
  if (clean === CONTEXT_FILE) return { kind: "context", name: "context" };
  const [dir, ...rest] = clean.split("/");
  const file = rest.join("/");
  const name = file.replace(/\.md$/i, "");
  if (!name) return { kind: "other", name: clean };
  switch (dir) {
    case "daily":
      return { kind: "daily", name };
    case "projects":
      return { kind: "project", name };
    case "learnings":
      return { kind: "learning", name };
    case "agents":
      return { kind: "agent", name };
    default:
      return { kind: "other", name: clean };
  }
}

async function readText(client: OpenCode, path: string): Promise<string | null> {
  try {
    return await client.readFile(path);
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

/** `find -printf` gives relative path, bytes and epoch seconds in one pass. */
function parseFindOutput(output: string, root: string): MemoryFile[] {
  const out: MemoryFile[] = [];
  for (const row of output.split("\n")) {
    if (!row) continue;
    const [relative, size, modified] = row.split("\t");
    if (!relative) continue;
    const { kind, name } = classifyMemoryPath(relative);
    out.push({
      kind,
      name,
      path: `${trimSlash(root)}/${relative}`,
      size: Number(size) || 0,
      modified: Math.round((Number(modified) || 0) * 1000),
    });
  }
  return out;
}

/** macOS `stat -f` fallback: absolute paths, bytes, epoch seconds. */
function parseStatOutput(output: string, root: string): MemoryFile[] {
  const prefix = `${trimSlash(root)}/`;
  const out: MemoryFile[] = [];
  for (const row of output.split("\n")) {
    if (!row) continue;
    const [absolute, size, modified] = row.split("\t");
    if (!absolute || !absolute.startsWith(prefix)) continue;
    const { kind, name } = classifyMemoryPath(absolute.slice(prefix.length));
    out.push({ kind, name, path: absolute, size: Number(size) || 0, modified: Math.round((Number(modified) || 0) * 1000) });
  }
  return out;
}

/** Every file under memory/, without reading any of them. */
export async function listMemoryFiles(client: OpenCode, root: string): Promise<MemoryFile[]> {
  const found = await client.exec(`find ${sh(root)} -type f -printf '%P\\t%s\\t%T@\\n' 2>/dev/null`, { timeoutMs: 20_000 }).catch(() => null);
  if (found && found.exit === 0 && found.output.trim()) return parseFindOutput(found.output, root);
  if (found && found.exit === 0) return [];
  // BSD find has no -printf (macOS). This is the basic fallback.
  const fallback = await client.exec(`find ${sh(root)} -type f -exec stat -f '%N\\t%z\\t%m' {} + 2>/dev/null`, { timeoutMs: 20_000 }).catch(() => null);
  if (!fallback || fallback.exit !== 0) return [];
  return parseStatOutput(fallback.output, root);
}

/** context.md and the file index, for the Memory panel. */
export async function readMemoryState(client: OpenCode): Promise<MemoryState> {
  const paths = await memoryPaths(client);
  const [context, files] = await Promise.all([readText(client, paths.context), listMemoryFiles(client, paths.root)]);
  return { root: paths.root, context: context ?? "", files };
}

export async function readMemoryFile(client: OpenCode, path: string): Promise<string> {
  const { root } = await memoryPaths(client);
  return (await readText(client, resolveMemoryPath(root, path))) ?? "";
}

export async function writeMemoryFile(client: OpenCode, path: string, text: string): Promise<string> {
  const { root } = await memoryPaths(client);
  const full = resolveMemoryPath(root, path);
  await client.writeFile(full, text);
  return full;
}

let chain: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

/**
 * Appends one line to today's (or `date`'s) daily file. Reads first so a
 * missing folder doesn't matter; keeps the line on one line.
 */
export function appendDaily(client: OpenCode, text: string, date: Date = new Date()): Promise<string> {
  return serial(async () => {
    const paths = await memoryPaths(client);
    const file = dailyPath(paths, date);
    const line = formatDailyLine(text, date);
    const existing = (await readText(client, file)) ?? "";
    const sep = existing && !existing.endsWith("\n") ? "\n" : "";
    await client.writeFile(file, `${existing}${sep}${line}\n`);
    return file;
  });
}

/** Creates `projects/<slug>.md` with the usual headings when it's missing. */
export function ensureProjectFile(client: OpenCode, name: string): Promise<string> {
  return serial(async () => {
    const paths = await memoryPaths(client);
    const slug = projectSlug(name);
    const file = `${paths.projects}/${slug}.md`;
    const existing = await readText(client, file);
    if (existing === null || !existing.trim()) await client.writeFile(file, projectTemplate(name.trim() || slug));
    return file;
  });
}

// ---------------------------------------------------------------------------
// Install and remove
// ---------------------------------------------------------------------------

/**
 * Turns memory on: creates the folder and a starter context.md (only when
 * missing), adds the absolute context path to the global instructions, and
 * removes the old plugin. Safe to call on every save; it never duplicates
 * anything and never touches a file that already has content.
 */
export async function installMemory(client: OpenCode): Promise<MemoryPaths> {
  const paths = await memoryPaths(client);
  await client.exec(`mkdir -p ${[paths.daily, paths.projects, paths.learnings, paths.agents].map(sh).join(" ")}`, { timeoutMs: 20_000 });
  const existing = await readText(client, paths.context);
  if (existing === null || !existing.trim()) await client.writeFile(paths.context, contextTemplate());
  await updateGlobalConfig(client, (cfg) => withMemoryInstructions(withoutMemoryPlugin(cfg), paths.context));
  return paths;
}

/** Turns memory off: removes our instruction and the old plugin, leaves every file. */
export async function removeMemory(client: OpenCode): Promise<void> {
  await updateGlobalConfig(client, (cfg) => withoutMemoryInstructions(withoutMemoryPlugin(cfg)));
}
