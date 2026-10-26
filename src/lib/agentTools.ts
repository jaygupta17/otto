/**
 * Otto's agent-facing tools are OpenCode file plugins, written onto the
 * machine in `~/.otto/agent-tool/<name>` and added to its global config as one
 * `{ package: "file://…" }` entry. This module is the part they share:
 * finding the home folder, writing a file only when its text changed, and
 * adding/removing exactly one config entry per tool.
 */
import type { OpenCode } from "./opencode/client";
import type { GlobalConfig } from "./opencode/config";

export type PluginEntry = string | { package?: string; options?: Record<string, unknown> };

/** Where a tool's package lives, under the machine's home. */
export function toolPluginDir(home: string, name: string): string {
  return `${home.replace(/\/$/, "")}/.otto/agent-tool/${name}`;
}

/** The package name folded into a config entry ("file:///…/agent-tool/otto-present"). */
function entryPath(e: PluginEntry): string | null {
  const spec = typeof e === "string" ? e : e?.package;
  return typeof spec === "string" ? spec.replace(/^file:\/\//, "").replace(/\/+$/, "") : null;
}

/** Whether a config entry points at this tool's folder. */
export function isToolEntry(e: PluginEntry, name: string): boolean {
  const path = entryPath(e);
  return !!path && path.endsWith(`/agent-tool/${name}`);
}

const entries = (cfg: GlobalConfig) => [cfg.plugins, cfg.plugin].flatMap((l) => (Array.isArray(l) ? (l as PluginEntry[]) : []));

/** Drop every copy of this tool's entry, including an old one under v1's `plugin` key. */
export function withoutToolPlugin(cfg: GlobalConfig, name: string): GlobalConfig {
  const next = { ...cfg };
  for (const key of ["plugins", "plugin"] as const) {
    const list = next[key];
    if (!Array.isArray(list)) continue;
    const kept = (list as PluginEntry[]).filter((e) => !isToolEntry(e, name));
    if (kept.length) next[key] = kept;
    else delete next[key];
  }
  return next;
}

/** One entry, pointing at the installed folder, under the key OpenCode 2 reads. */
export function withToolPlugin(cfg: GlobalConfig, dir: string, name: string): GlobalConfig {
  const next = withoutToolPlugin(cfg, name);
  const plugins = Array.isArray(next.plugins) ? (next.plugins as PluginEntry[]) : [];
  return { ...next, plugins: [...plugins, { package: `file://${dir}`, options: {} }] };
}

/** Exactly one entry, and it is this folder (an older copy elsewhere counts as not installed). */
export function toolPluginInstalled(cfg: GlobalConfig, dir: string, name: string): boolean {
  const mine = entries(cfg).filter((e) => isToolEntry(e, name));
  return mine.length === 1 && entryPath(mine[0]) === dir.replace(/\/+$/, "");
}

export async function readHome(client: OpenCode): Promise<string> {
  const r = await client.exec(`printf '%s\\n' "\${OTTO_HOME:-$HOME}"`);
  const home = r.output.trim().split("\n")[0];
  if (!home) throw new Error("The server didn't report a home folder.");
  return home;
}

/** Write a plugin file only when its text changed, so a reconnect doesn't reload it. */
export async function writeIfChanged(client: OpenCode, path: string, body: string): Promise<void> {
  try {
    if ((await client.readFile(path)) === body) return;
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
  await client.writeFile(path, body);
}

/** A plugin package's `package.json`, so OpenCode can load the file as a package. */
export function toolPackageJson(name: string): string {
  return JSON.stringify({ name, version: "1.0.0", private: true, type: "module", exports: "./index.js" }, null, 2) + "\n";
}
