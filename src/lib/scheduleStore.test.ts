import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RunRecord, Schedule } from "./scheduleCore";
import {
  CRON_BEGIN,
  CRON_END,
  ScheduleLockError,
  ScheduleStore,
  StaleScheduleError,
  cronBlock,
  parseSchedules,
  replaceCronBlock,
  type StoreHost,
} from "./scheduleStore";

// ---------------------------------------------------------------------------
// A StoreHost over a temp directory, with an in-memory crontab.
// ---------------------------------------------------------------------------

interface FakeCron {
  content: string;
  /** When set, every crontab write fails with this message. */
  fail: string | null;
}

function localHost(cron: FakeCron, onRun?: (id: string) => RunRecord | null): StoreHost {
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async read(path) {
      try {
        return await readFile(path, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async write(path, body) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    rename,
    async mkdir(path) {
      try {
        await mkdir(path);
        return true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw e;
      }
    },
    remove: (path) => rm(path, { recursive: true, force: true }),
    async mtime(path) {
      try {
        return (await stat(path)).mtimeMs;
      } catch {
        return null;
      }
    },
    chmod,
    async readCrontab() {
      if (cron.fail) return { ok: false, reason: "failed", message: cron.fail };
      return { ok: true, content: cron.content };
    },
    async writeCrontab(body) {
      if (cron.fail) throw new Error(cron.fail);
      cron.content = body;
    },
    async readRunStates(ids) {
      const out: Record<string, RunRecord> = {};
      for (const id of ids) {
        try {
          out[id] = JSON.parse(await readFile(join(ROOT, ".otto", "state", `${id}.json`), "utf8")) as RunRecord;
        } catch {
          /* no run yet */
        }
      }
      return out;
    },
    async prune(keep) {
      for (const sub of ["tasks", "logs", "state"]) {
        let names: string[] = [];
        try {
          names = await readdir(join(ROOT, ".otto", sub));
        } catch {
          continue;
        }
        for (const name of names) {
          const id = name.split(".")[0];
          if (!keep.includes(id)) await rm(join(ROOT, ".otto", sub, name), { force: true });
        }
      }
    },
    async runTask(id) {
      return onRun ? onRun(id) : null;
    },
  };
}

let ROOT = "";
let cron: FakeCron;

beforeEach(async () => {
  ROOT = await mkdtemp(join(tmpdir(), "otto-schedules-"));
  cron = { content: "", fail: null };
});

afterEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

const store = (opts: { lockRetries?: number; lockWaitMs?: number; onRun?: (id: string) => RunRecord | null } = {}) =>
  new ScheduleStore(localHost(cron, opts.onRun), { dir: join(ROOT, ".otto"), offset: 0, ...opts });

const sched = (over: Partial<Schedule> = {}): Schedule => ({
  id: "sch_one",
  name: "Morning",
  prompt: "Check the tests",
  frequency: { kind: "daily", hour: 9, minute: 0 },
  enabled: true,
  createdAt: 1_700_000_000_000,
  ...over,
});


/** The error a promise rejects with, or a test failure. */
async function failure<T>(p: Promise<T>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("Expected the call to fail.");
}

/** The error a synchronous call throws, or a test failure. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("Expected the call to throw.");
}

const readFileJson = async () => JSON.parse(await readFile(join(ROOT, ".otto", "schedules.json"), "utf8")) as { version: number; rev: number; schedules: Schedule[] };

// ---------------------------------------------------------------------------

describe("file format", () => {
  test("reads v2 and reports its rev", async () => {
    await store().upsert(sched(), 0);
    const data = await store().load();
    expect(data.rev).toBe(1);
    expect(data.schedules).toHaveLength(1);
    expect(data.legacy).toBe(false);
  });

  test("reads v1 `{ schedules }` and a bare array", () => {
    const one = sched();
    const a = parseSchedules(JSON.stringify({ version: 1, schedules: [one] }));
    expect(a.legacy).toBe(true);
    expect(a.rev).toBe(0);
    expect(a.schedules[0].id).toBe("sch_one");
    const b = parseSchedules(JSON.stringify([one]));
    expect(b.legacy).toBe(true);
    expect(b.schedules).toHaveLength(1);
  });

  test("upgrades v1 on the next write and keeps the entries", async () => {
    await mkdir(join(ROOT, ".otto"), { recursive: true });
    await writeFile(join(ROOT, ".otto", "schedules.json"), JSON.stringify({ schedules: [sched({ id: "sch_old" })] }));
    const before = await store().load();
    expect(before.schedules.map((s) => s.id)).toEqual(["sch_old"]);
    const saved = await store().upsert(sched(), 0);
    expect(saved.rev).toBe(1);
    const file = await readFileJson();
    expect(file.version).toBe(2);
    expect(file.rev).toBe(1);
    expect(file.schedules.map((s) => s.id).sort()).toEqual(["sch_old", "sch_one"]);
  });

  test("invalid JSON is an error, not a silent empty list", () => {
    const error = thrown(() => parseSchedules("{ nope")) as Error;
    expect(error.message).toContain("not valid JSON");
    expect(parseSchedules(null)).toEqual({ schedules: [], rev: 0, legacy: false });
  });

  test("drops duplicate ids and malformed entries on read", () => {
    const data = parseSchedules(JSON.stringify({ schedules: [sched(), sched({ name: "Copy" }), { id: "bad id", name: "x" }, { id: "sch_f", name: "f", prompt: "p", frequency: { kind: "daily", hour: 99, minute: 0 } }] }));
    expect(data.schedules).toHaveLength(1);
    expect(data.schedules[0].name).toBe("Morning");
  });

  test("normalizes a custom cron and weekly days", () => {
    const data = parseSchedules(
      JSON.stringify({
        schedules: [
          sched({ id: "sch_c", frequency: { kind: "custom", cron: "  */5   * * * *  " } }),
          sched({ id: "sch_w", frequency: { kind: "weekly", days: [5, 1, 5], hour: 9, minute: 0 } }),
        ],
      }),
    );
    expect(data.schedules.find((s) => s.id === "sch_c")?.frequency).toEqual({ kind: "custom", cron: "*/5 * * * *" });
    expect(data.schedules.find((s) => s.id === "sch_w")?.frequency).toEqual({ kind: "weekly", days: [1, 5], hour: 9, minute: 0 });
  });

  test("round-trips createdBy and lastRun", async () => {
    const run: RunRecord = { at: 1_700_000_100_000, ok: true, sessionID: "ses_1" };
    await store().upsert(sched({ createdBy: "agent:ses_creator", createdByAgent: "build", lastRun: run }), 0);
    const reloaded = await store().load();
    expect(reloaded.schedules[0].createdBy).toBe("agent:ses_creator");
    expect(reloaded.schedules[0].createdByAgent).toBe("build");
    expect(reloaded.schedules[0].lastRun).toEqual(run);
  });

  test("a save with an older lastRun does not walk the run status back", async () => {
    await store().upsert(sched({ lastRun: { at: 2_000, ok: true, sessionID: "ses_new" } }), 0);
    const saved = await store().upsert(sched({ name: "Renamed", lastRun: { at: 1_000, ok: false, error: "old" } }), 1);
    expect(saved.result.lastRun).toEqual({ at: 2_000, ok: true, sessionID: "ses_new" });
  });

  test("merges a newer run state from the runner over the stored lastRun", async () => {
    await store().upsert(sched({ lastRun: { at: 1_000, ok: false, error: "old" } }), 0);
    await mkdir(join(ROOT, ".otto", "state"), { recursive: true });
    await writeFile(join(ROOT, ".otto", "state", "sch_one.json"), JSON.stringify({ at: 2_000, ok: true, sessionID: "ses_new" }));
    const data = await store().load();
    expect(data.schedules[0].lastRun).toEqual({ at: 2_000, ok: true, sessionID: "ses_new" });
    // And a mutation keeps it instead of writing the stale copy back.
    await store().setEnabled("sch_one", false);
    expect((await readFileJson()).schedules[0].lastRun).toEqual({ at: 2_000, ok: true, sessionID: "ses_new" });
  });
});

