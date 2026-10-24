/**
 * Memory is plain files, so most of it can be tested against a real temp
 * folder with a fake OpenCode client. The fake client is deliberately small:
 * the same file API methods the app uses, backed by node's fs and one shell.
 */
import { afterEach, beforeEach, expect, describe, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  appendDaily,
  classifyMemoryPath,
  contextTemplate,
  dayStamp,
  ensureProjectFile,
  formatDailyLine,
  installMemory,
  lineCount,
  memoryInstalled,
  projectSlug,
  readMemoryState,
  removeMemory,
  resolveMemoryPath,
  withMemoryInstructions,
  withoutMemoryInstructions,
  withoutMemoryPlugin,
  writeMemoryFile,
  CONTEXT_LINE_LIMIT,
  MEMORY_PLUGIN,
} from "./memory";
import type { OpenCode } from "./opencode/client";
import type { GlobalConfig } from "./opencode/config";
import { teammatePrompt } from "./teammates";

function fakeClient(dir: string): OpenCode {
  const client = {
    async configEntries() {
      const entries: { type: "directory" | "document"; path: string }[] = [{ type: "directory", path: dir }];
      try {
        await stat(join(dir, "opencode.json"));
        entries.unshift({ type: "document", path: join(dir, "opencode.json") });
      } catch {
        /* no config yet */
      }
      return entries;
    },
    async readFile(path: string) {
      try {
        return await readFile(path, "utf8");
      } catch (e) {
        if ((e as { code?: string }).code === "ENOENT") throw { status: 404 };
        throw e;
      }
    },
    async writeFile(path: string, content: string) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content);
    },
    async exec(command: string) {
      const r = spawnSync("bash", ["-c", command], { encoding: "utf8" });
      return { exit: r.status ?? 1, output: r.stdout ?? "" };
    },
    async reloadLocation() {},
  };
  return client as unknown as OpenCode;
}

const exists = async (path: string) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

