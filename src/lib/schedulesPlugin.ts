/**
 * The agent-facing `otto_schedule` tool, generated as a self-contained
 * OpenCode file plugin.
 *
 * Why generated instead of imported: the plugin runs inside OpenCode on the
 * agent machine, where Otto's source is not installed. It needs the same
 * storage protocol as the app (rev, mkdir lock, temp+rename, crontab block,
 * runner), and it may only import `node:*` and `@opencode/plugin`. The runtime
 * below is plain ESM for exactly that reason; `schedulePluginSource()` wraps it
 * unchanged. Keep it in step with `lib/scheduleStore.ts` (tests cover both).
 *
 * Installed at `~/.otto/agent-tool/otto-schedule/{package.json,index.js}` and
 * added to the machine's global config as one
 * `{ package: "file://…/otto-schedule" }` entry.
 */
import type { OpenCode } from "./opencode/client";
import { readGlobalConfig, updateGlobalConfig, type GlobalConfig } from "./opencode/config";
import type { PermissionRule } from "./permissions";
import { readHome, toolPackageJson, toolPluginDir, toolPluginInstalled, withToolPlugin, withoutToolPlugin, writeIfChanged } from "./agentTools";

export const SCHEDULE_PLUGIN_ID = "otto.schedules";
/** Under `<home>/.otto`. */
export const SCHEDULE_PLUGIN_DIR = "agent-tool/otto-schedule";
/** The folder's name, as `agentTools` sees it. */
const SCHEDULE_PLUGIN_NAME = "otto-schedule";
export const SCHEDULE_PLUGIN_FILE = "index.js";
export const SCHEDULE_TOOL = "otto_schedule";

/** One entry, pointing at the installed folder, under the key OpenCode 2 reads. */
export function withSchedulePlugin(cfg: GlobalConfig, dir: string): GlobalConfig {
  return withToolPlugin(cfg, dir, SCHEDULE_PLUGIN_NAME);
}

/** Drops every copy, including an old entry under the v1 `plugin` key. */
export function withoutSchedulePlugin(cfg: GlobalConfig): GlobalConfig {
  return withoutToolPlugin(cfg, SCHEDULE_PLUGIN_NAME);
}

export function schedulePluginInstalled(cfg: GlobalConfig, dir: string): boolean {
  return toolPluginInstalled(cfg, dir, SCHEDULE_PLUGIN_NAME);
}

/**
 * Defaults for the tool's four permission actions, only where the user has no
 * rule for that action yet. Read/run are safe; writes and deletes ask. Added
 * to the global config's rule list so the permission editor shows them and
 * OpenCode enforces them (unknown actions would otherwise fall through to
 * OpenCode's blanket allow).
 */
export const SCHEDULE_PERMISSION_DEFAULTS: { action: string; resource: string; effect: PermissionRule["effect"] }[] = [
  { action: "otto_schedule.read", resource: "*", effect: "allow" },
  { action: "otto_schedule.run", resource: "*", effect: "allow" },
  { action: "otto_schedule.write", resource: "*", effect: "ask" },
  { action: "otto_schedule.delete", resource: "*", effect: "ask" },
];

export function withSchedulePermissions(cfg: GlobalConfig): GlobalConfig {
  const have = new Set((cfg.permissions ?? []).filter((r) => r.resource === "*").map((r) => r.action));
  const add = SCHEDULE_PERMISSION_DEFAULTS.filter((r) => !have.has(r.action));
  if (!add.length) return cfg;
  return { ...cfg, permissions: [...(cfg.permissions ?? []), ...add] };
}

export function schedulePluginPackageJson(): string {
  return toolPackageJson(SCHEDULE_PLUGIN_NAME);
}

let source: string | null = null;
/** The generated `index.js` (same text for every machine). */
export function schedulePluginSource(): string {
  source ??= RUNTIME;
  return source;
}

let dirCache = new WeakMap<OpenCode, string>();
export function schedulePluginDir(home: string): string {
  return toolPluginDir(home, SCHEDULE_PLUGIN_NAME);
}

const installed = new WeakMap<OpenCode, Promise<string>>();

/**
 * Write the plugin files and add exactly one config entry. Safe to call on
 * every Schedules view open: files are only rewritten when their text changes
 * and an existing entry is replaced, never duplicated.
 */