describe("optimistic concurrency", () => {
  test("a stale baseRev is rejected and carries the current list", async () => {
    await store().upsert(sched(), 0);
    const second = await store().upsert(sched({ id: "sch_two", name: "Two" }), 1);
    expect(second.rev).toBe(2);

    let error: unknown = null;
    try {
      await store().upsert(sched({ name: "Mine" }), 1); // based on the old rev
    } catch (e) {
      error = e;
    }
    expect(error instanceof StaleScheduleError).toBe(true);
    const stale = error as StaleScheduleError;
    expect(stale.current).toBe(2);
    expect(stale.schedules.map((s) => s.id).sort()).toEqual(["sch_one", "sch_two"]);
    // Nothing was overwritten.
    expect((await store().load()).schedules.find((s) => s.id === "sch_one")?.name).toBe("Morning");
  });

  test("no baseRev merges read-modify-write instead of clobbering", async () => {
    await Promise.all([
      store().upsert(sched({ id: "sch_1" })),
      store().upsert(sched({ id: "sch_2" })),
      store().upsert(sched({ id: "sch_3" })),
      store().upsert(sched({ id: "sch_4" })),
      store().upsert(sched({ id: "sch_5" })),
      store().upsert(sched({ id: "sch_6" })),
    ]);
    const data = await store().load();
    expect(data.schedules.map((s) => s.id).sort()).toEqual(["sch_1", "sch_2", "sch_3", "sch_4", "sch_5", "sch_6"]);
    expect(data.rev).toBe(6);
    expect(new Set(data.schedules.map((s) => s.id)).size).toBe(6);
    expect(await readdir(join(ROOT, ".otto"))).not.toContain("schedules.lock");
  });

  test("a remove based on an old rev does not delete a schedule added since", async () => {
    await store().upsert(sched(), 0);
    await store().upsert(sched({ id: "sch_two" }), 1);
    const error = await failure(store().remove("sch_one", 0));
    expect(error instanceof StaleScheduleError).toBe(true);
    expect((await store().load()).schedules.map((s) => s.id).sort()).toEqual(["sch_one", "sch_two"]);
  });

  test("one field can be patched without touching the rest", async () => {
    await store().upsert(sched({ createdBy: "user", directory: "/work" }), 0);
    await store().patch("sch_one", { name: "Renamed", enabled: false });
    const s = (await store().load()).schedules[0];
    expect(s.name).toBe("Renamed");
    expect(s.enabled).toBe(false);
    expect(s.directory).toBe("/work");
    expect(s.createdBy).toBe("user");
  });
});

