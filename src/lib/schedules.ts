/**
 * Scheduled agent tasks that run ON THE AGENT MACHINE (cron + a tiny runner
 * script), so they fire even when no device has Otto open.
 *
 * Layout on the server (all under $HOME/.otto, user-private):
 *   schedules.json            source of truth, `{version, rev, schedules}` (see scheduleStore)
 *   schedules.lock            held while one writer changes the file
 *   server.env                local URL + password for the runner (chmod 600)
 *   bin/otto-run <id>         creates a session and sends the prompt
 *   tasks/<id>.session.json   pre-built request bodies (no JSON parsing in bash)
 *   tasks/<id>.prompt.json
 *   tasks/<id>.lock           one run per task at a time
 *   logs/<id>.log             "<iso> ok <sessionID>" / "<iso> error <why>"
 *   state/<id>.json           last run, for the card (the runner writes it)
 * Crontab entries live in a marked block that we fully own.
 *
 * The app never writes the whole list: it sends one schedule (or one field)
 * with the rev it last saw. A mismatch raises StaleScheduleError, and the UI
 * reloads instead of clobbering an edit made by an agent or another device.
 */
import type { OpenCode } from "./opencode/client";
import type { RunRecord, Schedule, ServerEnv } from "./scheduleCore";
import {
  ScheduleStore,
  normalizeRun,
  shellQuote as q,
  type Credentials,
  type CronRead,
  type ScheduleData,
  type StoreHost,
  type TransactResult,
} from "./scheduleStore";

// The scheduling math lives in ./scheduleCore (pure, testable). Re-export it so
// existing imports from "./schedules" keep working.
export { describe, nextRun, parseField, toCron, validCron } from "./scheduleCore";
export type { Frequency, RunRecord, Schedule, ServerEnv } from "./scheduleCore";
export { StaleScheduleError, ScheduleLockError } from "./scheduleStore";
export type { Credentials } from "./scheduleStore";

// ---------------------------------------------------------------------------
// Host: one OpenCode machine's files, crontab and runner
// ---------------------------------------------------------------------------

/** stdout of a command, minus the shell's trailing newline. */
const text = (s: string) => s.replace(/\n+$/, "");

function openCodeHost(client: OpenCode, dir: string): StoreHost {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async read(path) {
      try {
        return await client.readFile(path);
      } catch (e) {
        if ((e as { status?: number }).status === 404) return null;
        throw e;
      }
    },
    write: (path, body) => client.writeFile(path, body),
    async rename(from, to) {
      const r = await client.exec(`mv -f ${q(from)} ${q(to)}`);
      if (r.exit !== 0) throw new Error(text(r.output) || `Couldn't replace ${to}.`);
    },
    async mkdir(path) {
      const r = await client.exec(`mkdir ${q(path)} 2>/dev/null && echo __OTTO_MKDIR__`);
      return r.exit === 0 && r.output.includes("__OTTO_MKDIR__");
    },
    async remove(path) {
      await client.exec(`rm -rf ${q(path)}`);
    },
    async mtime(path) {
      const r = await client.exec(`stat -c %Y ${q(path)} 2>/dev/null || stat -f %m ${q(path)} 2>/dev/null || true`);
      const n = Number(text(r.output).split("\n").pop());
      return Number.isFinite(n) && n > 0 ? n * 1000 : null;
    },
    async chmod(path, mode) {
      await client.exec(`chmod ${mode.toString(8)} ${q(path)} 2>/dev/null || true`);
    },
    async readCrontab(): Promise<CronRead> {
      const r = await client.exec(
        [
          `if ! command -v crontab >/dev/null 2>&1; then echo __OTTO_CRON_MISSING__; exit 0; fi`,
          `out=$(crontab -l 2>&1); rc=$?`,
          `printf '%s\\n' "$out"`,
          `printf '__OTTO_CRON_RC__%s\\n' "$rc"`,
        ].join("\n"),
        { timeoutMs: 20_000 },
      );
      if (r.output.includes("__OTTO_CRON_MISSING__")) return { ok: false, reason: "missing" };
      const lines = r.output.split("\n");
      const marker = lines.findIndex((l) => l.startsWith("__OTTO_CRON_RC__"));
      if (marker < 0) return { ok: false, reason: "failed", message: text(r.output).slice(0, 200) || "crontab -l failed" };
      const rc = Number(lines[marker].slice("__OTTO_CRON_RC__".length)) || 0;
      const body = text(lines.slice(0, marker).join("\n"));
      if (rc === 0) return { ok: true, content: body };
      // A user with no crontab yet is not a broken cron: the command works.
      if (/no crontab/i.test(body)) return { ok: true, content: "" };
      return { ok: false, reason: "failed", message: body.slice(0, 200) || "crontab -l failed" };
    },
    async writeCrontab(body) {
      const tmp = `${dir}/.crontab.next`;
      await client.writeFile(tmp, body);
      const r = await client.exec(`crontab ${q(tmp)}; rc=$?; rm -f ${q(tmp)}; exit $rc`, { timeoutMs: 20_000 });
      if (r.exit !== 0) throw new Error(text(r.output).slice(0, 200) || "crontab refused the change");
    },
    async readRunStates(ids) {
      if (!ids.length) return {};
      const script = [
        `DIR=${q(dir)}`,
        ...ids.map((id) => `if [ -f "$DIR/state/${id}.json" ]; then printf '__OTTO_RUN__${id}\\n'; cat "$DIR/state/${id}.json"; printf '\\n'; fi`),
      ].join("\n");
      const r = await client.exec(script, { timeoutMs: 20_000 });
      const out: Record<string, RunRecord> = {};
      const lines = r.output.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith("__OTTO_RUN__")) continue;
        const id = lines[i].slice("__OTTO_RUN__".length);
        const run = normalizeRun(safeJson(lines[i + 1]));
        if (run) out[id] = run;
      }
      return out;
    },
    async prune(keep) {
      if (!keep.length) {
        await client.exec(`rm -rf ${q(`${dir}/tasks`)} ${q(`${dir}/logs`)} ${q(`${dir}/state`)}`);
        return;
      }
      const pattern = ` ${keep.join(" ")} `;
      const script = [
        `cd ${q(dir)} 2>/dev/null || exit 0`,
        `for f in tasks/*.json logs/*.log state/*.json; do`,
        `  [ -e "$f" ] || continue`,
        `  id=$(basename "$f" | cut -d. -f1)`,
        `  case ${q(pattern)} in *" $id "*) ;; *) rm -f "$f";; esac`,
        `done`,
      ].join("\n");
      await client.exec(script, { timeoutMs: 20_000 });
    },
    async runTask(id, taskDir) {
      const r = await client.exec(
        [`OTTO_DIR=${q(taskDir)} ${q(`${taskDir}/bin/otto-run`)} ${q(id)} >/dev/null 2>&1`, `cat ${q(`${taskDir}/state/${id}.json`)} 2>/dev/null || true`].join("\n"),
        { timeoutMs: 120_000 },
      );
      const run = normalizeRun(safeJson(text(r.output).split("\n").pop() ?? ""));
      return run;
    },
  };
}

