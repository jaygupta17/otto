/**
 * The generated per-agent memory plugin, tested where it runs: the runtime is
 * imported from a temp folder exactly as OpenCode loads it, and driven through
 * a fake `ctx`/hook with real files on disk. The install path is tested against
 * a fake client, like the other agent tools.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { OpenCode } from "./opencode/client";
import type { GlobalConfig } from "./opencode/config";
import {
  agentMemoryPluginInstalled,
  ensureMemoryPlugin,
  memoryPluginDir,
  memoryPluginPackageJson,
  memoryPluginSource,
  removeMemoryPlugin,
  withAgentMemoryPlugin,
  withoutAgentMemoryPlugin,
  MEMORY_PLUGIN_ID,
} from "./memoryPlugin";
import { withPresentPlugin } from "./presentPlugin";

interface SystemPart {
  type: string;
  text: string;
}
interface HookEvent {
  agent: string;
  system: SystemPart[];
}
interface Runtime {
  default: { id: string };
  AGENT_CONTEXT_SUFFIX: string;
  HEADING: string;
  agentContextPath(root: string, agent: string): string | null;
  readAgentContext(root: string, agent: string): Promise<string | null>;
  notesPart(path: string, text: string): SystemPart;
  default_setup: unknown;
}

let pkgDir = "";
let root = "";
let version = 0;

beforeEach(async () => {
  pkgDir = await mkdtemp(join(tmpdir(), "otto-memory-plugin-"));
  root = join(pkgDir, "memory");
  await mkdir(root, { recursive: true });
  await writeFile(join(pkgDir, "index.js"), memoryPluginSource());
  await writeFile(join(pkgDir, "package.json"), memoryPluginPackageJson());
  const stub = join(pkgDir, "node_modules", "@opencode", "plugin");
  await mkdir(stub, { recursive: true });
  await writeFile(join(stub, "package.json"), JSON.stringify({ name: "@opencode/plugin", type: "module", exports: "./index.js" }));
  await writeFile(join(stub, "index.js"), "export const Plugin = { define: (p) => p };\n");
});

afterEach(async () => {
  await rm(pkgDir, { recursive: true, force: true });
});

async function load(): Promise<Runtime> {
  // A fresh URL per test: Bun caches modules by specifier.
  return (await import(`${pathToFileURL(join(pkgDir, "index.js")).href}?v=${++version}`)) as Runtime;
}

/** The plugin as OpenCode would set it up, with the hook captured. */
async function withHook(options: Record<string, unknown>) {
  const mod = (await load()) as unknown as { default: { id: string; setup(ctx: unknown): Promise<void> } };
  const hooks: { name: string; run(event: HookEvent): Promise<void> }[] = [];
  const ctx = {
    options,
    session: {
      hook: async (name: string, run: (e: HookEvent) => Promise<void>) => {
        hooks.push({ name, run });
        return { dispose: async () => {} };
      },
    },
  };
  await mod.default.setup(ctx);
  return { id: mod.default.id, hooks };
}

const event = (agent: string): HookEvent => ({ agent, system: [{ type: "text", text: "You are Juno." }] });

describe("generated package", () => {
  test("is self-contained: node:* and @opencode/plugin, nothing else", () => {
    const specs = [...memoryPluginSource().matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specs).toEqual(["@opencode/plugin", "node:fs/promises", "node:path"]);
    expect(memoryPluginSource()).not.toContain("import(");
  });

  test("declares its own plugin id", async () => {
    expect((await withHook({ root })).id).toBe(MEMORY_PLUGIN_ID);
  });

  test("the file name is `<agent-id>_context.md`", async () => {
    const m = await load();
    expect(m.AGENT_CONTEXT_SUFFIX).toBe("_context.md");
    expect(m.agentContextPath(root, "patch")).toBe(join(root, "patch_context.md"));
    expect(m.agentContextPath(root, "piper-2")).toBe(join(root, "piper-2_context.md"));
    expect(m.agentContextPath(root, "review.bot")).toBe(join(root, "review.bot_context.md"));
  });

  test("an id that could leave the folder is refused", async () => {
    const m = await load();
    for (const bad of ["..", "../patch", "patch/../juno", "", "  ", "patch context", ".hidden"]) expect(m.agentContextPath(root, bad)).toBeNull();
  });
});

