import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { presentPluginInstalled, presentPluginPackageJson, presentPluginSource, withPresentPlugin, withoutPresentPlugin } from "./presentPlugin";
import { withSchedulePlugin } from "./schedulesPlugin";

interface RuntimeModule {
  default: { id: string };
  TOOL_SCHEMA: { properties: { source: { type: string }; as: { enum: string[] } }; required: string[]; additionalProperties: boolean };
  KINDS: string[];
  normalizePresent(input: Record<string, unknown>): { source: string; title?: string; as?: string };
  receipt(call: { source: string; title?: string; as?: string }): Record<string, unknown>;
}

let ROOT = "";

beforeEach(async () => {
  ROOT = await mkdtemp(join(tmpdir(), "otto-present-"));
  await writeFile(join(ROOT, "index.js"), presentPluginSource());
  await writeFile(join(ROOT, "package.json"), presentPluginPackageJson());
  const stub = join(ROOT, "node_modules", "@opencode", "plugin");
  await mkdir(stub, { recursive: true });
  await writeFile(join(stub, "package.json"), JSON.stringify({ name: "@opencode/plugin", type: "module", exports: "./index.js" }));
  await writeFile(join(stub, "index.js"), "export const Plugin = { define: (p) => p };\n");
});

afterEach(async () => {
  await rm(ROOT, { recursive: true, force: true });
});

let version = 0;
async function load(): Promise<RuntimeModule> {
  // A fresh URL per test: Bun caches modules by specifier.
  return (await import(`${pathToFileURL(join(ROOT, "index.js")).href}?v=${++version}`)) as RuntimeModule;
}

describe("generated package", () => {
  test("is self-contained: the only import is @opencode/plugin", () => {
    const specs = [...presentPluginSource().matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specs).toEqual(["@opencode/plugin"]);
    expect(presentPluginSource()).not.toContain("import(");
  });

  test("exports the plugin under its own id", async () => {
    expect((await load()).default.id).toBe("otto.present");
  });

  test("ships a one-tool schema: source required, a title and a renderer to choose from", async () => {
    const schema = (await load()).TOOL_SCHEMA;
    expect(schema.required).toEqual(["source"]);
    expect(schema.properties.source.type).toBe("string");
    expect(schema.properties.as.enum).toEqual(["image", "html", "url", "text", "download"]);
    expect(schema.additionalProperties).toBe(false);
  });
});

describe("the call", () => {
  test("normalises what the model sends", async () => {
    const m = await load();
    expect(m.normalizePresent({ source: "  out/cover.png ", title: " Cover ", as: "image" })).toEqual({ source: "out/cover.png", title: "Cover", as: "image" });
    expect(m.normalizePresent({ source: "out/cover.png" })).toEqual({ source: "out/cover.png" });
  });

  test("refuses a call with nothing to show, in words the model can act on", async () => {
    const m = await load();
    expect(() => m.normalizePresent({})).toThrow(/source is required/);
    expect(() => m.normalizePresent({ source: "  " })).toThrow(/source is required/);
  });

  test("an unknown renderer is dropped rather than refused", async () => {
    const m = await load();
    expect(m.normalizePresent({ source: "a.png", as: "hologram" })).toEqual({ source: "a.png" });
  });

  test("a title is trimmed and capped", async () => {
    const m = await load();
    expect(m.normalizePresent({ source: "a", title: "  " })).toEqual({ source: "a" });
    expect(m.normalizePresent({ source: "a", title: "t".repeat(400) }).title).toHaveLength(160);
  });

  test("too much markup is refused with a way out", async () => {
    const m = await load();
    expect(() => m.normalizePresent({ source: "<html>" + "x".repeat(600_000) + "</html>" })).toThrow(/write it to a file/i);
  });

  test("the receipt doesn't echo a whole page back to the model", async () => {
    const m = await load();
    const page = "<html>" + "x".repeat(5000) + "</html>";
    const call = m.normalizePresent({ source: page, title: "Big" });
    const out = m.receipt(call);
    expect(out.presented).toBe(true);
    expect(String(out.source)).toHaveLength(201);
    expect(String(out.source).endsWith("…")).toBe(true);
    expect(out.title).toBe("Big");
  });
});

describe("the tool it registers", () => {
  test("one tool named present, which answers a call and explains a bad one", async () => {
    const m = (await load()) as unknown as { default: { setup(ctx: unknown): Promise<void> } };
    const added: { name: string; description: string; input: unknown; execute(input: Record<string, unknown>): Promise<{ content: string }> }[] = [];
    const ctx = { tool: { transform: async (fn: (editor: { add(t: unknown): void }) => void) => fn({ add: (t) => added.push(t as never) }) } };
    await m.default.setup(ctx);
    expect(added).toHaveLength(1);
    const tool = added[0];
    expect(tool.name).toBe("present");
    expect(tool.description).toContain("artifact panel");
    expect(tool.input).toBe((await load()).TOOL_SCHEMA);

    const ok = JSON.parse((await tool.execute({ source: "out/cover.png", title: "Cover" })).content);
    expect(ok).toMatchObject({ presented: true, source: "out/cover.png", title: "Cover" });

    const bad = JSON.parse((await tool.execute({})).content);
    expect(bad.presented).toBe(false);
    expect(bad.error).toContain("source is required");
  });
});

describe("config entries", () => {
  test("adds exactly one entry, and never a second", () => {
    const one = withPresentPlugin({}, "/home/u/.otto/agent-tool/otto-present");
    const two = withPresentPlugin(one, "/home/u/.otto/agent-tool/otto-present");
    expect((two.plugins as unknown[]).length).toBe(1);
    expect(presentPluginInstalled(two, "/home/u/.otto/agent-tool/otto-present")).toBe(true);
    expect(presentPluginInstalled(two, "/somewhere/else")).toBe(false);
  });

  test("leaves the schedule tool alone", () => {
    const both = withPresentPlugin(withSchedulePlugin({}, "/home/u/.otto/agent-tool/otto-schedule"), "/home/u/.otto/agent-tool/otto-present");
    expect((both.plugins as unknown[]).length).toBe(2);
    const withoutPresent = withoutPresentPlugin(both);
    expect((withoutPresent.plugins as unknown[]).length).toBe(1);
    expect(JSON.stringify(withoutPresent.plugins)).toContain("otto-schedule");
  });

  test("drops an old entry under the v1 `plugin` key too", () => {
    const cfg = { plugin: ["file:///home/u/.otto/agent-tool/otto-present"] };
    expect(withoutPresentPlugin(cfg).plugin).toBeUndefined();
  });
});
