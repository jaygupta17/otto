import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  schedulePluginInstalled,
  schedulePluginPackageJson,
  schedulePluginSource,
  withSchedulePermissions,
  withSchedulePlugin,
  withoutSchedulePlugin,
} from "./schedulesPlugin";
import type { Frequency } from "./scheduleCore";
import { CRON_BEGIN as APP_CRON_BEGIN, CRON_END as APP_CRON_END, RUNNER_SCRIPT as APP_RUNNER } from "./scheduleStore";

// ---------------------------------------------------------------------------
// The generated package, on disk, loaded the way OpenCode loads it.
// ---------------------------------------------------------------------------

const CRON_BEGIN = "# >>> otto schedules (managed by Otto; edit in the app) >>>";
const CRON_END = "# <<< otto schedules <<<";

interface RuntimeSchedule {
  id: string;
  name: string;
  prompt: string;
  frequency: Frequency;
  enabled: boolean;
  createdAt: number;
  directory?: string;
  createdBy?: string;
  createdByAgent?: string;
  lastRun?: { at: number; ok: boolean; sessionID?: string; error?: string };
}

interface RuntimeStore {
  dir: string;
  load(): Promise<{ schedules: RuntimeSchedule[]; rev: number; legacy: boolean }>;
  upsert(s: RuntimeSchedule, baseRev?: number): Promise<{ schedules: RuntimeSchedule[]; rev: number; warnings: string[]; result: RuntimeSchedule }>;
  patch(id: string, fields: Partial<RuntimeSchedule>, opts?: { baseRev?: number }): Promise<{ schedules: RuntimeSchedule[]; rev: number; result: RuntimeSchedule }>;
  remove(id: string, baseRev?: number): Promise<{ schedules: RuntimeSchedule[]; rev: number }>;
  setEnabled(id: string, enabled: boolean, baseRev?: number): Promise<{ schedules: RuntimeSchedule[]; rev: number }>;
  probeCron(): Promise<{ hasCron: boolean; message?: string }>;
}

interface RuntimeModule {
  default: { id: string };
  createScheduleStore(opts: { dir: string; env: Record<string, string> }): RuntimeStore;
  parseSchedules(text: string): { schedules: RuntimeSchedule[]; rev: number; legacy: boolean };
  permissionAction(input: { action: string }): string;
  TOOL_SCHEMA: { properties: { action: { enum: string[] } }; required: string[] };
  dispatch(store: RuntimeStore, input: Record<string, unknown>, context: { sessionID?: string; agent?: string }): Promise<Record<string, unknown>>;
  callTool(
    store: RuntimeStore,
    input: Record<string, unknown>,
    context: { sessionID?: string; agent?: string },
    assert: (action: string, resource: string) => Promise<void>,
  ): Promise<Record<string, unknown>>;
  RUNNER_SCRIPT: string;
  CRON_BEGIN: string;
  CRON_END: string;
  cronBlock(schedules: RuntimeSchedule[], dir: string): string;
  replaceCronBlock(text: string, block: string): string;
}

let ROOT = "";
let env: Record<string, string>;
let cronFile = "";

beforeEach(async () => {
  ROOT = await mkdtemp(join(tmpdir(), "otto-plugin-"));
  cronFile = join(ROOT, "crontab.txt");
  env = { ...process.env, OTTO_CRONTAB: join(ROOT, "bin", "crontab") } as Record<string, string>;
  await writeFile(join(ROOT, "package.json"), JSON.stringify({ name: "otto-schedule-test", type: "module" }));
  await writeFile(join(ROOT, "index.js"), schedulePluginSource());
  await writeFile(join(ROOT, "package.json"), schedulePluginPackageJson());
  const stub = join(ROOT, "node_modules", "@opencode", "plugin");
  await mkdir(stub, { recursive: true });
  await writeFile(join(stub, "package.json"), JSON.stringify({ name: "@opencode/plugin", type: "module", exports: "./index.js" }));
  await writeFile(join(stub, "index.js"), 'export const Plugin = { define: (p) => p };\n');
  await mkdir(join(ROOT, "bin"), { recursive: true });
  await writeFile(
    join(ROOT, "bin", "crontab"),
    ['#!/bin/sh', 'if [ "$1" = "-l" ]; then', '  if [ -f "$FAKE_CRONTAB" ]; then cat "$FAKE_CRONTAB"; else echo "no crontab for tester" >&2; exit 1; fi', "  exit 0", "fi", 'cat "$1" > "$FAKE_CRONTAB"', ""].join("\n"),
  );
  await chmod(join(ROOT, "bin", "crontab"), 0o755);
  env.FAKE_CRONTAB = cronFile;
  env.PATH = `${join(ROOT, "bin")}:${process.env.PATH ?? ""}`;
});

afterEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

let version = 0;
async function load(): Promise<RuntimeModule> {
  // A fresh URL per test: Bun caches modules by specifier.
  return (await import(`${pathToFileURL(join(ROOT, "index.js")).href}?v=${++version}`)) as RuntimeModule;
}

function makeStore(module: RuntimeModule, dir = join(ROOT, ".otto"), overrides: Record<string, string> = {}) {
  return module.createScheduleStore({ dir, env: { ...env, ...overrides } });
}

const sched = (over: Partial<RuntimeSchedule> = {}): RuntimeSchedule => ({
  id: "sch_one",
  name: "Morning",
  prompt: "Check the tests",
  frequency: { kind: "daily", hour: 9, minute: 0 },
  enabled: true,
  createdAt: 1_700_000_000_000,
  ...over,
});

const readCron = () => readFile(cronFile, "utf8");
const readJson = async () => JSON.parse(await readFile(join(ROOT, ".otto", "schedules.json"), "utf8")) as { version: number; rev: number; schedules: RuntimeSchedule[] };

// ---------------------------------------------------------------------------

describe("generated package", () => {
  test("is self-contained: only node:* and @opencode/plugin imports", () => {
    const source = schedulePluginSource();
    const specs = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(/^(node:|@opencode\/plugin$)/.test(s)).toBe(true);
    expect(source).not.toContain("import(");
  });

  test("exports a Plugin with our id", async () => {
    const module = await load();
    expect(module.default.id).toBe("otto.schedules");
  });

  test("ships the one-tool schema", async () => {
    const module = await load();
    expect(module.TOOL_SCHEMA.required).toEqual(["action"]);
    expect(module.TOOL_SCHEMA.properties.action.enum).toEqual(["list", "create", "update", "setEnabled", "delete", "run"]);
  });

  test("maps actions to permission actions", async () => {
    const module = await load();
    expect(module.permissionAction({ action: "list" })).toBe("otto_schedule.read");
    for (const a of ["create", "update", "setEnabled"]) expect(module.permissionAction({ action: a })).toBe("otto_schedule.write");
    expect(module.permissionAction({ action: "delete" })).toBe("otto_schedule.delete");
    expect(module.permissionAction({ action: "run" })).toBe("otto_schedule.run");
    expect(() => module.permissionAction({ action: "nope" })).toThrow(/Unknown action/);
  });
});

