/**
 * Pure scheduling math shared by the app UI, the server plumbing and (later)
 * the agent-facing schedule tool: frequency types, cron conversion in server
 * time, a tiny cron evaluator for "next run" and validation.
 *
 * No I/O happens here. The only implicit inputs are the local timezone and
 * clock, which `toCron` reads through `Date` — specifically the zone offset
 * that will hold at each schedule's *next* occurrence, so a run that lands
 * after a DST change is converted with the offset it will actually fire under.
 */

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
  /** Who made it: the app, or an agent tool call (with its session id). */
  createdBy?: "user" | `agent:${string}`;
  /** Agent id behind an agent-created schedule, when it is known (for display). */
  createdByAgent?: string;
  /**
   * Last run, as recorded by the runner or a manual run. Older Otto builds only
   * had the log; `runs()` still reads that for history.
   */
  lastRun?: RunRecord;
  /** Reserved: the IANA zone the frequency was written in. Not used for conversion yet. */
  timezone?: string;
}

/** Does `f` have the shape (and ranges) a schedule in the file can have? */
export function validFrequency(f: unknown): f is Frequency {
  if (!f || typeof f !== "object") return false;
  const v = f as Record<string, unknown>;
  const int = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
  switch (v.kind) {
    case "hourly":
      return int(v.minute, 0, 59);
    case "daily":
    case "weekdays":
      return int(v.hour, 0, 23) && int(v.minute, 0, 59);
    case "weekly":
      return int(v.hour, 0, 23) && int(v.minute, 0, 59) && Array.isArray(v.days) && v.days.length > 0 && v.days.every((d) => int(d, 0, 6));
    case "custom":
      return typeof v.cron === "string" && validCron(v.cron);
    default:
      return false;
  }
}

export const isAgentCreated = (s: Pick<Schedule, "createdBy">) => !!s.createdBy?.startsWith("agent:");

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

/** Minutes east of UTC in the host zone at instant `t`. */
const localOffsetAt = (t: number) => -new Date(t).getTimezoneOffset();

/** The local calendar fields of `t`, packed as an epoch-ms-shaped UTC value. */
const wallOf = (t: number) => {
  const d = new Date(t);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes());
};

/**
 * The UTC instant whose local wall clock is `wall` (an epoch-ms-shaped value
 * of local calendar fields), preferring the earliest one. A fall-back makes
 * some wall times occur twice (earliest wins); a spring-forward makes some
 * not occur at all (those fire just past the gap).
 */
function instantForWall(wall: number): number {
  // The offsets a day either side bracket any real zone transition, and the
  // round-trip check keeps candidates honest in both edge cases.
  const a = wall - localOffsetAt(wall - 86400000) * 60000;
  const b = wall - localOffsetAt(wall + 86400000) * 60000;
  for (const t of a <= b ? [a, b] : [b, a]) if (wallOf(t) === wall) return t;
  return Math.max(a, b);
}

/**
 * Epoch ms of the first local wall-clock occurrence of `f` at or after `from`,
 * in the host zone. This is what a person means by "weekdays at 10:00": the
 * next 10:00, whatever offset the zone happens to have by then.
 */
function nextLocalOccurrence(f: Frequency, from: number): number {
  if (f.kind === "custom") return from;
  const now = new Date(from);
  if (f.kind === "hourly") return from + ((f.minute - now.getMinutes() + 60) % 60) * 60000;
  // Narrowed to daily | weekdays | weekly; capture before the closure below.
  const { hour, minute } = f;
  const days = f.kind === "weekly" ? (f.days.length ? f.days : [1]) : null;
  const wall = (y: number, mo: number, d: number) => instantForWall(Date.UTC(y, mo, d, hour, minute));
  const matches = (dow: number) => (f.kind === "daily" ? true : f.kind === "weekdays" ? dow >= 1 && dow <= 5 : days!.includes(dow));
  if (matches(now.getDay()) && now.getHours() * 60 + now.getMinutes() < hour * 60 + minute) {
    return wall(now.getFullYear(), now.getMonth(), now.getDate());
  }
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (matches(d.getDay())) return wall(d.getFullYear(), d.getMonth(), d.getDate());
  }
  return from;
}

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
export function toCron(f: Frequency, serverOffset: number, from = Date.now()): string {
  // Convert with the local offset that will hold at the schedule's NEXT
  // occurrence, not the offset right now: when the next run lands after a DST
  // change, today's offset would fire it an hour off the chosen wall time.
  const localOffset = localOffsetAt(nextLocalOccurrence(f, from));
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

export function parseField(expr: string, min: number, max: number): Set<number> | null {
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
