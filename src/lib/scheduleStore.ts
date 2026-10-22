/**
 * The schedule store: one JSON file, one rev, one lock, one crontab block.
 *
 * The app, an agent tool and cron can all touch schedules, so the file is not
 * a document anyone overwrites wholesale. Every change takes the machine-wide
 * lock (`mkdir ~/.otto/schedules.lock`, atomic), re-reads the file, mutates a
 * single id, writes through a temp file and a rename, rewrites our crontab
 * block, and bumps `rev`. Callers that started from a `rev` (the app) get a
 * `StaleScheduleError` instead of clobbering a change made elsewhere.
 *
 * All I/O goes through `StoreHost`, so the same protocol is exercised in tests
 * over a temp directory and in the app over OpenCode's file/shell API. The
 * generated agent plugin (lib/schedulesPlugin) carries a plain-JS copy.
 *
 * File (`~/.otto/schedules.json`):
 *   { "version": 2, "rev": 3, "schedules": [ … ] }
 * v1 (`{ schedules }` or a bare array) is read and upgraded on the next write.
 */
import { toCron, validFrequency, type Frequency, type RunRecord, type Schedule } from "./scheduleCore";

export const SCHEDULES_VERSION = 2;
export const SCHEDULES_FILE = "schedules.json";
export const CRON_BEGIN = "# >>> otto schedules (managed by Otto; edit in the app) >>>";
export const CRON_END = "# <<< otto schedules <<<";
/** A lock older than this cannot belong to a live writer. */
export const STALE_LOCK_MS = 30_000;
export const LOCK_RETRIES = 50;
export const LOCK_WAIT_MS = 100;

export interface ScheduleFile {
  version: 2;
  rev: number;
  schedules: Schedule[];
}

export interface ScheduleData {
  schedules: Schedule[];
  rev: number;
  /** The file was v1 (or a bare array); it becomes v2 on the next write. */
  legacy: boolean;
}

export type CronRead = { ok: true; content: string } | { ok: false; reason: "missing" | "failed"; message?: string };

export interface Credentials {
  password: string;
  localUrl: string;
}

