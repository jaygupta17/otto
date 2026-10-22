/**
 * Pure scheduling math shared by the app UI, the server plumbing and (later)
 * the agent-facing schedule tool: frequency types, cron conversion in server
 * time, a tiny cron evaluator for "next run" and validation.
 *
 * No I/O happens here. The only implicit inputs are the current local timezone
 * and clock, which `toCron` reads through `Date`.
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