let dir: string;
let client: OpenCode;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "otto-memory-"));
  client = fakeClient(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("global config instructions", () => {
  test("adds the absolute context path and keeps other entries", () => {
    const cfg: GlobalConfig = { instructions: ["/home/me/AGENTS.md", "/home/me/notes.md"] };
    const next = withMemoryInstructions(cfg, "/home/me/.config/opencode/memory/context.md");
    expect(next.instructions).toEqual(["/home/me/AGENTS.md", "/home/me/notes.md", "/home/me/.config/opencode/memory/context.md"]);
    expect(memoryInstalled(next)).toBe(true);
  });

  test("replaces a relative or stale context entry instead of duplicating it", () => {
    const cfg: GlobalConfig = { instructions: ["memory/context.md", "/home/me/AGENTS.md", "/old/config/memory/context.md"] };
    const next = withMemoryInstructions(cfg, "/new/config/memory/context.md");
    expect(next.instructions).toEqual(["/home/me/AGENTS.md", "/new/config/memory/context.md"]);
  });

  test("install is idempotent", () => {
    const once = withMemoryInstructions({}, "/cfg/memory/context.md");
    const twice = withMemoryInstructions(once, "/cfg/memory/context.md");
    expect(twice.instructions).toEqual(["/cfg/memory/context.md"]);
  });

  test("removes only our entry and drops the key when nothing is left", () => {
    const cfg: GlobalConfig = { instructions: ["/home/me/AGENTS.md", "/cfg/memory/context.md"] };
    expect(withoutMemoryInstructions(cfg).instructions).toEqual(["/home/me/AGENTS.md"]);
    expect(withoutMemoryInstructions({ instructions: ["/cfg/memory/context.md"] })).not.toHaveProperty("instructions");
    expect(withoutMemoryInstructions({})).not.toHaveProperty("instructions");
  });

  test("does not mistake a lookalike file for the context", () => {
    const cfg: GlobalConfig = { instructions: ["/home/me/notmemory/context.md"] };
    expect(memoryInstalled(cfg)).toBe(false);
    expect(withMemoryInstructions(cfg, "/cfg/memory/context.md").instructions).toEqual(["/home/me/notmemory/context.md", "/cfg/memory/context.md"]);
  });

  test("strips the old plugin from both keys and keeps other plugins", () => {
    const cfg: GlobalConfig = {
      plugins: [{ package: `${MEMORY_PLUGIN}@2.0.0`, options: { autoLoad: true } }, "@someone/other@1.0.0"],
      plugin: [`${MEMORY_PLUGIN}@1.0.0`],
    };
    const next = withoutMemoryPlugin(cfg);
    expect(next.plugins).toEqual(["@someone/other@1.0.0"]);
    expect(next).not.toHaveProperty("plugin");
  });
});

describe("path validation", () => {
  const root = "/home/me/.config/opencode/memory";

  test("accepts relative and absolute paths inside the folder", () => {
    expect(resolveMemoryPath(root, "projects/otto.md")).toBe(`${root}/projects/otto.md`);
    expect(resolveMemoryPath(root, `${root}/learnings/tauri.md`)).toBe(`${root}/learnings/tauri.md`);
    expect(resolveMemoryPath(root, "./daily/2026-10-22.md")).toBe(`${root}/daily/2026-10-22.md`);
  });

  test("rejects .. anywhere in the path", () => {
    expect(() => resolveMemoryPath(root, "../secrets.md")).toThrow();
    expect(() => resolveMemoryPath(root, "projects/../../etc/passwd")).toThrow();
    expect(() => resolveMemoryPath(`${root}/projects`, "../agents/x.md")).toThrow();
  });

  test("rejects absolute escapes and the folder itself", () => {
    expect(() => resolveMemoryPath(root, "/etc/passwd")).toThrow();
    expect(() => resolveMemoryPath(root, root)).toThrow();
    expect(() => resolveMemoryPath(root, `${root}/../secrets.md`)).toThrow();
    expect(() => resolveMemoryPath(root, "")).toThrow();
  });
});

describe("context template", () => {
  test("has the headings the prompt relies on and fits the limit", () => {
    const t = contextTemplate();
    for (const heading of ["## About you", "## Now", "## Next", "## Blocked", "## Decisions", "## Pointers"]) expect(t).toContain(heading);
    expect(lineCount(t)).toBeLessThanOrEqual(CONTEXT_LINE_LIMIT);
  });

  test("counts visible lines, not trailing newlines", () => {
    expect(lineCount("")).toBe(0);
    expect(lineCount("one")).toBe(1);
    expect(lineCount("one\n")).toBe(1);
    expect(lineCount("one\ntwo\n")).toBe(2);
    expect(lineCount("one\n\ntwo")).toBe(3);
  });
});

describe("daily files", () => {
  test("names the file after the local date", () => {
    expect(dayStamp(new Date(2026, 9, 22, 23, 59))).toBe("2026-10-22");
    expect(dayStamp(new Date(2026, 0, 2, 0, 0))).toBe("2026-01-02");
  });

  test("formats one compact line and collapses newlines", () => {
    expect(formatDailyLine("did a thing", new Date(2026, 9, 22, 9, 5))).toBe("- 09:05 did a thing");
    expect(formatDailyLine("line one\n  line two", new Date(2026, 9, 22, 14, 30))).toBe("- 14:30 line one line two");
  });

  test("appends to the day's file without losing earlier lines", async () => {
    const date = new Date(2026, 9, 22, 9, 5);
    const file = await appendDaily(client, "first", date);
    await appendDaily(client, "second", date);
    expect(file).toBe(`${join(dir, "memory", "daily")}/2026-10-22.md`);
    expect(await readFile(file, "utf8")).toBe("- 09:05 first\n- 09:05 second\n");
  });
});

describe("classification and names", () => {
  test("classifies every folder", () => {
    expect(classifyMemoryPath("context.md")).toEqual({ kind: "context", name: "context" });
    expect(classifyMemoryPath("daily/2026-10-22.md")).toEqual({ kind: "daily", name: "2026-10-22" });
    expect(classifyMemoryPath("projects/otto.md")).toEqual({ kind: "project", name: "otto" });
    expect(classifyMemoryPath("learnings/tauri-paths.md")).toEqual({ kind: "learning", name: "tauri-paths" });
    expect(classifyMemoryPath("agents/patch.md")).toEqual({ kind: "agent", name: "patch" });
    expect(classifyMemoryPath("notes.txt")).toEqual({ kind: "other", name: "notes.txt" });
  });

  test("slugs project names and paths", () => {
    expect(projectSlug("My Project!")).toBe("my-project");
    expect(projectSlug("/home/me/projects/otto/")).toBe("otto");
    expect(projectSlug("  ")).toBe("project");
    expect(projectSlug("Café Notes")).toBe("cafe-notes");
  });

  test("ensureProjectFile creates the template once", async () => {
    const file = await ensureProjectFile(client, "My Project");
    expect(file).toBe(join(dir, "memory", "projects", "my-project.md"));
    const first = await readFile(file, "utf8");
    await ensureProjectFile(client, "My Project");
    expect(await readFile(file, "utf8")).toBe(first);
    expect(first).toContain("## Open threads");
  });
});

describe("install and remove", () => {
  test("install creates the folder, context.md and the instruction", async () => {
    await writeFile(
      join(dir, "opencode.json"),
      JSON.stringify({
        instructions: ["/home/me/AGENTS.md"],
        plugins: [{ package: `${MEMORY_PLUGIN}@2.0.0` }],
      }),
    );
    const paths = await installMemory(client);
    expect(paths.root).toBe(join(dir, "memory"));
    expect(await exists(paths.context)).toBe(true);
    expect(await exists(paths.daily)).toBe(true);
    expect(await exists(paths.projects)).toBe(true);
    expect(await exists(paths.learnings)).toBe(true);
    expect(await exists(paths.agents)).toBe(true);

    const cfg = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8")) as GlobalConfig;
    expect(cfg.instructions).toEqual(["/home/me/AGENTS.md", paths.context]);
    expect(cfg.plugins).toBeUndefined();
    expect(memoryInstalled(cfg)).toBe(true);
  });

  test("a second install changes nothing and never overwrites context.md", async () => {
    await installMemory(client);
    const context = join(dir, "memory", "context.md");
    await writeFile(context, "# Mine\n\n## Now\nkeep this\n");
    const before = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"));

    await installMemory(client);
    await installMemory(client);

    const after = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8"));
    expect(after.instructions).toEqual(before.instructions);
    expect(after.instructions).toHaveLength(1);
    expect(await readFile(context, "utf8")).toBe("# Mine\n\n## Now\nkeep this\n");
  });

  test("remove drops the instruction and old plugin but leaves every file", async () => {
    await installMemory(client);
    const date = new Date(2026, 9, 22, 9, 5);
    const daily = await appendDaily(client, "still here", date);
    const project = await ensureProjectFile(client, "Otto");
    await removeMemory(client);

    const cfg = JSON.parse(await readFile(join(dir, "opencode.json"), "utf8")) as GlobalConfig;
    expect(cfg.instructions).toBeUndefined();
    expect(memoryInstalled(cfg)).toBe(false);
    expect(await exists(join(dir, "memory", "context.md"))).toBe(true);
    expect(await readFile(daily, "utf8")).toContain("still here");
    expect(await exists(project)).toBe(true);
  });
});

describe("reading the folder", () => {
  test("returns context text and a sorted-able index", async () => {
    await installMemory(client);
    await appendDaily(client, "a note", new Date(2026, 9, 22, 9, 5));
    await ensureProjectFile(client, "Otto");
    const state = await readMemoryState(client);
    expect(state.context).toContain("## Now");
    const kinds = state.files.map((f) => f.kind).sort();
    expect(kinds).toEqual(["context", "daily", "project"].sort());
    const project = state.files.find((f) => f.kind === "project")!;
    expect(project.name).toBe("otto");
    expect(project.size).toBeGreaterThan(0);
    expect(project.modified).toBeGreaterThan(0);
  });

  test("a missing folder reads as empty, not an error", async () => {
    const state = await readMemoryState(client);
    expect(state.context).toBe("");
    expect(state.files).toEqual([]);
  });
});

describe("what may be written", () => {
  // Secret-looking text is only a rule in the prompt: the app doesn't scan or
  // block content, because teammates and the user may legitimately write a
  // placeholder. Path traversal is the hard boundary.
  test("does not block secret-looking lines", async () => {
    const date = new Date(2026, 9, 22, 9, 5);
    const file = await appendDaily(client, "example key sk-test-not-a-real-key", date);
    expect(await readFile(file, "utf8")).toContain("sk-test-not-a-real-key");
  });

  test("writeMemoryFile refuses to leave the memory folder", async () => {
    await installMemory(client);
    await expect(writeMemoryFile(client, join(dir, "opencode.json"), "nope")).rejects.toThrow();
    await expect(writeMemoryFile(client, "../../outside.md", "nope")).rejects.toThrow();
  });
});

describe("the prompt points at files, not tools", () => {
  const base = { id: "patch", name: "Patch", job: "Code", instructions: "" };

  test("a lead owns context.md and rewrites it", () => {
    const p = teammatePrompt({ ...base, id: "juno", name: "Juno", leads: true });
    expect(p).toContain("~/.config/opencode/memory");
    expect(p).toContain("under 40 lines");
    expect(p).toContain("You own it.");
    expect(p).toContain("Rewrite `context.md`");
    expect(p).not.toContain("memory_remember");
  });

  test("a teammate leaves context.md to the lead and keeps its own file", () => {
    const p = teammatePrompt({ ...base, leads: false });
    expect(p).toContain("The lead owns it; don't edit it.");
    expect(p).toContain("`agents/patch.md`");
    expect(p).toContain("say so in your report");
    expect(p).not.toContain("memory_recall");
  });
});
