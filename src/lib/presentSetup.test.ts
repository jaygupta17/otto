import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type { OpenCode } from "./opencode/client";
import { preparePresent, removePresentTools } from "./presentSetup";
import { withSchedulePlugin } from "./schedulesPlugin";

const run = promisify(execFile);

// ---------------------------------------------------------------------------
// A machine behind a client: real files in a temp home, and OpenCode's config
// as a plain JSON file the plugin helpers read and write.
// ---------------------------------------------------------------------------

interface Machine {
  client: OpenCode;
  writes: string[];
  failNext: boolean;
}

function makeMachine(home: string): Machine {
  const env = { ...process.env, HOME: home, OTTO_HOME: home } as Record<string, string>;
  const m: Machine = {
    writes: [],
    failNext: false,
    client: {} as OpenCode,
  };
  Object.assign(m.client, {
    async readFile(path: string) {
      try {
        return await readFile(path, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") throw Object.assign(new Error(`File not found: ${path}`), { status: 404 });
        throw e;
      }
    },
    async writeFile(path: string, body: string) {
      if (m.failNext) {
        m.failNext = false;
        throw new Error(`disk full: ${path}`);
      }
      m.writes.push(path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async exec(cmd: string) {
      const { stdout, stderr } = await run("bash", ["-c", cmd], { env, maxBuffer: 4 * 1024 * 1024 }).catch((e: { stdout?: string; stderr?: string }) => ({ stdout: e.stdout ?? "", stderr: e.stderr ?? "" }));
      return { exit: 0, output: stdout + stderr };
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
  });
  return m;
}

let HOME = "";
let m: Machine;

const pluginDir = (home: string) => join(home, ".otto", "agent-tool", "otto-present");
const configPath = (home: string) => join(home, "config", "opencode.json");

async function entries(home: string): Promise<unknown[]> {
  try {
    const cfg = JSON.parse(await readFile(configPath(home), "utf8")) as { plugins?: unknown[] };
    return cfg.plugins ?? [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

beforeEach(async () => {
  HOME = await mkdtemp(join(tmpdir(), "otto-present-setup-"));
  m = makeMachine(HOME);
});

afterEach(async () => {
  await rm(HOME, { recursive: true, force: true });
});

describe("preparePresent", () => {
  test("writes the tool and adds one config entry", async () => {
    await preparePresent(m.client);
    expect(await readFile(join(pluginDir(HOME), "index.js"), "utf8")).toContain('name: "present"');
    expect(await readFile(join(pluginDir(HOME), "package.json"), "utf8")).toContain("otto-present");
    expect((await entries(HOME)).length).toBe(1);
  });

  test("a second connection doesn't rewrite the files or duplicate the entry", async () => {
    await preparePresent(m.client);
    const writes = m.writes.length;
    await preparePresent(m.client);
    expect(m.writes.length).toBe(writes);
    expect((await entries(HOME)).length).toBe(1);
  });

  test("a failed install leaves no entry, so the next attempt tries again", async () => {
    m.failNext = true;
    await expect(preparePresent(m.client)).rejects.toThrow("disk full");
    expect((await entries(HOME)).length).toBe(0);
    await preparePresent(m.client);
    expect((await entries(HOME)).length).toBe(1);
  });

  test("it sits beside the schedule tool, not instead of it", async () => {
    // Another plugin is already installed; ours is added, not swapped in.
    await mkdir(join(HOME, "config"), { recursive: true });
    await writeFile(configPath(HOME), JSON.stringify(withSchedulePlugin({}, join(HOME, ".otto", "agent-tool", "otto-schedule"))));
    await preparePresent(m.client);
    const list = await entries(HOME);
    expect(list.length).toBe(2);
    expect(JSON.stringify(list)).toContain("otto-present");
    expect(JSON.stringify(list)).toContain("otto-schedule");
  });
});

describe("removePresentTools", () => {
  test("drops the entry and leaves the files", async () => {
    await preparePresent(m.client);
    await removePresentTools(m.client);
    expect((await entries(HOME)).length).toBe(0);
    expect(await readFile(join(pluginDir(HOME), "index.js"), "utf8")).toContain("otto.present");
  });

  test("installs again after a removal", async () => {
    await preparePresent(m.client);
    await removePresentTools(m.client);
    await preparePresent(m.client);
    expect((await entries(HOME)).length).toBe(1);
  });
});