describe("the context hook", () => {
  test("registers `context` in setup", async () => {
    const { hooks } = await withHook({ root });
    expect(hooks).toHaveLength(1);
    expect(hooks[0].name).toBe("context");
  });

  test("pushes the agent's own file onto the system parts, under a heading", async () => {
    await writeFile(join(root, "juno_context.md"), "# Memory\n\nJay likes short replies.\n");
    const { hooks } = await withHook({ root });
    const e = event("juno");
    await hooks[0].run(e);

    expect(e.system).toHaveLength(2);
    expect(e.system[0].text).toBe("You are Juno.");
    const part = e.system[1];
    expect(part.type).toBe("text");
    expect(part.text.split("\n")[0]).toBe("# Your notes");
    expect(part.text).toContain(join(root, "juno_context.md"));
    expect(part.text).toEndWith("Jay likes short replies.");
    // Trimmed, never a trailing blank line.
    expect(part.text).not.toEndWith("\n");
  });

  test("only that agent's file: another teammate reads nothing", async () => {
    await writeFile(join(root, "juno_context.md"), "juno's notes");
    const { hooks } = await withHook({ root });
    const e = event("patch");
    await hooks[0].run(e);
    expect(e.system).toHaveLength(1);
  });

  test("a missing or empty file adds nothing", async () => {
    const { hooks } = await withHook({ root });
    const missing = event("juno");
    await hooks[0].run(missing);
    expect(missing.system).toHaveLength(1);

    await writeFile(join(root, "juno_context.md"), "  \n\n");
    const blank = event("juno");
    await hooks[0].run(blank);
    expect(blank.system).toHaveLength(1);
  });

  test("an edit lands on the very next call", async () => {
    const { hooks } = await withHook({ root });
    await writeFile(join(root, "juno_context.md"), "first");
    const one = event("juno");
    await hooks[0].run(one);
    expect(one.system[1].text).toEndWith("first");

    await writeFile(join(root, "juno_context.md"), "second");
    const two = event("juno");
    await hooks[0].run(two);
    expect(two.system[1].text).toEndWith("second");
  });

  test("a subagent's own id reads its own file, not the one that handed it work", async () => {
    await writeFile(join(root, "juno_context.md"), "lead's notes");
    await writeFile(join(root, "explore_context.md"), "helper's notes");
    const { hooks } = await withHook({ root });
    const child = event("explore");
    await hooks[0].run(child);
    expect(child.system[1].text).toContain("helper's notes");
    expect(child.system[1].text).not.toContain("lead's notes");
  });

  test("running the hook twice on one request doesn't repeat the notes", async () => {
    await writeFile(join(root, "juno_context.md"), "notes");
    const { hooks } = await withHook({ root });
    const e = event("juno");
    await hooks[0].run(e);
    await hooks[0].run(e);
    expect(e.system).toHaveLength(2);
  });

  test("no memory root in the options means no hook at all", async () => {
    expect((await withHook({})).hooks).toHaveLength(0);
    expect((await withHook({ root: "  " })).hooks).toHaveLength(0);
  });

  test("a root that isn't there yet is quiet, not an error", async () => {
    const { hooks } = await withHook({ root: join(pkgDir, "not-yet") });
    const e = event("juno");
    await expect(hooks[0].run(e)).resolves.toBeUndefined();
    expect(e.system).toHaveLength(1);
  });
});