function safeJson(s: string | undefined): unknown {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ScheduleService {
  private envCache: ServerEnv | null = null;
  private storeCache: { store: ScheduleStore; home: string } | null = null;
  constructor(readonly client: OpenCode) {}

  async env(): Promise<ServerEnv> {
    if (this.envCache) return this.envCache;
    const r = await this.client.exec(`printf '%s\\n' "\${OTTO_HOME:-$HOME}"; date +%z; uname -s`);
    const [home, tz, os] = r.output.trim().split("\n");
    const sign = tz?.startsWith("-") ? -1 : 1;
    const digits = (tz ?? "+0000").replace(/[+-]/, "");
    const serverOffset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
    const env: ServerEnv = { home: home.trim(), serverOffset: Number.isFinite(serverOffset) ? serverOffset : 0, hasCron: true, os: (os ?? "").trim() };
    const probe = await (await this.store(env)).probeCron();
    env.hasCron = probe.hasCron;
    this.envCache = env;
    return env;
  }

  /** Forget cached machine facts (after install, or when the connection changes). */
  refresh() {
    this.envCache = null;
    this.storeCache = null;
  }

  private async store(env?: ServerEnv): Promise<ScheduleStore> {
    const e = env ?? (await this.env());
    if (this.storeCache?.home === e.home) return this.storeCache.store;
    // The env probe builds the store before envCache exists; pass the facts in.
    const store = new ScheduleStore(openCodeHost(this.client, `${e.home}/.otto`), { dir: `${e.home}/.otto`, offset: e.serverOffset });
    this.storeCache = { store, home: e.home };
    return store;
  }

  async load(): Promise<ScheduleData> {
    return (await this.store()).load();
  }

  /** Kept for callers that only want the list (e.g. the runner pre-flight). */
  async list(): Promise<Schedule[]> {
    return (await this.load()).schedules;
  }

  async upsert(s: Schedule, baseRev: number, creds?: Credentials): Promise<TransactResult<Schedule>> {
    return (await this.store()).upsert(s, baseRev, creds);
  }

  async remove(id: string, baseRev: number, creds?: Credentials): Promise<TransactResult<string>> {
    return (await this.store()).remove(id, baseRev, creds);
  }

  async setEnabled(id: string, enabled: boolean, baseRev: number, creds?: Credentials): Promise<TransactResult<string>> {
    return (await this.store()).setEnabled(id, enabled, baseRev, creds);
  }

  /** Runner script, credentials, payloads and cron block; no definition change. */
  async install(creds: Credentials): Promise<{ rev: number; schedules: Schedule[]; warnings: string[] }> {
    const store = await this.store();
    const out = await store.install(creds);
    const env = await this.env();
    if (!out.warnings.some((w) => w.startsWith("cron-"))) this.envCache = { ...env, hasCron: true };
    return out;
  }

  async runNow(id: string, creds?: Credentials): Promise<{ run: RunRecord | null; schedules: Schedule[]; rev: number }> {
    return (await this.store()).runNow(id, creds);
  }

  /** Run history from the log the runner appends to. */
  async runs(id: string): Promise<RunRecord[]> {
    const dir = await this.dir();
    try {
      const body = await this.client.readFile(`${dir}/logs/${id}.log`);
      return body
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [iso, status, ...rest] = line.split(" ");
          const ok = status === "ok";
          return { at: Date.parse(iso), ok, sessionID: ok ? rest[0] : rest[1], error: ok ? undefined : rest[0] };
        })
        .reverse();
    } catch {
      return [];
    }
  }

  private async dir() {
    return `${(await this.env()).home}/.otto`;
  }
}