describe("locking", () => {
  test("a held lock times out with ScheduleLockError", async () => {
    await mkdir(join(ROOT, ".otto", "schedules.lock"), { recursive: true });
    const s = store({ lockRetries: 3, lockWaitMs: 5 });
    const error = await failure(s.upsert(sched(), 0));
    expect(error instanceof ScheduleLockError).toBe(true);
    expect(await readdir(join(ROOT, ".otto"))).toContain("schedules.lock");
    const loaded = await store().load();
    expect(loaded.rev).toBe(0);
    expect(loaded.schedules).toEqual([]);
  });

  test("a lock older than 30s is removed and the write proceeds", async () => {
    const lock = join(ROOT, ".otto", "schedules.lock");
    await mkdir(lock, { recursive: true });
    const old = new Date(Date.now() - 40_000);
    await utimes(lock, old, old);
    const saved = await store({ lockRetries: 3, lockWaitMs: 5 }).upsert(sched(), 0);
    expect(saved.rev).toBe(1);
    expect(await readdir(join(ROOT, ".otto"))).not.toContain("schedules.lock");
  });
});

describe("crontab", () => {
  const unrelated = ["MAILTO=me@example.com", "0 3 * * * /usr/local/bin/backup", "# keep me"];

  test("replaces only the marked block and keeps unrelated lines in order", async () => {
    cron.content = `${unrelated[0]}\n${CRON_BEGIN}\n0 1 * * * old\n${CRON_END}\n${unrelated[2]}\n`;
    await store().upsert(sched(), 0);
    const lines = cron.content.trimEnd().split("\n");
    expect(lines[0]).toBe(unrelated[0]);
    expect(lines).toContain(unrelated[2]);
    expect(lines.filter((l) => l.trim() === CRON_BEGIN)).toHaveLength(1);
    expect(lines.filter((l) => l.trim() === CRON_END)).toHaveLength(1);
    expect(cron.content).not.toContain("old");
    expect(cron.content).toContain("0 9 * * *");
    // A second write is idempotent.
    const once = cron.content;
    await store().setEnabled("sch_one", true);
    expect(cron.content).toBe(once);
  });

  test("a disabled schedule has no line; deleting drops it", async () => {
    await store().upsert(sched({ id: "sch_a" }), 0);
    await store().upsert(sched({ id: "sch_b", enabled: false }), 1);
    expect(cron.content).toContain("sch_a");
    expect(cron.content).not.toContain("sch_b");
    await store().remove("sch_a", 2);
    expect(cron.content).not.toContain("sch_a");
    expect(cron.content).toContain(CRON_BEGIN);
  });

  test("an unclosed block is swallowed rather than duplicated", () => {
    const out = replaceCronBlock(`a\n${CRON_BEGIN}\n0 1 * * * x\nb\n`, cronBlock([], "/tmp/x", 0));
    expect(out).toBe(`a\n${CRON_BEGIN}\n${CRON_END}\n`);
  });

  test("a directory with spaces is quoted in the cron line", () => {
    const block = cronBlock([sched()], "/home/a b/.otto", 0);
    expect(block).toContain("OTTO_DIR='/home/a b/.otto'");
    expect(block).toContain("'/home/a b/.otto/bin/otto-run'");
  });

  test("a failed crontab does not lose the schedule: it warns", async () => {
    cron.fail = "crontab: Operation not permitted";
    const saved = await store().upsert(sched(), 0);
    expect(saved.warnings.join(" ")).toContain("cron-failed");
    expect((await store().load()).schedules).toHaveLength(1);
  });
});

