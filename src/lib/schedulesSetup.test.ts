import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { OpenCode, ServerInfo } from "./opencode/client";
import { prepareSchedules, removeScheduleTools, scheduleLocalUrl } from "./schedulesSetup";
import { readTeammates } from "./teammates";
import { useChat } from "../state/chat";
import { useSchedules } from "../state/schedules";
import { useTeammates } from "../state/teammates";

const run = promisify(execFile);

// ---------------------------------------------------------------------------
// A machine behind an OpenCode client: real files in a temp home, and a tiny
// shell for the commands the store runs. The crontab is in memory, so a test
// can see whether the connect path touched it.
// ---------------------------------------------------------------------------

interface Machine {
  home: string;
  client: OpenCode;
  /** Every path `writeFile` was asked for, in order. */
  writes: string[];
  cron: { content: string; reads: number; writes: number };
}

function makeMachine(home: string, opts: { failWrite?: (path: string) => boolean } = {}): Machine {
  const writes: string[] = [];
  const cron = { content: "", reads: 0, writes: 0 };
  const env = { ...process.env, HOME: home, OTTO_HOME: home } as Record<string, string>;
  let failed = false;

  const client = {
    async readFile(path: string) {
      try {
        return await readFile(path, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") throw Object.assign(new Error(`File not found: ${path}`), { status: 404 });
        throw e;
      }
    },
    async writeFile(path: string, body: string) {
      if (!failed && opts.failWrite?.(path)) {
        failed = true;
        throw new Error(`disk full: ${path}`);
      }
      writes.push(path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async exec(cmd: string) {
      // The store's crontab read reports through this marker.
      if (cmd.includes("__OTTO_CRON_RC__")) {
        cron.reads++;
        return { exit: 0, output: `${cron.content}${cron.content.endsWith("\n") ? "" : "\n"}__OTTO_CRON_RC__0\n` };
      }
      // The connect path must never install cron entries by itself.
      if (/(^|\s)crontab\s/.test(cmd)) {
        cron.writes++;
        throw new Error("the connect path must not write the crontab");
      }
      try {
        const { stdout, stderr } = await run("bash", ["-c", cmd], { env, maxBuffer: 4 * 1024 * 1024 });
        return { exit: 0, output: stdout + stderr };
      } catch (e) {
        const err = e as { code?: number; stdout?: string; stderr?: string };
        return { exit: typeof err.code === "number" ? err.code : 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
      }
    },
    async configEntries() {
      const dir = join(home, "config");
      await mkdir(dir, { recursive: true });
      return [
        { type: "document" as const, path: join(dir, "opencode.json") },
        { type: "directory" as const, path: dir },
      ];
    },
    async reloadLocation() {},
  };

  return { home, client: client as unknown as OpenCode, writes, cron };
}
const configPath = (home: string) => join(home, "config", "opencode.json");
const pluginDir = (home: string) => join(home, ".otto", "agent-tool", "otto-schedule");

async function pluginEntries(home: string): Promise<unknown[]> {
  try {
    const cfg = JSON.parse(await readFile(configPath(home), "utf8")) as { plugins?: unknown[] };
    return cfg.plugins ?? [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

let HOME = "";
let m: Machine;

/** The browser store some state modules read through `kv`; bun has none. */
function stubLocalStorage() {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: () => null,
      get length() {
        return data.size;
      },
    },
  });
}

beforeEach(async () => {
  if (!("localStorage" in globalThis)) stubLocalStorage();
  HOME = await mkdtemp(join(tmpdir(), "otto-setup-"));
  m = makeMachine(HOME);
});

afterEach(async () => {
  useChat.setState({ client: null });
  useTeammates.setState({ byId: null, memoryOff: false, schedulesOff: false });
  await rm(HOME, { recursive: true, force: true });
});

const creds = { password: "pw", localUrl: "http://127.0.0.1:4096" };

describe("scheduleLocalUrl", () => {
  test("maps the server's first address to loopback on the same port", () => {
    const info = { urls: ["http://0.0.0.0:5123"] } as unknown as ServerInfo;
    expect(scheduleLocalUrl(info)).toBe("http://127.0.0.1:5123");
  });

  test("falls back to the default port", () => {
    expect(scheduleLocalUrl(null)).toBe("http://127.0.0.1:4096");
    expect(scheduleLocalUrl({ urls: [] } as unknown as ServerInfo)).toBe("http://127.0.0.1:4096");
    expect(scheduleLocalUrl({ urls: ["nonsense"] } as unknown as ServerInfo)).toBe("http://127.0.0.1:4096");
  });
});

describe("prepareSchedules", () => {
  test("installs the runner, credentials, plugin and one config entry", async () => {
    await prepareSchedules(m.client, creds);
    expect(await readFile(join(HOME, ".otto", "bin", "otto-run"), "utf8")).toContain("skipped-running");
    expect(await readFile(join(HOME, ".otto", "server.env"), "utf8")).toContain("OTTO_PASSWORD='pw'");
    expect(await readFile(join(pluginDir(HOME), "index.js"), "utf8")).toContain("otto_schedule");
    expect(await pluginEntries(HOME)).toHaveLength(1);
    // Nothing to run yet, so the crontab is not touched.
    expect(m.cron.writes).toBe(0);
    expect(m.cron.content).toBe("");
  });

  test("is idempotent per client: a second call writes nothing", async () => {
    await prepareSchedules(m.client, creds);
    const written = m.writes.length;
    await prepareSchedules(m.client, creds);
    expect(m.writes.length).toBe(written);
    expect(await pluginEntries(HOME)).toHaveLength(1);
  });

  test("retries after a failed install instead of caching the failure", async () => {
    const flaky = makeMachine(HOME, { failWrite: (path) => path.endsWith("/otto-schedule/index.js") });
    await expect(prepareSchedules(flaky.client, creds)).rejects.toThrow("disk full");
    // The prepare half had already succeeded; the plugin files did not.
    expect(await readFile(join(HOME, ".otto", "bin", "otto-run"), "utf8")).toContain("skipped-running");
    await prepareSchedules(flaky.client, creds);
    expect(await pluginEntries(HOME)).toHaveLength(1);
    expect(await readFile(join(pluginDir(HOME), "index.js"), "utf8")).toContain("otto_schedule");
  });
});

describe("removeScheduleTools", () => {
  test("drops the config entry and leaves the files", async () => {
    await prepareSchedules(m.client, creds);
    await removeScheduleTools(m.client);
    expect(await pluginEntries(HOME)).toHaveLength(0);
    expect(await readFile(join(pluginDir(HOME), "index.js"), "utf8")).toContain("otto_schedule");
    expect(await readFile(join(HOME, ".otto", "bin", "otto-run"), "utf8")).toContain("skipped-running");
    expect(m.cron.writes).toBe(0);
  });

  test("reinstalling after a removal adds exactly one entry", async () => {
    await prepareSchedules(m.client, creds);
    await removeScheduleTools(m.client);
    await prepareSchedules(m.client, creds);
    expect(await pluginEntries(HOME)).toHaveLength(1);
  });
});

describe("Agents can manage schedules", () => {
  test("off removes the plugin and keeps the machine's files; on adds it back", async () => {
    useChat.setState({ client: m.client });
    // Let the roster load settle before the toggle writes it.
    await new Promise((r) => setTimeout(r, 0));
    await prepareSchedules(m.client, creds);
    expect(await pluginEntries(HOME)).toHaveLength(1);

    expect(await useSchedules.getState().setAgentTools(false)).toBe(true);
    expect(useTeammates.getState().schedulesOff).toBe(true);
    expect(await pluginEntries(HOME)).toHaveLength(0);
    const file = JSON.parse(await readFile(join(HOME, "config", "otto", "teammates.json"), "utf8")) as { schedules?: string };
    expect(file.schedules).toBe("off");
    // The flag survives a read of the file (it isn't dropped as unknown).
    expect((await readTeammates(m.client)).schedules).toBe("off");
    // Files stay: existing schedules keep firing.
    expect(await readFile(join(pluginDir(HOME), "index.js"), "utf8")).toContain("otto_schedule");
    expect(await readFile(join(HOME, ".otto", "bin", "otto-run"), "utf8")).toContain("skipped-running");

    expect(await useSchedules.getState().setAgentTools(true)).toBe(true);
    expect(useTeammates.getState().schedulesOff).toBe(false);
    expect(await pluginEntries(HOME)).toHaveLength(1);
    const after = JSON.parse(await readFile(join(HOME, "config", "otto", "teammates.json"), "utf8")) as { schedules?: string };
    expect(after.schedules).toBeUndefined();
  });
});