describe("config entries", () => {
  const dir = "/home/u/.otto/agent-tool/otto-memory";

  test("one entry, carrying the memory root", () => {
    const cfg = withAgentMemoryPlugin({}, dir, "/home/u/.config/opencode/memory");
    const entry = (cfg.plugins as { package: string; options: Record<string, unknown> }[])[0];
    expect(entry.package).toBe(`file://${dir}`);
    expect(entry.options).toEqual({ root: "/home/u/.config/opencode/memory" });
    expect(agentMemoryPluginInstalled(cfg, dir, "/home/u/.config/opencode/memory")).toBe(true);
  });

  test("never a second entry", () => {
    const once = withAgentMemoryPlugin({}, dir, "/cfg/memory");
    const twice = withAgentMemoryPlugin(once, dir, "/cfg/memory");
    expect((twice.plugins as unknown[]).length).toBe(1);
  });

  test("a folder the config moved away from counts as not installed", () => {
    const cfg = withAgentMemoryPlugin({}, dir, "/old/config/memory");
    expect(agentMemoryPluginInstalled(cfg, dir, "/new/config/memory")).toBe(false);
  });

  test("leaves the other agent tools alone, and removes only itself", () => {
    const both = withAgentMemoryPlugin(withPresentPlugin({}, "/home/u/.otto/agent-tool/otto-present"), dir, "/cfg/memory");
    expect((both.plugins as unknown[]).length).toBe(2);
    const without = withoutAgentMemoryPlugin(both);
    expect((without.plugins as unknown[]).length).toBe(1);
    expect(JSON.stringify(without.plugins)).toContain("otto-present");
  });

  test("drops an old entry under the v1 `plugin` key too", () => {
    const cfg = { plugin: [`file://${dir}`] };
    expect(withoutAgentMemoryPlugin(cfg).plugin).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Installing on a machine
// ---------------------------------------------------------------------------

interface Machine {
  client: OpenCode;
  config: string;
  writes: number;
}

function makeMachine(home: string): Machine {
  const config = join(home, "config", "opencode.json");
  const env = { ...process.env, HOME: home, OTTO_HOME: home } as Record<string, string>;
  const m: Machine = { config, writes: 0, client: {} as OpenCode };
  Object.assign(m.client, {
    async readFile(path: string) {
      try {
        return await readFile(path, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") throw Object.assign(new Error("not found"), { status: 404 });
        throw e;
      }
    },
    async writeFile(path: string, body: string) {
      m.writes++;
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async exec(command: string) {
      const r = spawnSync("bash", ["-c", command], { encoding: "utf8", env });
      return { exit: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    },
    async configEntries() {
      return [
        { type: "document" as const, path: config },
        { type: "directory" as const, path: join(home, "config") },
      ];
    },
    async reloadLocation() {},
  });
  return m;
}

let HOME = "";
let machine: Machine;

beforeEach(async () => {
  HOME = await mkdtemp(join(tmpdir(), "otto-memory-install-"));
  machine = makeMachine(HOME);
});

afterEach(async () => {
  await rm(HOME, { recursive: true, force: true });
});

const entries = async () => ((JSON.parse(await readFile(machine.config, "utf8")) as GlobalConfig).plugins ?? []) as unknown[];

describe("ensureMemoryPlugin", () => {
  test("writes the package and adds one entry with the root", async () => {
    const dir = await ensureMemoryPlugin(machine.client, "/cfg/memory");
    expect(dir).toBe(memoryPluginDir(HOME));
    expect(await readFile(join(dir, "index.js"), "utf8")).toContain(MEMORY_PLUGIN_ID);
    const list = (await entries()) as { package: string; options: { root: string } }[];
    expect(list).toHaveLength(1);
    expect(list[0].options).toEqual({ root: "/cfg/memory" });
  });

  test("a second connection rewrites nothing and adds nothing", async () => {
    await ensureMemoryPlugin(machine.client, "/cfg/memory");
    const writes = machine.writes;
    await ensureMemoryPlugin(machine.client, "/cfg/memory");
    expect(machine.writes).toBe(writes);
    expect((await entries()).length).toBe(1);
  });

  test("a new memory root moves the entry, not duplicates it", async () => {
    await ensureMemoryPlugin(machine.client, "/old/memory");
    // A fresh client stands for a reconnect to a config folder that moved.
    const next = makeMachine(HOME);
    await ensureMemoryPlugin(next.client, "/new/memory");
    const list = (await entries()) as { options: { root: string } }[];
    expect(list).toHaveLength(1);
    expect(list[0].options.root).toBe("/new/memory");
  });

  test("after removal the next install adds it back", async () => {
    await ensureMemoryPlugin(machine.client, "/cfg/memory");
    await removeMemoryPlugin(machine.client);
    expect(await entries()).toHaveLength(0);
    // The files stay, so a reinstall is just the entry.
    expect(await stat(join(memoryPluginDir(HOME), "index.js"))).toBeTruthy();

    await ensureMemoryPlugin(machine.client, "/cfg/memory");
    expect(await entries()).toHaveLength(1);
  });

  test("remove drops only our entry", async () => {
    await mkdir(join(HOME, "config"), { recursive: true });
    await writeFile(machine.config, JSON.stringify(withPresentPlugin({}, join(HOME, ".otto", "agent-tool", "otto-present"))));
    await ensureMemoryPlugin(machine.client, "/cfg/memory");
    expect((await entries()).length).toBe(2);
    await removeMemoryPlugin(machine.client);
    const left = (await entries()) as { package: string }[];
    expect(left).toHaveLength(1);
    expect(left[0].package).toContain("otto-present");
  });
});