describe("store", () => {
  test("creates, persists and reloads v2", async () => {
    const module = await load();
    const store = makeStore(module);
    const created = await store.upsert(sched({ createdBy: "agent:ses_1", createdByAgent: "build" }));
    expect(created.rev).toBe(1);
    expect(created.warnings).toEqual([]);
    const data = await store.load();
    expect(data.rev).toBe(1);
    expect(data.legacy).toBe(false);
    expect(data.schedules[0].createdBy).toBe("agent:ses_1");
    expect(data.schedules[0].createdByAgent).toBe("build");
    expect((await readJson()).version).toBe(2);
  });

  test("a stale rev is reported with the current rev and list", async () => {
    const module = await load();
    const a = makeStore(module);
    const b = makeStore(module);
    await a.load();
    await b.upsert(sched({ id: "sch_b" }));
    const error = await a.upsert(sched({ id: "sch_a" }), 0).then(
      () => null,
      (e: { stale?: boolean; current?: number; schedules?: RuntimeSchedule[] }) => e,
    );
    expect(error?.stale).toBe(true);
    expect(error?.current).toBe(1);
    expect(error?.schedules?.map((s) => s.id)).toEqual(["sch_b"]);
  });

  test("two writers without a rev merge instead of clobbering", async () => {
    const module = await load();
    const a = makeStore(module);
    const b = makeStore(module);
    await Promise.all([1, 2, 3, 4].map((i) => (i % 2 ? a : b).upsert(sched({ id: `sch_${i}` }))));
    const data = await a.load();
    expect(data.schedules.map((s) => s.id).sort()).toEqual(["sch_1", "sch_2", "sch_3", "sch_4"]);
    expect(data.rev).toBe(4);
    expect(new Set(data.schedules.map((s) => s.id)).size).toBe(4);
  });

  test("upgrades a v1 file on write", async () => {
    const module = await load();
    await mkdir(join(ROOT, ".otto"), { recursive: true });
    await writeFile(join(ROOT, ".otto", "schedules.json"), JSON.stringify({ schedules: [sched({ id: "sch_old" })] }));
    const store = makeStore(module);
    expect((await store.load()).legacy).toBe(true);
    await store.upsert(sched({ id: "sch_new" }), 0);
    const file = await readJson();
    expect(file.version).toBe(2);
    expect(file.schedules.map((s) => s.id).sort()).toEqual(["sch_new", "sch_old"]);
  });

  test("round-trips lastRun and merges the runner's state file", async () => {
    const module = await load();
    const store = makeStore(module);
    await store.upsert(sched({ lastRun: { at: 1_000, ok: false, error: "old" } }));
    await mkdir(join(ROOT, ".otto", "state"), { recursive: true });
    await writeFile(join(ROOT, ".otto", "state", "sch_one.json"), JSON.stringify({ at: 2_000, ok: true, sessionID: "ses_new" }));
    expect((await store.load()).schedules[0].lastRun).toEqual({ at: 2_000, ok: true, sessionID: "ses_new" });
  });

  test("patch touches only the named fields", async () => {
    const module = await load();
    const store = makeStore(module);
    await store.upsert(sched({ directory: "/work", createdBy: "user" }));
    await store.patch("sch_one", { name: "Renamed" });
    const s = (await store.load()).schedules[0];
    expect(s.name).toBe("Renamed");
    expect(s.directory).toBe("/work");
    expect(s.createdBy).toBe("user");
  });

  test("removes an id and its payloads", async () => {
    const module = await load();
    const store = makeStore(module);
    await store.upsert(sched({ id: "sch_keep" }));
    await store.upsert(sched({ id: "sch_drop" }), 1);
    await store.remove("sch_drop", 2);
    expect((await store.load()).schedules.map((s) => s.id)).toEqual(["sch_keep"]);
    const tasks = await readFile(join(ROOT, ".otto", "tasks", "sch_keep.prompt.json"), "utf8");
    expect(tasks).toContain("Check the tests");
  });
});