describe("runNow", () => {
  test("runs through the host and records lastRun", async () => {
    const run: RunRecord = { at: 1_700_000_200_000, ok: true, sessionID: "ses_run" };
    const s = store({ onRun: (id) => (id === "sch_one" ? run : null) });
    await s.upsert(sched(), 0);
    const out = await s.runNow("sch_one");
    expect(out.run).toEqual(run);
    expect(out.rev).toBe(2);
    expect((await readFileJson()).schedules[0].lastRun).toEqual(run);
  });

  test("refuses an id that is not in the file", async () => {
    const error = (await failure(store().runNow("sch_nope"))) as Error;
    expect(error.message).toContain("No schedule");
  });
});

describe("runner install", () => {
  test("writes the runner and leaves it executable", async () => {
    await store().upsert(sched(), 0);
    const mode = (await stat(join(ROOT, ".otto", "bin", "otto-run"))).mode & 0o777;
    expect(mode).toBe(0o755);
    const body = await readFile(join(ROOT, ".otto", "bin", "otto-run"), "utf8");
    expect(body).toContain("skipped-running");
    expect(body).toContain("timeout 1800");
    expect(body).not.toContain("apt-get");
    expect(body).not.toContain("sudo");
  });

  test("writes task payloads and prunes removed ids", async () => {
    await store().upsert(sched({ id: "sch_a" }), 0);
    await store().upsert(sched({ id: "sch_b" }), 1);
    expect((await readdir(join(ROOT, ".otto", "tasks"))).sort()).toEqual(["sch_a.prompt.json", "sch_a.session.json", "sch_b.prompt.json", "sch_b.session.json"]);
    const session = JSON.parse(await readFile(join(ROOT, ".otto", "tasks", "sch_a.session.json"), "utf8"));
    expect(session.title).toBe("Scheduled: Morning");
    await store().remove("sch_a", 2);
    expect((await readdir(join(ROOT, ".otto", "tasks"))).sort()).toEqual(["sch_b.prompt.json", "sch_b.session.json"]);
    // A deleted payload is rebuilt by the next change, even if that schedule didn't change.
    await rm(join(ROOT, ".otto", "tasks", "sch_b.prompt.json"));
    await store().setEnabled("sch_b", false, 3);
    expect(await readFile(join(ROOT, ".otto", "tasks", "sch_b.prompt.json"), "utf8")).toContain("Check the tests");
  });

  test("install writes credentials with app-only permissions", async () => {
    await store().install({ password: "pw", localUrl: "http://127.0.0.1:4096" });
    const env = join(ROOT, ".otto", "server.env");
    expect(await readFile(env, "utf8")).toContain("OTTO_PASSWORD='pw'");
    expect((await stat(env)).mode & 0o777).toBe(0o600);
  });
});