/** Everything the store needs from the machine it runs on. */
export interface StoreHost {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** File text, or null when it does not exist. */
  read(path: string): Promise<string | null>;
  /** Create or replace a file (creating parent folders). */
  write(path: string, text: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Atomic create: true when this call made the folder, false when it was there. */
  mkdir(path: string): Promise<boolean>;
  /** Remove a file or folder tree; missing paths are fine. */
  remove(path: string): Promise<void>;
  /** Epoch ms of the last modification, or null when missing. */
  mtime(path: string): Promise<number | null>;
  chmod(path: string, mode: number): Promise<void>;
  readCrontab(): Promise<CronRead>;
  writeCrontab(text: string): Promise<void>;
  /** `state/<id>.json` per id, missing ids omitted. */
  readRunStates(ids: string[]): Promise<Record<string, RunRecord>>;
  /** Drop task/log/state files for ids not in `keep`. */
  prune(keep: string[]): Promise<void>;
  /** Run `bin/otto-run <id>` and return the run it recorded (null when it left none). */
  runTask(id: string, dir: string): Promise<RunRecord | null>;
}

export interface StoreOptions {
  /** Absolute `~/.otto` (or `$OTTO_HOME/.otto`). */
  dir: string;
  /** Minutes east of UTC on the machine running cron. */
  offset?: number;
  now?: () => number;
  lockRetries?: number;
  lockWaitMs?: number;
  staleLockMs?: number;
}

export class StaleScheduleError extends Error {
  readonly stale = true as const;
  constructor(
    readonly expected: number,
    readonly current: number,
    readonly schedules: Schedule[],
  ) {
    super(`Schedules changed elsewhere (this editor saw rev ${expected}, the machine has ${current}).`);
    this.name = "StaleScheduleError";
  }
}

export class ScheduleLockError extends Error {
  readonly locked = true as const;
  constructor() {
    super("Another schedule change is still in progress. Try again in a moment.");
    this.name = "ScheduleLockError";
  }
}

// ---------------------------------------------------------------------------
// The runner installed next to the file
// ---------------------------------------------------------------------------

/**
 * `otto-run <id>`: create a session through the local API and send the prompt.
 * The payloads are pre-built JSON files, so the script does no JSON parsing.
 * It writes `state/<id>.json` for the app card, and only one run per task can
 * be in flight (a lock folder; a killed runner's lock expires after 30 min).
 */
export const RUNNER_SCRIPT = [
  "#!/usr/bin/env bash",
  "# otto-run <id> - start a scheduled agent session. Installed by Otto; safe to delete.",
  "set -u",
  "DIR=$OTTO_DIR",
  '[ -n "$DIR" ] || DIR=$HOME/.otto',
  'ID=${1:?task id}',
  // Cap a hung run where `timeout` exists. Re-exec before taking the lock, so
  // the lock belongs to the process that does the work.
  'if [ -z "${OTTO_TIMEOUT:-}" ] && command -v timeout >/dev/null 2>&1; then',
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
  'record() { printf \'%s\' "$1" > "$STATE.tmp" && mv -f "$STATE.tmp" "$STATE"; }',
  'fail() { echo "$(ts) error $1" >> "$LOG"; record "{\\"at\\":$(now_ms),\\"ok\\":false,\\"error\\":\\"$1\\"}"; exit 1; }',
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
  "trap 'rm -rf \"$LOCK\"' EXIT",
  'AUTH="opencode:$OTTO_PASSWORD"',
  'SES=$(curl -fsS --max-time 30 -u "$AUTH" -H \'content-type: application/json\' --data-binary @"$DIR/tasks/$ID.session.json" "$OTTO_URL/api/session" 2>&1) || fail could-not-create-session',
  'SID=$(printf \'%s\' "$SES" | grep -o \'"id":"ses[^"]*"\' | head -1 | cut -d\'"\' -f4)',
  '[ -n "$SID" ] || fail bad-session-response',
  'curl -fsS --max-time 30 -u "$AUTH" -H \'content-type: application/json\' --data-binary @"$DIR/tasks/$ID.prompt.json" "$OTTO_URL/api/session/$SID/prompt" >/dev/null 2>&1 || fail prompt-failed',
  'echo "$(ts) ok $SID" >> "$LOG"',
  'record "{\\"at\\":$(now_ms),\\"ok\\":true,\\"sessionID\\":\\"$SID\\"}"',
  'tail -n 40 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"',
  "",
].join("\n");

/** Quote one string for a POSIX shell. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The crontab block for these schedules, in machine wall time. */
export function cronBlock(schedules: Schedule[], dir: string, offset: number): string {
  const lines = schedules
    .filter((s) => s.enabled)
    .map((s) => `${toCron(s.frequency, offset)} OTTO_DIR=${shellQuote(dir)} ${shellQuote(`${dir}/bin/otto-run`)} ${s.id} >/dev/null 2>&1`);
  return [CRON_BEGIN, ...lines, CRON_END].join("\n");
}

/**
 * Replace our managed block, keeping every unrelated crontab line exactly as
 * it was (and in place: lines after the block stay after it). A block without
 * an end marker swallows the rest of the file rather than leaving orphans.
 */
export function replaceCronBlock(text: string, block: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of (text ?? "").split("\n")) {
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
  out.push(...block.split("\n"));
  return `${out.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Reading and normalizing
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const int = (v: unknown, min: number, max: number): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : undefined);

/** One schedule from disk/tool input, with anything unusable dropped. */
export function normalizeSchedule(value: unknown): Schedule | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  const name = str(value.name)?.trim();
  const prompt = str(value.prompt);
  const createdAt = typeof value.createdAt === "number" && Number.isFinite(value.createdAt) ? value.createdAt : undefined;
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || !name || prompt === undefined || !validFrequency(value.frequency)) return null;
  const s: Schedule = {
    id,
    name,
    prompt,
    frequency: normalizeFrequency(value.frequency),
    enabled: value.enabled !== false,
    createdAt: createdAt ?? Date.now(),
  };
  const directory = str(value.directory);
  if (directory) s.directory = directory;
  const agent = str(value.agent);
  if (agent) s.agent = agent;
  const model = value.model;
  if (isRecord(model)) {
    const providerID = str(model.providerID);
    const modelID = str(model.id);
    if (providerID && modelID) s.model = { providerID, id: modelID, ...(str(model.variant) ? { variant: str(model.variant) } : {}) };
  }
  const createdBy = str(value.createdBy);
  if (createdBy === "user" || createdBy?.startsWith("agent:")) s.createdBy = createdBy as Schedule["createdBy"];
  const createdByAgent = str(value.createdByAgent);
  if (createdByAgent) s.createdByAgent = createdByAgent;
  const timezone = str(value.timezone);
  if (timezone) s.timezone = timezone;
  const lastRun = normalizeRun(value.lastRun);
  if (lastRun) s.lastRun = lastRun;
  return s;
}

function normalizeFrequency(f: Frequency): Frequency {
  switch (f.kind) {
    case "hourly":
      return { kind: "hourly", minute: f.minute };
    case "daily":
      return { kind: "daily", hour: f.hour, minute: f.minute };
    case "weekdays":
      return { kind: "weekdays", hour: f.hour, minute: f.minute };
    case "weekly":
      return { kind: "weekly", days: [...new Set(f.days)].sort((a, b) => a - b), hour: f.hour, minute: f.minute };
    case "custom":
      return { kind: "custom", cron: f.cron.trim().replace(/\s+/g, " ") };
  }
}

export function normalizeRun(value: unknown): RunRecord | null {
  if (!isRecord(value)) return null;
  const at = typeof value.at === "number" && Number.isFinite(value.at) ? value.at : null;
  if (at === null || typeof value.ok !== "boolean") return null;
  const run: RunRecord = { at, ok: value.ok };
  const sessionID = str(value.sessionID);
  if (sessionID) run.sessionID = sessionID;
  const error = str(value.error);
  if (error) run.error = error;
  return run;
}

/**
 * Unique, valid schedules from a list (duplicate ids keep their first entry,
 * so a corrupted file cannot produce two rows for one task).
 */
export function normalizeSchedules(list: unknown): Schedule[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Schedule[] = [];
  for (const item of list) {
    const s = normalizeSchedule(item);
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/** Read v1 or v2 text into schedules + rev. Throws on invalid JSON. */
export function parseSchedules(text: string | null): ScheduleData {
  if (text === null || !text.trim()) return { schedules: [], rev: 0, legacy: false };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("schedules.json is not valid JSON; fix it in the app before adding schedules.");
  }
  const legacy = Array.isArray(raw) || (isRecord(raw) && raw.version !== SCHEDULES_VERSION);
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? raw.schedules : [];
  const rev = isRecord(raw) ? (int(raw.rev, 0, Number.MAX_SAFE_INTEGER) ?? 0) : 0;
  return { schedules: normalizeSchedules(list), rev, legacy };
}

export function serializeSchedules(schedules: Schedule[], rev: number): string {
  const file: ScheduleFile = { version: SCHEDULES_VERSION, rev, schedules };
  return `${JSON.stringify(file, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface TransactResult<T> {
  schedules: Schedule[];
  rev: number;
  result: T;
  /** Non-fatal problems, e.g. cron missing. The definition was still saved. */
  warnings: string[];
}

export class ScheduleStore {
  readonly dir: string;
  readonly file: string;
  private readonly host: StoreHost;
  private readonly offset: number;
  private readonly now: () => number;
  private readonly lockRetries: number;
  private readonly lockWaitMs: number;
  private readonly staleLockMs: number;

  constructor(host: StoreHost, opts: StoreOptions) {
    this.host = host;
    this.dir = opts.dir.replace(/\/$/, "");
    this.file = `${this.dir}/${SCHEDULES_FILE}`;
    this.offset = opts.offset ?? 0;
    this.now = opts.now ?? (() => host.now());
    this.lockRetries = opts.lockRetries ?? LOCK_RETRIES;
    this.lockWaitMs = opts.lockWaitMs ?? LOCK_WAIT_MS;
    this.staleLockMs = opts.staleLockMs ?? STALE_LOCK_MS;
  }

  /** Definitions + rev, with the newest run status merged in. */
  async load(): Promise<ScheduleData> {
    const data = await this.readFile();
    if (!data.schedules.length) return data;
    const states = await this.host.readRunStates(data.schedules.map((s) => s.id)).catch(() => ({}) as Record<string, RunRecord>);
    const schedules = data.schedules.map((s) => {
      const run = states[s.id];
      return run && (!s.lastRun || run.at > s.lastRun.at) ? { ...s, lastRun: run } : s;
    });
    return { ...data, schedules };
  }

  /**
   * One atomic change: lock → read → check rev → mutate → derived files →
   * temp+rename → crontab block → rev+1 → unlock.
   *
   * The mutator gets a copy of the list and returns the list to save. It
   * should touch one id; the store normalizes, dedupes and writes the rest
   * untouched. `baseRev` is the caller's optimistic-concurrency token.
   */
  async transact<T>(
    mutate: (schedules: Schedule[]) => { schedules: Schedule[]; result: T },
    opts: { baseRev?: number; creds?: Credentials } = {},
  ): Promise<TransactResult<T>> {
    return this.withLock(async () => {
      const current = await this.readFile(true);
      if (opts.baseRev !== undefined && current.rev !== opts.baseRev) {
        const merged = await this.mergeRunStates(current.schedules);
        throw new StaleScheduleError(opts.baseRev, current.rev, merged);
      }
      const draft = mutate(current.schedules.map((s) => ({ ...s })));
      const next = normalizeSchedules(draft.schedules);
      const rev = current.rev + 1;
      await this.writeDerived(next, opts.creds);
      const body = serializeSchedules(next, rev);
      const tmp = `${this.file}.tmp-${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      await this.host.write(tmp, body);
      await this.host.rename(tmp, this.file);
      const warnings = await this.installCron(next);
      await this.host.prune(next.map((s) => s.id)).catch(() => {});
      return { schedules: next, rev, result: draft.result, warnings };
    });
  }

  /** Create or replace one schedule. Fails stale when `baseRev` is behind. */
  upsert(schedule: Schedule, baseRev?: number, creds?: Credentials) {
    return this.transact(
      (schedules) => {
        const before = schedules.find((s) => s.id === schedule.id);
        // A run may have finished while the app's editor was open; its status
        // is newer than the copy the editor saved.
        const lastRun = before?.lastRun && (!schedule.lastRun || before.lastRun.at > schedule.lastRun.at) ? before.lastRun : schedule.lastRun;
        const next = lastRun ? { ...schedule, lastRun } : schedule;
        return { schedules: before ? schedules.map((s) => (s.id === schedule.id ? next : s)) : [...schedules, next], result: next };
      },
      { baseRev, creds },
    );
  }

  remove(id: string, baseRev?: number, creds?: Credentials) {
    return this.transact(
      (schedules) => {
        if (!schedules.some((s) => s.id === id)) throw new Error(`No schedule ${id}.`);
        return { schedules: schedules.filter((s) => s.id !== id), result: id };
      },
      { baseRev, creds },
    );
  }

  setEnabled(id: string, enabled: boolean, baseRev?: number, creds?: Credentials) {
    return this.transact(
      (schedules) => {
        if (!schedules.some((s) => s.id === id)) throw new Error(`No schedule ${id}.`);
        return { schedules: schedules.map((s) => (s.id === id ? { ...s, enabled } : s)), result: id };
      },
      { baseRev, creds },
    );
  }

  /**
   * A field-level edit from the agent tool: only the fields it names are
   * changed, so a human's edit to another field is kept. With `baseRev`, the
   * edit fails stale instead of merging.
   */
  patch(id: string, fields: Partial<Omit<Schedule, "id" | "createdAt">>, opts: { baseRev?: number; creds?: Credentials } = {}) {
    return this.transact(
      (schedules) => {
        const before = schedules.find((s) => s.id === id);
        if (!before) throw new Error(`No schedule ${id}.`);
        return { schedules: schedules.map((s) => (s.id === id ? { ...s, ...fields, id } : s)), result: { ...before, ...fields, id } };
      },
      opts,
    );
  }

  /**
   * Write the runner, credentials and payloads without a definition change and
   * without touching the crontab. A connection prepares these files so the
   * first agent-created schedule can run; a machine with no schedules yet must
   * not get an empty managed crontab block.
   */
  async prepare(creds?: Credentials): Promise<{ rev: number; schedules: Schedule[]; warnings: string[] }> {
    return this.withLock(async () => {
      const current = await this.readFile(true);
      await this.writeDerived(current.schedules, creds);
      await this.host.prune(current.schedules.map((s) => s.id)).catch(() => {});
      return { rev: current.rev, schedules: current.schedules, warnings: [] };
    });
  }

  /** Write the runner, credentials, payloads and cron block without a definition change. */
  async install(creds?: Credentials): Promise<{ rev: number; schedules: Schedule[]; warnings: string[] }> {
    return this.withLock(async () => {
      const current = await this.readFile(true);
      await this.writeDerived(current.schedules, creds);
      // No schedules: leave the crontab exactly as it is. Nothing would run,
      // and connecting would otherwise add empty managed markers to a new
      // machine. Cron starts on the first schedule, through `transact`.
      const warnings = current.schedules.length ? await this.installCron(current.schedules) : [];
      await this.host.prune(current.schedules.map((s) => s.id)).catch(() => {});
      return { rev: current.rev, schedules: current.schedules, warnings };
    });
  }

  /** Run one schedule now; records the run in `lastRun` and returns the new list. */
  async runNow(id: string, creds?: Credentials): Promise<{ run: RunRecord | null; schedules: Schedule[]; rev: number }> {
    const data = await this.load();
    if (!data.schedules.some((s) => s.id === id)) throw new Error(`No schedule ${id}.`);
    if (creds) await this.writeCredentials(creds);
    const run = await this.host.runTask(id, this.dir);
    if (!run) return { run: null, schedules: data.schedules, rev: data.rev };
    try {
      const saved = await this.transact(
        (schedules) => {
          if (!schedules.some((s) => s.id === id)) return { schedules, result: schedules };
          return { schedules: schedules.map((s) => (s.id === id ? { ...s, lastRun: run } : s)), result: schedules };
        },
        { creds },
      );
      return { run, schedules: saved.schedules, rev: saved.rev };
    } catch (e) {
      // The run happened; failing to annotate it must not look like a failed run.
      return { run, schedules: data.schedules, rev: data.rev };
    }
  }

  /** Does `crontab -l` actually work on this machine? */
  async probeCron(): Promise<{ hasCron: boolean; message?: string }> {
    const read = await this.host.readCrontab();
    if (read.ok) return { hasCron: true };
    return { hasCron: false, message: read.reason === "missing" ? "This machine has no crontab command, so schedules can't run here." : (read.message ?? "The crontab on this machine isn't working.") };
  }

  // ---- internals ---------------------------------------------------------

  private async readFile(mergeRuns = false): Promise<ScheduleData> {
    const text = await this.host.read(this.file);
    const data = parseSchedules(text);
    if (!mergeRuns || !data.schedules.length) return data;
    return { ...data, schedules: await this.mergeRunStates(data.schedules) };
  }

  private async mergeRunStates(schedules: Schedule[]): Promise<Schedule[]> {
    const states = await this.host.readRunStates(schedules.map((s) => s.id)).catch(() => ({}) as Record<string, RunRecord>);
    return schedules.map((s) => {
      const run = states[s.id];
      return run && (!s.lastRun || run.at > s.lastRun.at) ? { ...s, lastRun: run } : s;
    });
  }

  private async withLock<T>(run: () => Promise<T>): Promise<T> {
    const lock = `${this.dir}/schedules.lock`;
    // The lock's parent has to exist; `mkdir` is also the lock primitive, so
    // make the folder itself first (no-op when it is there).
    await this.host.mkdir(this.dir).catch(() => {});
    await this.acquire(lock);
    try {
      return await run();
    } finally {
      await this.host.remove(lock).catch(() => {});
    }
  }

  private async acquire(lock: string) {
    for (let i = 0; i < this.lockRetries; i++) {
      if (await this.host.mkdir(lock)) return;
      const mtime = await this.host.mtime(lock).catch(() => null);
      if (mtime !== null && this.now() - mtime > this.staleLockMs) {
        await this.host.remove(lock).catch(() => {});
        continue;
      }
      if (mtime === null) continue;
      await this.host.sleep(this.lockWaitMs);
    }
    throw new ScheduleLockError();
  }

  private async writeRunner() {
    await this.host.write(`${this.dir}/bin/otto-run`, RUNNER_SCRIPT);
    await this.host.chmod(`${this.dir}/bin/otto-run`, 0o755);
  }

  /** Runner, credentials and payloads: everything derived from the schedule list. */
  private async writeDerived(schedules: Schedule[], creds?: Credentials) {
    await this.writeRunner();
    if (creds) await this.writeCredentials(creds);
    // Payloads are derived and cheap; writing them all repairs a deleted file
    // or a migrated v1 schedule that never had one.
    for (const s of schedules) await this.writeTask(s);
  }

  private async writeCredentials(creds: Credentials) {
    await this.host.write(`${this.dir}/server.env`, `OTTO_URL=${shellQuote(creds.localUrl)}\nOTTO_PASSWORD=${shellQuote(creds.password)}\n`);
    await this.host.chmod(`${this.dir}/server.env`, 0o600);
  }

  private async writeTask(s: Schedule) {
    const session: Record<string, unknown> = { title: `Scheduled: ${s.name}` };
    if (s.directory) session.location = { directory: s.directory };
    if (s.agent) session.agent = s.agent;
    if (s.model) session.model = s.model;
    await this.host.write(`${this.dir}/tasks/${s.id}.session.json`, JSON.stringify(session));
    await this.host.write(`${this.dir}/tasks/${s.id}.prompt.json`, JSON.stringify({ text: s.prompt }));
  }

  private async installCron(schedules: Schedule[]): Promise<string[]> {
    const read = await this.host.readCrontab();
    if (!read.ok) {
      return [read.reason === "missing" ? "cron-missing" : `cron-failed: ${read.message ?? "crontab refused the change"}`];
    }
    try {
      await this.host.writeCrontab(replaceCronBlock(read.content, cronBlock(schedules, this.dir, this.offset)));
    } catch (e) {
      return [`cron-failed: ${(e as Error).message}`];
    }
    return [];
  }
}