describe("tool actions", () => {
  const ctx = { sessionID: "ses_tool", agent: "build" };

  test("create stamps the agent session and validates ranges", async () => {
    const module = await load();
    const store = makeStore(module);
    const out = await module.dispatch(store, { action: "create", name: "Nightly", prompt: "Run tests", frequency: { kind: "daily", hour: 2, minute: 30 }, directory: "/work" }, ctx);
    const made = out.schedule as RuntimeSchedule;
    expect(made.createdBy).toBe("agent:ses_tool");
    expect(made.createdByAgent).toBe("build");
    expect(made.enabled).toBe(true);
    expect(made.directory).toBe("/work");
    expect(made.id.startsWith("sch_")).toBe(true);
    expect((await store.load()).schedules).toHaveLength(1);

    await expect(module.dispatch(store, { action: "create", name: "Bad", prompt: "p", frequency: { kind: "daily", hour: 24, minute: 0 } }, ctx)).rejects.toThrow(/hour/);
    await expect(module.dispatch(store, { action: "create", name: "Bad", prompt: "p", frequency: { kind: "custom", cron: "0 0 * *" } }, ctx)).rejects.toThrow(/cron/);
    await expect(module.dispatch(store, { action: "create", name: "Bad", prompt: "p", frequency: { kind: "weekly", days: [], hour: 9 } }, ctx)).rejects.toThrow(/days/);
  });

  test("create refuses a timezone that is not this machine's", async () => {
    const module = await load();
    const store = makeStore(module);
    const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const wrong = here === "UTC" ? "Asia/Tokyo" : "UTC";
    await expect(module.dispatch(store, { action: "create", name: "Zone", prompt: "p", frequency: { kind: "daily", hour: 9, minute: 0 }, timezone: wrong }, ctx)).rejects.toThrow(/timezone/);
    const ok = await module.dispatch(store, { action: "create", name: "Zone", prompt: "p", frequency: { kind: "hourly", minute: 5 }, timezone: here }, ctx);
    expect((ok.schedule as RuntimeSchedule).frequency).toEqual({ kind: "hourly", minute: 5 });
  });

  test("update changes only the fields it names", async () => {
    const module = await load();
    const store = makeStore(module);
    const made = (await module.dispatch(store, { action: "create", name: "Nightly", prompt: "Run tests", frequency: { kind: "daily", hour: 2, minute: 30 }, directory: "/work" }, ctx)).schedule as RuntimeSchedule;
    const out = await module.dispatch(store, { action: "update", id: made.id, name: "Renamed" }, ctx);
    const after = out.schedule as RuntimeSchedule;
    expect(after.name).toBe("Renamed");
    expect(after.prompt).toBe("Run tests");
    expect(after.directory).toBe("/work");
    await expect(module.dispatch(store, { action: "update", id: made.id }, ctx)).rejects.toThrow(/at least one/);
  });

  test("update with a rev refuses a newer change", async () => {
    const module = await load();
    const store = makeStore(module);
    const made = (await module.dispatch(store, { action: "create", name: "Nightly", prompt: "Run tests", frequency: { kind: "daily", hour: 2, minute: 30 } }, ctx)).schedule as RuntimeSchedule;
    const listed = await module.dispatch(store, { action: "list" }, ctx);
    expect(listed.rev).toBe(1);
    await module.dispatch(store, { action: "update", id: made.id, prompt: "Human edit", rev: 1 }, ctx);
    const stale = await module.callTool(store, { action: "update", id: made.id, prompt: "Agent edit", rev: 1 }, ctx, async () => {});
    expect(stale.stale).toBe(true);
    expect(stale.rev).toBe(2);
    expect(((await store.load()).schedules[0]).prompt).toBe("Human edit");
  });

  test("asks the matching permission before acting", async () => {
    const module = await load();
    const store = makeStore(module);
    const made = (await module.dispatch(store, { action: "create", name: "Nightly", prompt: "Run tests", frequency: { kind: "daily", hour: 2, minute: 30 } }, ctx)).schedule as RuntimeSchedule;
    const seen: string[] = [];
    const assert = async (action: string, resource: string) => {
      seen.push(`${action}|${resource}`);
    };
    await module.callTool(store, { action: "list" }, ctx, assert);
    await module.callTool(store, { action: "update", id: made.id, name: "X" }, ctx, assert);
    await module.callTool(store, { action: "delete", id: made.id }, ctx, assert);
    expect(seen).toEqual(["otto_schedule.read|*", "otto_schedule.write|" + made.id, "otto_schedule.delete|" + made.id]);
  });

  test("an unknown action is a JSON error, not a crash", async () => {
    const module = await load();
    const out = await module.callTool(makeStore(module), { action: "explode" }, ctx, async () => {});
    expect(out.error).toBe("failed");
    expect(String(out.message)).toContain("Unknown action");
  });

  test("setEnabled, delete and list", async () => {
    const module = await load();
    const store = makeStore(module);
    const made = (await module.dispatch(store, { action: "create", name: "Nightly", prompt: "Run tests", frequency: { kind: "daily", hour: 2, minute: 30 } }, ctx)).schedule as RuntimeSchedule;
    await module.dispatch(store, { action: "setEnabled", id: made.id, enabled: false }, ctx);
    expect((await store.load()).schedules[0].enabled).toBe(false);
    const list = await module.dispatch(store, { action: "list" }, ctx);
    expect((list.schedules as (RuntimeSchedule & { when?: string })[])[0].when).toBe("Every day at 02:30");
    await module.dispatch(store, { action: "delete", id: made.id }, ctx);
    expect((await store.load()).schedules).toHaveLength(0);
    await expect(module.dispatch(store, { action: "delete", id: "sch_nope" }, ctx)).rejects.toThrow(/No schedule/);
  });
});

