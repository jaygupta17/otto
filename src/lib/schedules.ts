/**
 * Scheduled agent tasks that run ON THE AGENT MACHINE (cron + a tiny runner
 * script), so they fire even when no device has Otto open.
 *
 * Layout on the server (all under $HOME/.otto, user-private):
 *   schedules.json            source of truth the app reads/writes
 *   server.env                local URL + password for the runner (chmod 600)
 *   bin/otto-run <id>       creates a session and sends the prompt
 *   tasks/<id>.session.json   pre-built request bodies (no JSON parsing in bash)
 *   tasks/<id>.prompt.json
 *   logs/<id>.log             "<iso> ok <sessionID>" / "<iso> error <why>"
 * Crontab entries live in a marked block that we fully own.
 */
import type { OpenCode } from "./opencode/client";
import { sh } from "./opencode/config";

export type Frequency =
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekdays"; hour: number; minute: number }
  | { kind: "weekly"; days: number[]; hour: number; minute: number }
  | { kind: "custom"; cron: string };

export interface Schedule {
  id: string;
  name: string;
  prompt: string;
  directory?: string;
  agent?: string;
  model?: { providerID: string; id: string; variant?: string };
  /** In the USER's local time; converted to server time when installed. */
  frequency: Frequency;
  enabled: boolean;
  createdAt: number;
}

export interface RunRecord {
  at: number;
  ok: boolean;
  sessionID?: string;
  error?: string;
}

export interface ServerEnv {
  home: string;
  /** Minutes east of UTC on the server. */
  serverOffset: number;
  hasCron: boolean;
  os: string;
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function describe(f: Frequency): string {
  const t = (h: number, m: number) => new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  switch (f.kind) {
    case "hourly":
      return f.minute === 0 ? "Every hour" : `Every hour at :${String(f.minute).padStart(2, "0")}`;
    case "daily":
      return `Every day at ${t(f.hour, f.minute)}`;
    case "weekdays":
      return `Weekdays at ${t(f.hour, f.minute)}`;
    case "weekly":
      return `${f.days.length === 7 ? "Every day" : f.days.map((d) => DAY[d]).join(", ")} at ${t(f.hour, f.minute)}`;
    case "custom":
      return `Cron: ${f.cron}`;
  }
}

/** Local-time frequency → cron line in server time. */
export function toCron(f: Frequency, serverOffset: number): string {
  const localOffset = -new Date().getTimezoneOffset();
  const shift = serverOffset - localOffset; // minutes to add to local time to get server time
  const conv = (hour: number, minute: number) => {
    let total = hour * 60 + minute + shift;
    let dayShift = 0;
    while (total < 0) {
      total += 1440;
      dayShift -= 1;
    }
    while (total >= 1440) {
      total -= 1440;
      dayShift += 1;
    }
    return { h: Math.floor(total / 60), m: total % 60, dayShift };
  };
  const days = (list: number[], dayShift: number) => list.map((d) => (((d + dayShift) % 7) + 7) % 7).sort().join(",");
  switch (f.kind) {
    case "hourly": {
      const m = (((f.minute + shift) % 60) + 60) % 60;
      return `${m} * * * *`;
    }
    case "daily": {
      const c = conv(f.hour, f.minute);
      return `${c.m} ${c.h} * * *`;
    }
    case "weekdays": {
      const c = conv(f.hour, f.minute);
      return `${c.m} ${c.h} * * ${days([1, 2, 3, 4, 5], c.dayShift)}`;
    }
    case "weekly": {
      const c = conv(f.hour, f.minute);
      return `${c.m} ${c.h} * * ${days(f.days.length ? f.days : [1], c.dayShift)}`;
    }
    case "custom":
      return f.cron.trim();
  }
}

// ---------------------------------------------------------------------------
// Minimal cron evaluator (for "next run" and validation)
// ---------------------------------------------------------------------------

function parseField(expr: string, min: number, max: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of expr.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part.trim());
    if (!m) return null;
    let lo = min;
    let hi = max;
    if (m[1] !== "*") {
      const [a, b] = m[1].split("-").map(Number);
      lo = a;
      hi = b ?? (m[2] ? max : a);
    }
    const step = m[2] ? Number(m[2]) : 1;
    if (lo < min || hi > max || lo > hi || step < 1) return null;
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && max === 7 ? 0 : v);
  }
  return out;
}