export function ensureSchedulePlugin(client: OpenCode): Promise<string> {
  const hit = installed.get(client);
  if (hit) return hit;
  const pending = (async () => {
    const dir = schedulePluginDir(await readHome(client));
    dirCache.set(client, dir);
    await writeIfChanged(client, `${dir}/package.json`, schedulePluginPackageJson());
    await writeIfChanged(client, `${dir}/${SCHEDULE_PLUGIN_FILE}`, schedulePluginSource());
    // Only write the config when something is actually missing, so opening
    // Schedules does not reload the plugin on every visit. Permission defaults
    // are written on the first install and left alone afterwards (a rule the
    // user deleted stays deleted).
    if (!schedulePluginInstalled(await readGlobalConfig(client), dir)) {
      await updateGlobalConfig(client, (cfg) => withSchedulePermissions(withSchedulePlugin(cfg, dir)));
    }
    return dir;
  })();
  installed.set(client, pending);
  pending.catch(() => installed.delete(client));
  return pending;
}

/** Remove our config entry (the files stay, so reinstalling is instant). */
export async function removeSchedulePlugin(client: OpenCode): Promise<void> {
  installed.delete(client);
  dirCache.delete(client);
  await updateGlobalConfig(client, withoutSchedulePlugin);
}

/** Where it is installed, once `ensureSchedulePlugin` has run. */
export function installedSchedulePluginDir(client: OpenCode): string | null {
  return dirCache.get(client) ?? null;
}