describe("crontab", () => {
  test("preserves unrelated lines and replaces the block", async () => {
    await writeFile(cronFile, `MAILTO=me@example.com\n${CRON_BEGIN}\n0 1 * * * stale\n${CRON_END}\n0 4 * * * /usr/bin/backup\n`);
    const module = await load();
    await makeStore(module).upsert(sched());
    const text = await readCron();
    expect(text).toContain("MAILTO=me@example.com");
    expect(text).toContain("0 4 * * * /usr/bin/backup");
    expect(text).not.toContain("stale");
    expect(text.split(CRON_BEGIN).length - 1).toBe(1);
    expect(text).toContain("0 9 * * *");
    expect(text).toContain("sch_one");
  });

  test("works when no crontab exists yet", async () => {
    const module = await load();
    const store = makeStore(module);
    const out = await store.upsert(sched());
    expect(out.warnings).toEqual([]);
    expect(await readCron()).toContain("sch_one");
  });

  test("a failed crontab warns but keeps the schedule", async () => {
    const failing = join(ROOT, "broken");
    await mkdir(failing, { recursive: true });
    await writeFile(join(failing, "crontab"), '#!/bin/sh\necho "crontab: cannot open spool" >&2\nexit 1\n');
    await chmod(join(failing, "crontab"), 0o755);
    const module = await load();
    const store = makeStore(module, join(ROOT, ".otto"), { OTTO_CRONTAB: "", PATH: `${failing}:${process.env.PATH ?? ""}` });
    const out = await store.upsert(sched());
    expect(out.warnings.join(" ")).toContain("cron-failed");
    expect((await store.load()).schedules).toHaveLength(1);
  });

  test("a machine without cron is detected, and a schedule still saves", async () => {
    const empty = join(ROOT, "empty-path");
    await mkdir(empty, { recursive: true });
    const module = await load();
    const store = makeStore(module, join(ROOT, ".otto"), { OTTO_CRONTAB: "", PATH: empty });
    expect(await store.probeCron()).toMatchObject({ hasCron: false });
    const out = await store.upsert(sched());
    expect(out.warnings).toContain("cron-missing");
    expect((await store.load()).schedules).toHaveLength(1);
  });
});

describe("runner", () => {
  test("is byte for byte the app's runner", async () => {
    const module = await load();
    expect(module.RUNNER_SCRIPT).toBe(APP_RUNNER);
    expect(module.CRON_BEGIN).toBe(APP_CRON_BEGIN);
    expect(module.CRON_END).toBe(APP_CRON_END);
  });

  test("has a per-task lock, a timeout, and no sudo", async () => {
    const module = await load();
    expect(module.RUNNER_SCRIPT).toContain('mkdir "$LOCK"');
    expect(module.RUNNER_SCRIPT).toContain("skipped-running");
    expect(module.RUNNER_SCRIPT).toContain("timeout 1800");
    expect(module.RUNNER_SCRIPT).not.toContain("sudo");
    expect(module.RUNNER_SCRIPT).not.toContain("apt-get");
  });
});

describe("config helpers", () => {
  test("adds exactly one entry and replaces an older one", () => {
    const one = withSchedulePlugin({}, "/home/u/.otto/agent-tool/otto-schedule");
    const two = withSchedulePlugin(one, "/home/u/.otto/agent-tool/otto-schedule");
    expect((two.plugins as unknown[]).length).toBe(1);
    expect(schedulePluginInstalled(two, "/home/u/.otto/agent-tool/otto-schedule")).toBe(true);
    expect(schedulePluginInstalled(two, "/somewhere/else")).toBe(false);
  });

  test("removes the entry but leaves other plugins alone", () => {
    const cfg = withSchedulePlugin({ plugins: ["opencode-composio"] }, "/home/u/.otto/agent-tool/otto-schedule");
    const next = withoutSchedulePlugin(cfg);
    expect(next.plugins).toEqual(["opencode-composio"]);
  });

  test("adds permission defaults once, never over the user's own rules", () => {
    const first = withSchedulePermissions({});
    expect(first.permissions?.find((r) => r.action === "otto_schedule.write")?.effect).toBe("ask");
    expect(first.permissions?.find((r) => r.action === "otto_schedule.read")?.effect).toBe("allow");
    const again = withSchedulePermissions(first);
    expect(again.permissions).toHaveLength(first.permissions!.length);
    const mine = withSchedulePermissions({ permissions: [{ action: "otto_schedule.write", resource: "*", effect: "allow" }] });
    expect(mine.permissions).toHaveLength(4);
    expect(mine.permissions?.find((r) => r.action === "otto_schedule.write")?.effect).toBe("allow");
  });
});