export function validCron(cron: string): boolean {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return false;
  return !!(parseField(f[0], 0, 59) && parseField(f[1], 0, 23) && parseField(f[2], 1, 31) && parseField(f[3], 1, 12) && parseField(f[4], 0, 7));
}

/** Next fire time (epoch ms) of a server-time cron line, or null. */
export function nextRun(cron: string, serverOffset: number, from = Date.now()): number | null {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [mi, ho, dom, mon, dow] = [parseField(f[0], 0, 59), parseField(f[1], 0, 23), parseField(f[2], 1, 31), parseField(f[3], 1, 12), parseField(f[4], 0, 7)];
  if (!mi || !ho || !dom || !mon || !dow) return null;
  const domAny = f[2] === "*";
  const dowAny = f[4] === "*";
  // Walk minutes in server-local wall time.
  let t = Math.floor(from / 60000) * 60000 + 60000;
  for (let i = 0; i < 60 * 24 * 370; i++, t += 60000) {
    const d = new Date(t + serverOffset * 60000);
    if (!mi.has(d.getUTCMinutes()) || !ho.has(d.getUTCHours()) || !mon.has(d.getUTCMonth() + 1)) continue;
    const domOk = dom.has(d.getUTCDate());
    const dowOk = dow.has(d.getUTCDay());
    if (domAny && dowAny ? true : domAny ? dowOk : dowAny ? domOk : domOk || dowOk) return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Server plumbing
// ---------------------------------------------------------------------------

const RUNNER = `#!/usr/bin/env bash
# otto-run <id> — start a scheduled agent session. Installed by Otto; safe to delete.
set -u
DIR="\${OTTO_DIR:-$HOME/.otto}"
ID="\${1:?task id}"
[ -f "$DIR/server.env" ] || exit 1
. "$DIR/server.env"
[ -f "$DIR/tasks/$ID.prompt.json" ] || exit 0
mkdir -p "$DIR/logs"
LOG="$DIR/logs/$ID.log"
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
AUTH="opencode:$OTTO_PASSWORD"
SES=$(curl -fsS --max-time 30 -u "$AUTH" -H 'content-type: application/json' --data-binary @"$DIR/tasks/$ID.session.json" "$OTTO_URL/api/session" 2>&1) || { echo "$(ts) error could-not-create-session" >> "$LOG"; exit 1; }
SID=$(printf '%s' "$SES" | grep -o '"id":"ses[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$SID" ] || { echo "$(ts) error bad-session-response" >> "$LOG"; exit 1; }
curl -fsS --max-time 30 -u "$AUTH" -H 'content-type: application/json' --data-binary @"$DIR/tasks/$ID.prompt.json" "$OTTO_URL/api/session/$SID/prompt" >/dev/null 2>&1 || { echo "$(ts) error prompt-failed $SID" >> "$LOG"; exit 1; }
echo "$(ts) ok $SID" >> "$LOG"
tail -n 40 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
`;

const BEGIN = "# >>> otto schedules (managed by Otto; edit in the app) >>>";
const END = "# <<< otto schedules <<<";

export class ScheduleService {
  private envCache: ServerEnv | null = null;
  constructor(readonly client: OpenCode) {}

  async env(): Promise<ServerEnv> {
    if (this.envCache) return this.envCache;
    const r = await this.client.exec(`printf '%s\\n' "\${OTTO_HOME:-$HOME}"; date +%z; uname -s; command -v crontab >/dev/null 2>&1 && echo cron-yes || echo cron-no`);
    const [home, tz, os, cron] = r.output.trim().split("\n");
    const sign = tz?.startsWith("-") ? -1 : 1;
    const digits = (tz ?? "+0000").replace(/[+-]/, "");
    const serverOffset = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
    this.envCache = { home: home.trim(), serverOffset: Number.isFinite(serverOffset) ? serverOffset : 0, hasCron: cron?.trim() === "cron-yes", os: (os ?? "").trim() };
    return this.envCache;
  }

  private async dir() {
    return `${(await this.env()).home}/.otto`;
  }

  async list(): Promise<Schedule[]> {
    const dir = await this.dir();
    try {
      const text = await this.client.readFile(`${dir}/schedules.json`);
      const data = JSON.parse(text) as { schedules?: Schedule[] };
      return data.schedules ?? [];
    } catch (e) {
      if ((e as { status?: number }).status === 404) return [];
      throw e;
    }
  }

  async runs(id: string): Promise<RunRecord[]> {
    const dir = await this.dir();
    try {
      const text = await this.client.readFile(`${dir}/logs/${id}.log`);
      return text
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

  /** Persist schedules, refresh task payloads, runner, credentials and crontab. */
  async save(schedules: Schedule[], creds: { password: string; localUrl: string }): Promise<void> {
    const env = await this.env();
    const dir = `${env.home}/.otto`;
    await this.client.writeFile(`${dir}/schedules.json`, JSON.stringify({ version: 1, schedules }, null, 2) + "\n");
    await this.client.writeFile(`${dir}/bin/otto-run`, RUNNER);
    await this.client.writeFile(`${dir}/server.env`, `OTTO_URL=${sh(creds.localUrl)}\nOTTO_PASSWORD=${sh(creds.password)}\n`);
    for (const s of schedules) {
      const session: Record<string, unknown> = { title: `Scheduled: ${s.name}` };
      if (s.directory) session.location = { directory: s.directory };
      if (s.agent) session.agent = s.agent;
      if (s.model) session.model = s.model;
      await this.client.writeFile(`${dir}/tasks/${s.id}.session.json`, JSON.stringify(session));
      await this.client.writeFile(`${dir}/tasks/${s.id}.prompt.json`, JSON.stringify({ text: s.prompt }));
    }
    const lines = schedules.filter((s) => s.enabled).map((s) => `${toCron(s.frequency, env.serverOffset)} OTTO_DIR=${sh(dir)} ${sh(dir + "/bin/otto-run")} ${s.id} >/dev/null 2>&1`);
    const block = [BEGIN, ...lines, END].join("\n");
    const keep = schedules.map((s) => s.id);
    const ensureCron =
      env.os === "Linux"
        ? `if ! command -v crontab >/dev/null 2>&1; then (sudo -n apt-get update -qq && sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cron) >/dev/null 2>&1 || true; fi; (sudo -n systemctl enable --now cron || sudo -n service cron start) >/dev/null 2>&1 || true;`
        : "";
    const cmd = [
      `set -e`,
      `chmod 700 ${sh(dir)} 2>/dev/null || true`,
      `chmod 600 ${sh(dir + "/server.env")} && chmod 755 ${sh(dir + "/bin/otto-run")}`,
      // Remove payloads/logs of deleted schedules.
      `cd ${sh(dir)} && for f in tasks/*.json logs/*.log; do [ -e "$f" ] || continue; id=$(basename "$f" | cut -d. -f1); case " ${keep.join(" ")} " in *" $id "*) ;; *) rm -f "$f";; esac; done`,
      ensureCron,
      // OTTO_CRONTAB lets a dev server point at a fake crontab.
      `CT="\${OTTO_CRONTAB:-crontab}"`,
      `command -v "$CT" >/dev/null 2>&1 || { echo "cron is not available on this machine" >&2; exit 3; }`,
      `( "$CT" -l 2>/dev/null | sed '/^# >>> otto schedules/,/^# <<< otto schedules <<<$/d'; printf '%s\\n' ${sh(block)} ) | "$CT" -`,
    ]
      .filter(Boolean)
      .join("\n");
    // Run under bash explicitly: the server shell may be zsh (macOS), whose glob rules differ.
    const r = await this.client.exec(`bash -c ${sh(cmd)}`, { timeoutMs: 180_000 });
    if (r.exit !== 0) throw new Error(r.output.trim() || "Couldn't install the schedule on the server.");
    this.envCache = { ...env, hasCron: true };
  }

  async runNow(id: string): Promise<RunRecord | null> {
    const dir = await this.dir();
    const r = await this.client.exec(`OTTO_DIR=${sh(dir)} ${sh(dir + "/bin/otto-run")} ${sh(id)}; tail -n 1 ${sh(`${dir}/logs/${id}.log`)} 2>/dev/null`, { timeoutMs: 90_000 });
    const last = r.output.trim().split("\n").pop() ?? "";
    const [iso, status, a, b] = last.split(" ");
    if (!iso) return null;
    return status === "ok" ? { at: Date.parse(iso), ok: true, sessionID: a } : { at: Date.parse(iso), ok: false, error: a, sessionID: b };
  }
}