const RUNTIME = `// Generated by Otto. Do not edit: Otto writes this file from src/lib/schedulesPlugin.ts.
//
// Agent-facing schedule tool. It speaks the same file protocol as the app:
// \`{ version: 2, rev, schedules }\` under ~/.otto, a mkdir lock, a temp+rename
// write, a per-task runner lock, and a crontab block Otto owns.
//
// Loaded by OpenCode as a file plugin. Imports stay inside node:* and
// @opencode/plugin so it runs on a bare machine.
import { Plugin } from "@opencode/plugin";
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const run = promisify(execFile);

export const SCHEDULE_VERSION = 2;
export const CRON_BEGIN = "# >>> otto schedules (managed by Otto; edit in the app) >>>";
export const CRON_END = "# <<< otto schedules <<<";
const STALE_LOCK_MS = 30000;
const LOCK_RETRIES = 50;
const LOCK_WAIT_MS = 100;
const MAX_BUFFER = 4 * 1024 * 1024;

export const RUNNER_SCRIPT = [
  "#!/usr/bin/env bash",
  "# otto-run <id> - start a scheduled agent session. Installed by Otto; safe to delete.",
  "set -u",
  "DIR=$OTTO_DIR",
  '[ -n "$DIR" ] || DIR=$HOME/.otto',
  "ID=\${1:?task id}",
  'if [ -z "\${OTTO_TIMEOUT:-}" ] && command -v timeout >/dev/null 2>&1; then',
  "  export OTTO_TIMEOUT=1",
  '  exec timeout 1800 "$0" "$@"',
  "fi",
  '[ -f "$DIR/server.env" ] || exit 1',
  '. "$DIR/server.env"',
  '[ -f "$DIR/tasks/$ID.prompt.json" ] || exit 0',
  'mkdir -p "$DIR/logs" "$DIR/state"',
  'LOG="$DIR/logs/$ID.log"',
  'STATE="$DIR/state/$ID.json"',
  "ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }",
  "now_ms() { echo $(($(date +%s) * 1000)); }",
  'record() { printf \\'%s\\' "$1" > "$STATE.tmp" && mv -f "$STATE.tmp" "$STATE"; }',
  'fail() { echo "$(ts) error $1" >> "$LOG"; record "{\\\\"at\\\\":$(now_ms),\\\\"ok\\\\":false,\\\\"error\\\\":\\\\"$1\\\\"}"; exit 1; }',
  'LOCK="$DIR/tasks/$ID.lock"',
  'if ! mkdir "$LOCK" 2>/dev/null; then',
  '  if find "$LOCK" -prune -mmin +30 2>/dev/null | grep -q .; then',
  '    rm -rf "$LOCK"',
  '    mkdir "$LOCK" 2>/dev/null || exit 0',
  "  else",
  '    echo "$(ts) skipped-running" >> "$LOG"',
  "    exit 0",
  "  fi",
  "fi",
  "trap 'rm -rf \\"$LOCK\\"' EXIT",
  'AUTH="opencode:$OTTO_PASSWORD"',
  'SES=$(curl -fsS --max-time 30 -u "$AUTH" -H \\'content-type: application/json\\' --data-binary @"$DIR/tasks/$ID.session.json" "$OTTO_URL/api/session" 2>&1) || fail could-not-create-session',
  'SID=$(printf \\'%s\\' "$SES" | grep -o \\'"id":"ses[^"]*"\\' | head -1 | cut -d\\'"\\' -f4)',
  '[ -n "$SID" ] || fail bad-session-response',
  'curl -fsS --max-time 30 -u "$AUTH" -H \\'content-type: application/json\\' --data-binary @"$DIR/tasks/$ID.prompt.json" "$OTTO_URL/api/session/$SID/prompt" >/dev/null 2>&1 || fail prompt-failed',
  'echo "$(ts) ok $SID" >> "$LOG"',
  'record "{\\\\"at\\\\":$(now_ms),\\\\"ok\\\\":true,\\\\"sessionID\\\\":\\\\"$SID\\\\"}"',
  'tail -n 40 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"',
  "",
].join("\\n");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const trimEnd = (s) => String(s).replace(/\\n+$/, "");
const isRecord = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : undefined);
const int = (v, min, max) => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined);

export function scheduleDir(env) {
  const e = env || process.env;
  const home = e.OTTO_HOME || e.HOME || homedir();
  return join(home, ".otto");
}

function shellQuote(s) {
  return "'" + String(s).replace(/'/g, "'\\\\''") + "'";
}

// ---------------------------------------------------------------------------
// Cron
// ---------------------------------------------------------------------------

export function parseField(expr, min, max) {
  const out = new Set();
  for (const part of String(expr).split(",")) {
    const m = /^(\\*|\\d+(?:-\\d+)?)(?:\\/(\\d+))?$/.exec(part.trim());
    if (!m) return null;
    let lo = min;
    let hi = max;
    if (m[1] !== "*") {
      const bits = m[1].split("-").map(Number);
      lo = bits[0];
      hi = bits[1] === undefined ? (m[2] ? max : bits[0]) : bits[1];
    }
    const step = m[2] ? Number(m[2]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) return null;
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && max === 7 ? 0 : v);
  }
  return out;
}

export function validCron(cron) {
  const f = String(cron).trim().split(/\\s+/);
  if (f.length !== 5) return false;
  return !!(parseField(f[0], 0, 59) && parseField(f[1], 0, 23) && parseField(f[2], 1, 31) && parseField(f[3], 1, 12) && parseField(f[4], 0, 7));
}

function validFrequency(f) {
  if (!isRecord(f)) return false;
  const hour = int(f.hour, 0, 23);
  const minute = int(f.minute, 0, 59);
  switch (f.kind) {
    case "hourly":
      return int(f.minute, 0, 59) !== undefined;
    case "daily":
    case "weekdays":
      return hour !== undefined && minute !== undefined;
    case "weekly":
      return hour !== undefined && minute !== undefined && Array.isArray(f.days) && f.days.length > 0 && f.days.every((d) => int(d, 0, 6) !== undefined);
    case "custom":
      return typeof f.cron === "string" && validCron(f.cron);
    default:
      return false;
  }
}

function normalizeFrequency(f) {
  switch (f.kind) {
    case "hourly":
      return { kind: "hourly", minute: f.minute };
    case "daily":
      return { kind: "daily", hour: f.hour, minute: f.minute };
    case "weekdays":
      return { kind: "weekdays", hour: f.hour, minute: f.minute };
    case "weekly":
      return { kind: "weekly", days: Array.from(new Set(f.days)).sort((a, b) => a - b), hour: f.hour, minute: f.minute };
    default:
      return { kind: "custom", cron: String(f.cron).trim().replace(/\\s+/g, " ") };
  }
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const clock = (h, m) => String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");

export function describeFrequency(f) {
  switch (f.kind) {
    case "hourly":
      return f.minute === 0 ? "Every hour" : "Every hour at :" + String(f.minute).padStart(2, "0");
    case "daily":
      return "Every day at " + clock(f.hour, f.minute);
    case "weekdays":
      return "Weekdays at " + clock(f.hour, f.minute);
    case "weekly":
      return (f.days.length === 7 ? "Every day" : f.days.map((d) => DAY[d]).join(", ")) + " at " + clock(f.hour, f.minute);
    default:
      return "Cron: " + f.cron;
  }
}

/**
 * Frequency to a cron line in machine wall time. The tool runs on the machine
 * that runs cron, so no offset conversion is needed here (unlike the app,
 * which may be in another zone).
 */
export function toCron(f) {
  switch (f.kind) {
    case "hourly":
      return f.minute + " * * * *";
    case "daily":
      return f.minute + " " + f.hour + " * * *";
    case "weekdays":
      return f.minute + " " + f.hour + " * * 1,2,3,4,5";
    case "weekly":
      return f.minute + " " + f.hour + " * * " + (f.days.length ? f.days.join(",") : "1");
    default:
      return f.cron;
  }
}

export function cronBlock(schedules, dir) {
  const lines = schedules
    .filter((s) => s.enabled)
    .map((s) => toCron(s.frequency) + " OTTO_DIR=" + shellQuote(dir) + " " + shellQuote(join(dir, "bin", "otto-run")) + " " + s.id + " >/dev/null 2>&1");
  return [CRON_BEGIN].concat(lines, [CRON_END]).join("\\n");
}

export function replaceCronBlock(text, block) {
  const out = [];
  let inside = false;
  for (const line of String(text || "").split("\\n")) {
    if (line.trim() === CRON_BEGIN) {
      inside = true;
      continue;
    }
    if (inside) {
      if (line.trim() === CRON_END) inside = false;
      continue;
    }
    out.push(line);
  }
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  for (const line of block.split("\\n")) out.push(line);
  return out.join("\\n") + "\\n";
}

// ---------------------------------------------------------------------------
// File shape
// ---------------------------------------------------------------------------

function normalizeRun(value) {
  if (!isRecord(value)) return null;
  if (typeof value.at !== "number" || !Number.isFinite(value.at) || typeof value.ok !== "boolean") return null;
  const out = { at: value.at, ok: value.ok };
  if (str(value.sessionID)) out.sessionID = value.sessionID;
  if (str(value.error)) out.error = value.error;
  return out;
}

function normalizeSchedule(value) {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const name = str(value.name);
  const prompt = str(value.prompt);
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || !name || prompt === undefined || !validFrequency(value.frequency)) return null;
  const s = {
    id,
    name: name.trim(),
    prompt,
    frequency: normalizeFrequency(value.frequency),
    enabled: value.enabled !== false,
    createdAt: typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
  };
  if (str(value.directory)) s.directory = value.directory;
  if (str(value.agent)) s.agent = value.agent;
  if (isRecord(value.model) && str(value.model.providerID) && str(value.model.id)) {
    s.model = { providerID: value.model.providerID, id: value.model.id };
    if (str(value.model.variant)) s.model.variant = value.model.variant;
  }
  if (value.createdBy === "user" || (str(value.createdBy) || "").startsWith("agent:")) s.createdBy = value.createdBy;
  if (str(value.createdByAgent)) s.createdByAgent = value.createdByAgent;
  if (str(value.timezone)) s.timezone = value.timezone;
  const lastRun = normalizeRun(value.lastRun);
  if (lastRun) s.lastRun = lastRun;
  return s;
}

export function normalizeSchedules(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const s = normalizeSchedule(item);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

export function parseSchedules(text) {
  if (text === null || text === undefined || !String(text).trim()) return { schedules: [], rev: 0, legacy: false };
  let raw;
  try {
    raw = JSON.parse(String(text));
  } catch {
    throw new Error("schedules.json is not valid JSON; fix it in the app before adding schedules.");
  }
  const legacy = Array.isArray(raw) || (isRecord(raw) && raw.version !== SCHEDULE_VERSION);
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? raw.schedules : [];
  const rev = isRecord(raw) ? int(raw.rev, 0, Number.MAX_SAFE_INTEGER) || 0 : 0;
  return { schedules: normalizeSchedules(list), rev, legacy };
}

export function serializeSchedules(schedules, rev) {
  return JSON.stringify({ version: SCHEDULE_VERSION, rev, schedules }, null, 2) + "\\n";
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Same protocol as the app's ScheduleStore (src/lib/scheduleStore.ts), local
 * to this machine. \`options.dir\` and \`options.env\` let tests point it elsewhere.
 */
export function createScheduleStore(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const dir = opts.dir || scheduleDir(env);
  const file = join(dir, "schedules.json");
  const now = opts.now || (() => Date.now());

  async function readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch (e) {
      if (e && e.code === "ENOENT") return null;
      throw e;
    }
  }

  async function readCurrent(mergeRuns) {
    const data = parseSchedules(await readText(file));
    if (!mergeRuns || !data.schedules.length) return data;
    return { ...data, schedules: await withRuns(data.schedules) };
  }

  async function readRunStates(ids) {
    const out = {};
    await Promise.all(
      ids.map(async (id) => {
        const body = await readText(join(dir, "state", id + ".json"));
        if (!body) return;
        try {
          const record = normalizeRun(JSON.parse(body));
          if (record) out[id] = record;
        } catch {
          /* a half-written state file is not worth failing a load */
        }
      }),
    );
    return out;
  }

  async function withRuns(schedules) {
    const states = await readRunStates(schedules.map((s) => s.id)).catch(() => ({}));
    return schedules.map((s) => {
      const record = states[s.id];
      return record && (!s.lastRun || record.at > s.lastRun.at) ? { ...s, lastRun: record } : s;
    });
  }

  async function acquireLock() {
    const lock = join(dir, "schedules.lock");
    await mkdir(dir, { recursive: true });
    for (let i = 0; i < LOCK_RETRIES; i++) {
      try {
        await mkdir(lock);
        return lock;
      } catch (e) {
        if (!e || e.code !== "EEXIST") throw e;
        let mtime = null;
        try {
          mtime = (await stat(lock)).mtimeMs;
        } catch {
          continue;
        }
        if (mtime !== null && now() - mtime > STALE_LOCK_MS) {
          await rm(lock, { recursive: true, force: true }).catch(() => {});
          continue;
        }
        await sleep(LOCK_WAIT_MS);
      }
    }
    throw new Error("Another schedule change is still in progress. Try again in a moment.");
  }

  async function withLock(fn) {
    const lock = await acquireLock();
    try {
      return await fn();
    } finally {
      await rm(lock, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function readCrontab() {
    const bin = env.OTTO_CRONTAB || "crontab";
    try {
      const out = await run(bin, ["-l"], { maxBuffer: MAX_BUFFER, env });
      return { ok: true, content: trimEnd(out.stdout) };
    } catch (e) {
      const code = e && e.code;
      if (code === "ENOENT") return { ok: false, reason: "missing" };
      const message = trimEnd((e && e.stderr) || "") || (e && e.message) || "crontab -l failed";
      if (/no crontab/i.test(message)) return { ok: true, content: "" };
      return { ok: false, reason: "failed", message: String(message).slice(0, 200) };
    }
  }

  async function writeCrontab(text) {
    const bin = env.OTTO_CRONTAB || "crontab";
    const tmp = join(dir, ".crontab.next");
    await writeFile(tmp, text);
    try {
      await run(bin, [tmp], { maxBuffer: MAX_BUFFER, env });
    } finally {
      await rm(tmp, { force: true }).catch(() => {});
    }
  }

  async function writeRunner() {
    const runner = join(dir, "bin", "otto-run");
    await mkdir(join(dir, "bin"), { recursive: true });
    await writeFile(runner, RUNNER_SCRIPT);
    await chmod(runner, 0o755);
  }

  async function writeCredentials(creds) {
    await mkdir(dir, { recursive: true });
    const body = "OTTO_URL=" + shellQuote(creds.localUrl) + "\\nOTTO_PASSWORD=" + shellQuote(creds.password) + "\\n";
    await writeFile(join(dir, "server.env"), body);
    await chmod(join(dir, "server.env"), 0o600);
  }

  async function writeTask(s) {
    await mkdir(join(dir, "tasks"), { recursive: true });
    const session = { title: "Scheduled: " + s.name };
    if (s.directory) session.location = { directory: s.directory };
    if (s.agent) session.agent = s.agent;
    if (s.model) session.model = s.model;
    await writeFile(join(dir, "tasks", s.id + ".session.json"), JSON.stringify(session));
    await writeFile(join(dir, "tasks", s.id + ".prompt.json"), JSON.stringify({ text: s.prompt }));
  }

  async function prune(keep) {
    const ids = new Set(keep);
    for (const sub of ["tasks", "logs", "state"]) {
      let names = [];
      try {
        names = await readdir(join(dir, sub));
      } catch {
        continue;
      }
      await Promise.all(
        names.map((name) => {
          const id = name.split(".")[0];
          if (ids.has(id)) return Promise.resolve();
          return rm(join(dir, sub, name), { force: true }).catch(() => {});
        }),
      );
    }
  }

  async function installCron(schedules) {
    const current = await readCrontab();
    if (!current.ok) {
      return [current.reason === "missing" ? "cron-missing" : "cron-failed: " + (current.message || "crontab refused the change")];
    }
    try {
      await writeCrontab(replaceCronBlock(current.content, cronBlock(schedules, dir)));
      return [];
    } catch (e) {
      return ["cron-failed: " + ((e && e.message) || "crontab refused the change")];
    }
  }

  async function transact(mutate, options2) {
    const settings = options2 || {};
    return withLock(async () => {
      const current = await readCurrent(true);
      if (settings.baseRev !== undefined && current.rev !== settings.baseRev) {
        const schedules = await withRuns(current.schedules);
        const error = new Error("Schedules changed elsewhere (this call saw rev " + settings.baseRev + ", the machine has " + current.rev + ").");
        error.name = "StaleScheduleError";
        error.stale = true;
        error.expected = settings.baseRev;
        error.current = current.rev;
        error.schedules = schedules;
        throw error;
      }
      const draft = mutate(current.schedules.map((s) => ({ ...s })));
      const next = normalizeSchedules(draft.schedules);
      const rev = current.rev + 1;
      await writeRunner();
      if (settings.creds) await writeCredentials(settings.creds);
      for (const s of next) await writeTask(s);
      const tmp = file + ".tmp-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      await writeFile(tmp, serializeSchedules(next, rev));
      await rename(tmp, file);
      const warnings = await installCron(next);
      await prune(next.map((s) => s.id)).catch(() => {});
      return { schedules: next, rev, result: draft.result, warnings };
    });
  }

  async function load() {
    return readCurrent(true);
  }

  function upsert(schedule, baseRev, creds) {
    return transact(
      (schedules) => {
        const exists = schedules.some((s) => s.id === schedule.id);
        return { schedules: exists ? schedules.map((s) => (s.id === schedule.id ? schedule : s)) : schedules.concat([schedule]), result: schedule };
      },
      { baseRev, creds },
    );
  }

  function remove(id, baseRev, creds) {
    return transact(
      (schedules) => {
        if (!schedules.some((s) => s.id === id)) throw new Error("No schedule " + id + ".");
        return { schedules: schedules.filter((s) => s.id !== id), result: id };
      },
      { baseRev, creds },
    );
  }

  function setEnabled(id, enabled, baseRev, creds) {
    return transact(
      (schedules) => {
        if (!schedules.some((s) => s.id === id)) throw new Error("No schedule " + id + ".");
        return { schedules: schedules.map((s) => (s.id === id ? { ...s, enabled } : s)), result: id };
      },
      { baseRev, creds },
    );
  }

  function patch(id, fields, settings) {
    return transact(
      (schedules) => {
        const before = schedules.find((s) => s.id === id);
        if (!before) throw new Error("No schedule " + id + ".");
        const after = { ...before, ...fields, id };
        return { schedules: schedules.map((s) => (s.id === id ? after : s)), result: after };
      },
      settings,
    );
  }

  async function readRunState(id) {
    const body = await readText(join(dir, "state", id + ".json"));
    if (!body) return null;
    try {
      return normalizeRun(JSON.parse(body));
    } catch {
      return null;
    }
  }

  async function runTask(id) {
    const runner = join(dir, "bin", "otto-run");
    await run(runner, [id], { env: { ...env, OTTO_DIR: dir }, timeout: 120000, maxBuffer: MAX_BUFFER }).catch(() => {});
    return readRunState(id);
  }

  async function runNow(id, creds) {
    const data = await load();
    if (!data.schedules.some((s) => s.id === id)) throw new Error("No schedule " + id + ".");
    if (creds) await writeCredentials(creds);
    try {
      await stat(join(dir, "server.env"));
    } catch {
      throw new Error("The schedule runner isn't installed yet. Open Schedules in the Otto app once on this machine, then try again.");
    }
    const record = await runTask(id);
    if (!record) return { run: null, schedules: data.schedules, rev: data.rev };
    try {
      const saved = await transact(
        (schedules) => {
          if (!schedules.some((s) => s.id === id)) return { schedules, result: schedules };
          return { schedules: schedules.map((s) => (s.id === id ? { ...s, lastRun: record } : s)), result: schedules };
        },
        { creds },
      );
      return { run: record, schedules: saved.schedules, rev: saved.rev };
    } catch {
      return { run: record, schedules: data.schedules, rev: data.rev };
    }
  }

  async function probeCron() {
    const current = await readCrontab();
    if (current.ok) return { hasCron: true };
    return { hasCron: false, message: current.reason === "missing" ? "This machine has no crontab command, so schedules can't run here." : current.message };
  }

  async function install(creds) {
    return withLock(async () => {
      const current = await readCurrent(true);
      await writeRunner();
      if (creds) await writeCredentials(creds);
      for (const s of current.schedules) await writeTask(s);
      const warnings = await installCron(current.schedules);
      await prune(current.schedules.map((s) => s.id)).catch(() => {});
      return { rev: current.rev, schedules: current.schedules, warnings };
    });
  }

  return { dir, file, load, transact, upsert, remove, setEnabled, patch, runNow, install, probeCron };
}

// ---------------------------------------------------------------------------
// The tool
// ---------------------------------------------------------------------------

export const TOOL_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["list", "create", "update", "setEnabled", "delete", "run"], description: "What to do." },
    id: { type: "string", description: "Schedule id (from list). Required for update, setEnabled, delete and run." },
    name: { type: "string", description: "Short human name, e.g. Morning standup." },
    prompt: { type: "string", description: "What the agent should do when the schedule fires." },
    frequency: {
      type: "object",
      description: "When to run, in this machine's local time.",
      properties: {
        kind: { type: "string", enum: ["hourly", "daily", "weekdays", "weekly", "custom"] },
        minute: { type: "integer", minimum: 0, maximum: 59 },
        hour: { type: "integer", minimum: 0, maximum: 23 },
        days: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "For weekly: 0 Sunday to 6 Saturday." },
        cron: { type: "string", description: "For custom: 5-field cron (m h dom mon dow)." },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    directory: { type: "string", description: "Project folder for the session. Defaults to the current project." },
    agent: { type: "string", description: "Agent id to run as. Defaults to the configured default." },
    model: { type: "string", description: "Provider/model, e.g. anthropic/claude-sonnet-4-5." },
    enabled: { type: "boolean", description: "Pause (false) or resume (true). Defaults to true on create." },
    timezone: { type: "string", description: "IANA zone. Only this machine's zone is supported today; pass it to have a mismatch rejected." },
    rev: { type: "integer", description: "The rev from list. Pass it on update/delete so a human's newer edit is not overwritten." },
  },
  required: ["action"],
  additionalProperties: false,
};

function parseFrequency(input) {
  if (!isRecord(input)) throw new Error("frequency is required: {kind: hourly|daily|weekdays|weekly|custom, minute, hour, days, cron}.");
  const num = (v, min, max, name, fallback) => {
    const n = v === undefined ? fallback : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new Error(name + " must be an integer " + min + "-" + max + ".");
    return n;
  };
  switch (input.kind) {
    case "hourly":
      return { kind: "hourly", minute: num(input.minute, 0, 59, "frequency.minute", 0) };
    case "daily":
    case "weekdays":
      return { kind: input.kind, hour: num(input.hour, 0, 23, "frequency.hour"), minute: num(input.minute, 0, 59, "frequency.minute", 0) };
    case "weekly": {
      const days = input.days;
      if (!Array.isArray(days) || !days.length) throw new Error("frequency.days is required for weekly (0 Sunday to 6 Saturday).");
      return {
        kind: "weekly",
        days: Array.from(new Set(days.map((d) => num(d, 0, 6, "frequency.days")))).sort((a, b) => a - b),
        hour: num(input.hour, 0, 23, "frequency.hour"),
        minute: num(input.minute, 0, 59, "frequency.minute", 0),
      };
    }
    case "custom": {
      const cron = String(input.cron || "").trim().replace(/\\s+/g, " ");
      if (!validCron(cron)) throw new Error("frequency.cron must be a valid 5-field cron expression.");
      return { kind: "custom", cron };
    }
    default:
      throw new Error("frequency.kind must be hourly, daily, weekdays, weekly or custom.");
  }
}

function parseModel(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error('model must be a "provider/id" string.');
  const hash = value.indexOf("#");
  const main = hash < 0 ? value : value.slice(0, hash);
  const variant = hash < 0 ? undefined : value.slice(hash + 1);
  const slash = main.indexOf("/");
  if (slash < 1 || slash === main.length - 1) throw new Error('model must look like "provider/id".');
  const model = { providerID: main.slice(0, slash), id: main.slice(slash + 1) };
  if (variant) model.variant = variant;
  return model;
}

function checkTimezone(value) {
  if (value === undefined) return;
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (String(value) !== here) {
    throw new Error("timezone " + value + " is not this machine's zone (" + here + "). Per-schedule timezones aren't supported yet; schedule in " + here + ".");
  }
}

function compact(s) {
  return {
    id: s.id,
    name: s.name,
    prompt: s.prompt,
    frequency: s.frequency,
    when: describeFrequency(s.frequency),
    enabled: s.enabled,
    directory: s.directory,
    agent: s.agent,
    model: s.model ? s.model.providerID + "/" + s.model.id + (s.model.variant ? "#" + s.model.variant : "") : undefined,
    createdBy: s.createdBy,
    createdByAgent: s.createdByAgent,
    lastRun: s.lastRun,
  };
}

function newId() {
  return "sch_" + randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Run one action. The caller checks permission first; this does the work. */
export async function dispatch(store, input, context) {
  const action = input.action;
  if (action === "list") {
    const data = await store.load();
    return { rev: data.rev, schedules: data.schedules.map(compact) };
  }
  if (action === "create") {
    if (str(input.id) && !/^[A-Za-z0-9_-]{1,64}$/.test(input.id)) throw new Error("id can only use letters, digits, _ and -.");
    if (!str(input.name) || !str(input.name).trim()) throw new Error("name is required to create a schedule.");
    if (!str(input.prompt) || !str(input.prompt).trim()) throw new Error("prompt is required to create a schedule.");
    checkTimezone(input.timezone);
    const schedule = {
      id: str(input.id) || newId(),
      name: input.name.trim(),
      prompt: input.prompt.trim(),
      frequency: parseFrequency(input.frequency),
      enabled: input.enabled !== false,
      createdAt: Date.now(),
      createdBy: "agent:" + (context && context.sessionID ? context.sessionID : "unknown"),
    };
    if (context && context.agent) schedule.createdByAgent = String(context.agent);
    if (str(input.directory)) schedule.directory = input.directory;
    if (str(input.agent)) schedule.agent = input.agent;
    const model = parseModel(input.model);
    if (model) schedule.model = model;
    const out = await store.upsert(schedule, input.rev);
    return { rev: out.rev, schedule: compact(schedule), warnings: out.warnings };
  }
  if (!str(input.id)) throw new Error("id is required for " + action + ".");
  if (action === "update") {
    checkTimezone(input.timezone);
    const fields = {};
    if (input.name !== undefined) {
      if (!str(input.name) || !input.name.trim()) throw new Error("name can't be empty.");
      fields.name = input.name.trim();
    }
    if (input.prompt !== undefined) {
      if (!str(input.prompt) || !input.prompt.trim()) throw new Error("prompt can't be empty.");
      fields.prompt = input.prompt.trim();
    }
    if (input.frequency !== undefined) fields.frequency = parseFrequency(input.frequency);
    if (input.directory !== undefined) fields.directory = str(input.directory) || undefined;
    if (input.agent !== undefined) fields.agent = str(input.agent) || undefined;
    if (input.model !== undefined) fields.model = parseModel(input.model);
    if (input.enabled !== undefined) fields.enabled = input.enabled === true;
    if (!Object.keys(fields).length) throw new Error("update needs at least one of name, prompt, frequency, directory, agent, model, enabled.");
    const out = await store.patch(input.id, fields, { baseRev: input.rev });
    return { rev: out.rev, schedule: compact(out.result), warnings: out.warnings };
  }
  if (action === "setEnabled") {
    if (typeof input.enabled !== "boolean") throw new Error("enabled (true or false) is required.");
    const out = await store.setEnabled(input.id, input.enabled, input.rev);
    const schedule = out.schedules.find((s) => s.id === input.id);
    return { rev: out.rev, schedule: schedule ? compact(schedule) : undefined, warnings: out.warnings };
  }
  if (action === "delete") {
    const out = await store.remove(input.id, input.rev);
    return { rev: out.rev, deleted: input.id, warnings: out.warnings };
  }
  if (action === "run") {
    const out = await store.runNow(input.id);
    return { rev: out.rev, run: out.run, message: out.run ? undefined : "The runner left no result: it may already be running, or the local API refused it." };
  }
  throw new Error("Unknown action " + action + ". Use list, create, update, setEnabled, delete or run.");
}

const PERMISSION = { list: "read", create: "write", update: "write", setEnabled: "write", delete: "delete", run: "run" };

/** The permission action a tool call maps to (\`otto_schedule.read\`, …). */
export function permissionAction(input) {
  const action = input && input.action;
  const permission = PERMISSION[action];
  if (!permission) throw new Error("Unknown action " + action + ". Use list, create, update, setEnabled, delete or run.");
  return "otto_schedule." + permission;
}

/** Turn a thrown store error into compact JSON the model can act on. */
function failure(e) {
  if (e && e.stale) return { stale: true, rev: e.current, schedules: (e.schedules || []).map(compact), message: e.message };
  return { error: "failed", message: (e && e.message) || String(e) };
}

/**
 * One tool call: map the action to a permission, ask, run it, and turn store
 * errors into JSON the model can act on. A permission rejection propagates.
 */
export async function callTool(store, input, context, assertPermission) {
  let permission;
  try {
    permission = permissionAction(input);
  } catch (e) {
    return failure(e);
  }
  const target = input.id || input.name || "*";
  await assertPermission(permission, target);
  try {
    return await dispatch(store, input, context);
  } catch (e) {
    return failure(e);
  }
}

function makeTool(ctx, store) {
  return {
    name: "otto_schedule",
    description:
      "Manage Otto's scheduled agent runs on this machine. A schedule starts a new agent session with a prompt on a cron-like timetable, even when the Otto app is closed (as long as the machine is awake; missed runs are not caught up). Times are this machine's local time. Use list to see ids and the current rev; pass that rev on update/delete so a newer change made in the app is not overwritten (a {stale:true} answer means: call list again and retry).",
    input: TOOL_SCHEMA,
    options: { codemode: false },
    execute: async (input, context) => {
      const action = input && input.action;
      // A deny or a rejection must reach the model as a failed tool call, so
      // callTool lets it propagate rather than folding it into the JSON.
      const result = await callTool(store, input, context, (permission, resource) =>
        ctx.permission.assert({
          sessionID: context.sessionID,
          agent: context.agent,
          source: { type: "tool", messageID: context.messageID, id: context.id },
          action: permission,
          resources: [resource],
          save: [resource],
        }),
      );
      return { content: JSON.stringify(result), metadata: { action } };
    },
  };
}

export default Plugin.define({
  id: "otto.schedules",
  async setup(ctx) {
    const store = createScheduleStore();
    await ctx.tool.transform((editor) => {
      editor.add(makeTool(ctx, store));
    });
  },
});
`;
