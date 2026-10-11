/**
 * Read–modify–write access to OpenCode's global config (opencode.json) and
 * config directory, done entirely through the server's own file API so it
 * works the same on a cloud sandbox and a local machine.
 *
 * OpenCode watches these files: a write is live within a moment, no restart.
 * Every update re-reads the file first so concurrent edits elsewhere
 * (another device, the TUI) are not clobbered.
 */
import type { OpenCode } from "./client";
import type { PermissionRule } from "../permissions";

export interface AgentConfig {
  model?: string | { providerID: string; model: string; variant?: string };
  system?: string;
  description?: string;
  mode?: "primary" | "subagent" | "all";
  hidden?: boolean;
  color?: string;
  steps?: number;
  disabled?: boolean;
  permissions?: PermissionRule[];
}

export interface CommandConfig {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subagent?: boolean;
}

export interface McpServerConfig {
  type: "local" | "remote";
  command?: string[];
  cwd?: string;
  environment?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  disabled?: boolean;
}

export interface GlobalConfig {
  $schema?: string;
  model?: string | { providerID: string; model: string; variant?: string };
  default_agent?: string;
  permissions?: PermissionRule[];
  agents?: Record<string, AgentConfig>;
  commands?: Record<string, CommandConfig>;
  mcp?: { servers?: Record<string, McpServerConfig>; [k: string]: unknown };
  skills?: string[];
  [k: string]: unknown;
}

export interface ConfigLocation {
  /** Global config file (may not exist yet). */
  file: string;
  /** Global config directory (agents/, skills/, commands/ live here). */
  dir: string;
}

const cache = new WeakMap<OpenCode, ConfigLocation>();

export async function configLocation(client: OpenCode): Promise<ConfigLocation> {
  const hit = cache.get(client);
  if (hit) return hit;
  const entries = await client.configEntries();
  const doc = entries.find((e) => e.type === "document" && e.path);
  const dirEntry = entries.find((e) => e.type === "directory");
  const dir = (doc?.path ? doc.path.replace(/\/[^/]+$/, "") : dirEntry?.path) ?? "";
  if (!dir) throw new Error("The server didn't report a config directory.");
  const loc = { file: doc?.path ?? `${dir}/opencode.json`, dir };
  cache.set(client, loc);
  return loc;
}

/** JSON with comments / trailing commas (opencode.jsonc) → object. */
function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += text[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

export async function readGlobalConfig(client: OpenCode): Promise<GlobalConfig> {
  const { file, dir } = await configLocation(client);
  try {
    const text = await client.readFile(file);
    if (!text.trim()) return {};
    return parseJsonc(text) as GlobalConfig;
  } catch (e) {
    if ((e as { status?: number }).status === 404) return {};
    // Fall back to the parsed copy the server already holds.
    const entries = await client.configEntries();
    const doc = entries.find((x) => x.type === "document" && x.path === file);
    if (doc && "info" in doc && doc.info) return doc.info as GlobalConfig;
    void dir;
    throw e;
  }
}

let writeChain: Promise<unknown> = Promise.resolve();

/** Serialized read → mutate → write of the global config. */
export function updateGlobalConfig(client: OpenCode, mutate: (cfg: GlobalConfig) => GlobalConfig | void): Promise<GlobalConfig> {
  const run = async () => {
    const { file } = await configLocation(client);
    const cfg = await readGlobalConfig(client);
    const next = (mutate(cfg) ?? cfg) as GlobalConfig;
    if (!next.$schema) next.$schema = "https://opencode.ai/config.json";
    await client.writeFile(file, JSON.stringify(next, null, 2) + "\n");
    // The watcher normally picks this up; reload makes it immediate.
    await client.reloadLocation().catch(() => {});
    return next;
  };
  const p = writeChain.then(run, run);
  writeChain = p.catch(() => {});
  return p;
}

export function modelRefToString(m: { providerID: string; id: string; variant?: string } | null | undefined): string | undefined {
  if (!m) return undefined;
  return `${m.providerID}/${m.id}${m.variant && m.variant !== "default" ? `#${m.variant}` : ""}`;
}

export function modelStringToRef(m: AgentConfig["model"]): { providerID: string; id: string; variant?: string } | null {
  if (!m) return null;
  if (typeof m === "object") return { providerID: m.providerID, id: m.model, variant: m.variant };
  const [main, variant] = m.split("#");
  const slash = main.indexOf("/");
  if (slash < 0) return null;
  return { providerID: main.slice(0, slash), id: main.slice(slash + 1), variant };
}

/** Quote a string for a POSIX shell. */
export function sh(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
