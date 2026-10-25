import { describe, expect, test } from "bun:test";
import { absolutePath, checkFile, codeSpanFile, insideRoot, makeBudget, parsePathToken, pathFromHref, rehypeFileLinks, soleLink, splitPathTokens, type PathSeg } from "./mdLinks";

const paths = (text: string) => splitPathTokens(text).filter((s): s is PathSeg => typeof s !== "string");

describe("parsePathToken", () => {
  test("plain file paths, with optional line numbers", () => {
    expect(parsePathToken("README.md")).toEqual({ path: "README.md", line: undefined });
    expect(parsePathToken("src/lib/preview.ts")).toEqual({ path: "src/lib/preview.ts", line: undefined });
    expect(parsePathToken("src/lib/preview.ts:20")).toEqual({ path: "src/lib/preview.ts", line: 20 });
    expect(parsePathToken("src/lib/preview.ts#L20")).toEqual({ path: "src/lib/preview.ts", line: 20 });
    expect(parsePathToken("./a/b.ts")).toEqual({ path: "./a/b.ts", line: undefined });
    expect(parsePathToken("../up/x.ts")).toEqual({ path: "../up/x.ts", line: undefined });
    expect(parsePathToken("/abs/path.ts")).toEqual({ path: "/abs/path.ts", line: undefined });
    expect(parsePathToken("~/notes.md")).toEqual({ path: "~/notes.md", line: undefined });
  });

  test("sentence punctuation is not part of the path", () => {
    expect(parsePathToken("README.md.")).toEqual({ path: "README.md", line: undefined });
    expect(parsePathToken("src/x.ts:20,")).toEqual({ path: "src/x.ts", line: 20 });
  });

  test("initials, versions and bare words are not paths", () => {
    expect(parsePathToken("e.g.")).toBeNull();
    expect(parsePathToken("i.e")).toBeNull();
    expect(parsePathToken("etc.")).toBeNull();
    expect(parsePathToken("v1.2.3")).toBeNull();
    expect(parsePathToken("hello")).toBeNull();
    expect(parsePathToken("Makefile")).toBeNull(); // explicit links can still point at it
  });

  test("URLs and Windows paths stay out", () => {
    expect(parsePathToken("https://example.com/a.ts")).toBeNull();
    expect(parsePathToken("C:\\Users\\x.ts")).toBeNull();
    expect(parsePathToken("src/x.ts:12-20")).toBeNull();
    expect(parsePathToken("src/lib/")).toBeNull();
  });
});

describe("splitPathTokens", () => {
  test("finds paths inside prose, keeping the words around them", () => {
    expect(splitPathTokens("see src/lib/preview.ts and README.md!")).toEqual([
      "see ",
      { text: "src/lib/preview.ts", path: "src/lib/preview.ts", line: undefined },
      " and ",
      { text: "README.md", path: "README.md", line: undefined },
      "!",
    ]);
  });

  test("keeps the line suffix as written", () => {
    expect(paths("fixed in src/a.ts:12 today")).toEqual([{ text: "src/a.ts:12", path: "src/a.ts", line: 12 }]);
  });

  test("leaves URLs, emails and initials alone", () => {
    expect(splitPathTokens("https://example.com/src/a.ts e.g. v1.2.3")).toEqual([
      "https://example.com/src/a.ts e.g. v1.2.3",
    ]);
  });

  test("plain text without paths is one string", () => {
    expect(splitPathTokens("nothing to see here")).toEqual(["nothing to see here"]);
    expect(splitPathTokens("")).toEqual([""]);
  });
});

describe("pathFromHref", () => {
  test("accepts relative and absolute paths, including extensionless ones", () => {
    expect(pathFromHref("docs/README.md")).toEqual({ path: "docs/README.md", line: undefined });
    expect(pathFromHref("Makefile")).toEqual({ path: "Makefile", line: undefined });
    expect(pathFromHref("src/x.ts:20")).toEqual({ path: "src/x.ts", line: 20 });
    expect(pathFromHref("/abs/x.ts")).toEqual({ path: "/abs/x.ts", line: undefined });
  });

  test("rejects URLs, anchors and schemes", () => {
    expect(pathFromHref("https://example.com/a.ts")).toBeNull();
    expect(pathFromHref("mailto:a@b.com")).toBeNull();
    expect(pathFromHref("javascript:alert(1)")).toBeNull();
    expect(pathFromHref("#anchor")).toBeNull();
    expect(pathFromHref("")).toBeNull();
    expect(pathFromHref("src/lib/")).toBeNull();
  });

  test("a root-level path with a line suffix is a path, not a scheme", () => {
    expect(pathFromHref("x-strategy-jay.md:1")).toEqual({ path: "x-strategy-jay.md", line: 1 });
    expect(pathFromHref("README.md:12")).toEqual({ path: "README.md", line: 12 });
    expect(pathFromHref("a.ts#L20")).toEqual({ path: "a.ts", line: 20 });
    expect(pathFromHref("v1.2.3:12")).toBeNull(); // a version with a port is not a path
  });
});

const text = (value: string) => ({ type: "text", value });
const el = (tagName: string, properties: Record<string, unknown>, children: unknown[]) => ({ type: "element", tagName, properties, children });

describe("rehypeFileLinks", () => {
  test("links paths in prose but not inside links or code", () => {
    const tree = {
      type: "root",
      children: [
        { type: "element", tagName: "p", properties: {}, children: [text("see src/a.ts and "), el("code", {}, [text("src/b.ts")])] },
        { type: "element", tagName: "a", properties: { href: "src/c.ts" }, children: [text("src/c.ts")] },
        { type: "element", tagName: "pre", properties: {}, children: [el("code", {}, [text("src/d.ts")])] },
      ],
    };
    rehypeFileLinks()(tree as never);
    const [p, link, pre] = tree.children as { children: { type: string; tagName?: string; value?: string }[] }[];
    expect(p.children.map((c) => (c.type === "text" ? c.value : `<${c.tagName}>`))).toEqual(["see ", "<a>", " and ", "<code>"]);
    expect(link.children[0].value).toBe("src/c.ts");
    expect((pre.children[0] as { children: { value: string }[] }).children[0].value).toBe("src/d.ts");
  });

  test("a paragraph with no paths is untouched", () => {
    const tree = { type: "root", children: [{ type: "element", tagName: "p", properties: {}, children: [text("hello e.g. world")] }] };
    rehypeFileLinks()(tree as never);
    expect(tree.children[0].children).toHaveLength(1);
  });
});

describe("soleLink", () => {
  test("finds a paragraph holding one link and nothing else", () => {
    const node = { children: [text("  "), el("a", { href: "https://example.com" }, [text("Example")]), text(" ")] };
    expect(soleLink(node)).toEqual({ href: "https://example.com", text: "Example" });
  });

  test("rejects paragraphs with more in them", () => {
    expect(soleLink({ children: [text("see "), el("a", { href: "https://x.com" }, [text("x")])] })).toBeNull();
    expect(soleLink({ children: [el("a", { href: "https://x.com" }, [text("x")]), el("a", { href: "https://y.com" }, [text("y")])] })).toBeNull();
    expect(soleLink({ children: [el("a", { href: "" }, [text("x")])] })).toBeNull();
  });
});

describe("insideRoot", () => {
  test("collapses `.` and `..` before deciding", () => {
    expect(insideRoot("/home/user/proj", "/home/user/proj/a.ts")).toBe(true);
    expect(insideRoot("/home/user/proj", "/home/user/proj/./a.ts")).toBe(true);
    expect(insideRoot("/home/user/proj", "/home/user/proj/sub/../a.ts")).toBe(true);
    expect(insideRoot("/home/user/proj", "/home/user/proj")).toBe(true); // the root itself
    expect(insideRoot("/home/user/proj", "/home/user/proj/../../etc/passwd")).toBe(false);
    expect(insideRoot("/home/user/proj", "/home/user/.ssh/id_rsa")).toBe(false);
    expect(insideRoot("/home/user/proj", "/home/user")).toBe(false);
  });

  test("the name has to end at a boundary, and drives work", () => {
    expect(insideRoot("/home/user/proj", "/home/user/projancy/a.ts")).toBe(false);
    expect(insideRoot("C:\\proj", "C:\\proj\\a.ts")).toBe(true);
    expect(insideRoot("C:\\proj", "C:\\other\\a.ts")).toBe(false);
    expect(insideRoot("", "/a.ts")).toBe(false);
  });
});

describe("checkFile", () => {
  const ROOT = "/home/user/proj";
  const fs = (files: Record<string, string[]>) => {
    const calls: string[] = [];
    return {
      calls,
      client: {
        listDir: (p: string): Promise<{ path: string; type: "file" | "directory" }[]> => {
          calls.push(p);
          return Promise.resolve((files[p] ?? []).map((name) => ({ path: `${p}/${name}`, type: "file" as const })));
        },
      },
    };
  };

  test("resolves inside the root, and one listing answers a whole folder", async () => {
    const { calls, client } = fs({ [`${ROOT}/src`]: ["a.ts", "b.ts"] });
    expect(await checkFile(client, ROOT, "src/a.ts")).toBe(true);
    expect(await checkFile(client, ROOT, "src/b.ts")).toBe(true);
    expect(await checkFile(client, ROOT, "src/missing.ts")).toBe(false);
    expect(calls).toEqual([`${ROOT}/src`]);
  });

  test("anything outside the root stays plain text and costs no listing", async () => {
    const { calls, client } = fs({});
    expect(await checkFile(client, ROOT, "/home/user/.ssh/id_rsa")).toBe(false);
    expect(await checkFile(client, ROOT, "../../outside.ts")).toBe(false);
    expect(await checkFile(client, ROOT, "a/../../../etc/passwd")).toBe(false);
    expect(await checkFile(client, ROOT, "/home/user/proj")).toBe(false); // the root's parent is not listed either
    expect(calls).toEqual([]);
  });

  test("an unreadable folder just means plain text", async () => {
    const calls: string[] = [];
    const client = {
      listDir: (p: string): Promise<{ path: string; type: "file" | "directory" }[]> => {
        calls.push(p);
        return Promise.reject(new Error("nope"));
      },
    };
    expect(await checkFile(client, `${ROOT}/err`, "x/thing.ts")).toBe(false);
    expect(calls).toEqual([`${ROOT}/err/x`]);
  });

  test("listings run a couple at a time, whatever the message throws at it", async () => {
    let live = 0;
    let peak = 0;
    const client = {
      listDir: async (p: string) => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, 5));
        live--;
        return [{ path: `${p}/x.ts`, type: "file" as const }];
      },
    };
    const results = await Promise.all(["a", "b", "c", "d", "e", "f"].map((d) => checkFile(client, `${ROOT}/conc`, `${d}/x.ts`)));
    expect(results).toEqual([true, true, true, true, true, true]);
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("codeSpanFile", () => {
  const ROOT = "/home/user/proj-spans";
  const fs = (files: Record<string, string[]>) => {
    const calls: string[] = [];
    return {
      calls,
      client: {
        listDir: (p: string): Promise<{ path: string; type: "file" | "directory" }[]> => {
          calls.push(p);
          return Promise.resolve((files[p] ?? []).map((name) => ({ path: `${p}/${name}`, type: "file" as const })));
        },
      },
    };
  };
  // A fresh window per test, so the module's shared budget can't decide an outcome.
  const fresh = () => makeBudget(100, 10_000);

  test("a code span naming a real file becomes a link", async () => {
    const { calls, client } = fs({ [`${ROOT}/src`]: ["a.ts", "mdLinks.ts"] });
    expect(await codeSpanFile(client, ROOT, "src/a.ts", fresh())).toBe(true);
    expect(await codeSpanFile(client, ROOT, "src/mdLinks.ts", fresh())).toBe(true);
    expect(calls).toEqual([`${ROOT}/src`]); // one listing answers both
  });

  test("words, commands and versions stay literal code", async () => {
    const { client } = fs({});
    for (const span of ["e.g.", "i.e", "v1.2.3", "npm install", "GET /api/fs/list", "does/not/exist.md"]) {
      expect(await codeSpanFile(client, ROOT, span, fresh())).toBe(false);
    }
  });

  test("a path outside the root stays literal and costs no listing", async () => {
    const { calls, client } = fs({});
    for (const span of ["/etc/passwd", "../../.ssh/id_rsa", "/home/user/.ssh/id_rsa"]) {
      expect(await codeSpanFile(client, ROOT, span, fresh())).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  test("surrounding whitespace is trimmed before checking", async () => {
    const { client } = fs({ [`${ROOT}/src`]: ["a.ts"] });
    expect(pathFromHref("  src/a.ts  ")?.path).toBe("src/a.ts"); // what it opens is trimmed too
    expect(await codeSpanFile(client, ROOT, "  src/a.ts  ", fresh())).toBe(true);
  });

  test("a line suffix resolves to the file and keeps the line", async () => {
    const { calls, client } = fs({ [`${ROOT}/lines`]: ["a.ts"] });
    expect(await codeSpanFile(client, ROOT, "lines/a.ts:12", fresh())).toBe(true);
    expect(pathFromHref("lines/a.ts:12")).toEqual({ path: "lines/a.ts", line: 12 });
    expect(pathFromHref("lines/a.ts#L12")).toEqual({ path: "lines/a.ts", line: 12 });
    expect(calls).toEqual([`${ROOT}/lines`]);
  });

  test("a root-level path with a line suffix resolves too", async () => {
    const root = "/home/user/proj-rootline"; // its own root: the listing cache is shared
    const { client } = fs({ [root]: ["x-strategy-jay.md"] });
    expect(await codeSpanFile(client, root, "x-strategy-jay.md:1", fresh())).toBe(true);
  });

  test("a partial path still streaming in stays literal", async () => {
    const { client } = fs({ [`${ROOT}/src`]: ["mdLinks.ts"] });
    for (const partial of ["src/m", "src/mdLink", "src/mdLinks.t"]) {
      expect(await codeSpanFile(client, ROOT, partial, fresh())).toBe(false);
    }
    expect(await codeSpanFile(client, ROOT, "src/mdLinks.ts", fresh())).toBe(true); // settled
  });

  test("a message with many code spans does not starve the plain-text checks", async () => {
    const files: Record<string, string[]> = {};
    for (let d = 0; d < 5; d++) files[`${ROOT}/span${d}`] = Array.from({ length: 10 }, (_, i) => `f${i}.ts`);
    for (let d = 0; d < 20; d++) files[`${ROOT}/prose${d}`] = [`p${d}.ts`];
    const { client } = fs(files);
    // One window shared by the whole message, as in the app.
    const budget = makeBudget(30, 10_000);
    const spans = await Promise.all(
      Array.from({ length: 50 }, (_, i) => codeSpanFile(client, ROOT, `span${i % 5}/f${Math.floor(i / 5)}.ts`, budget)),
    );
    const prose = await Promise.all(Array.from({ length: 20 }, (_, d) => checkFile(client, ROOT, `prose${d}/p${d}.ts`, budget)));
    expect(spans).toEqual(Array(50).fill(true));
    expect(prose).toEqual(Array(20).fill(true));
  });
});

describe("makeBudget", () => {
  test("caps checks per window, then lets the next window through", async () => {
    const budget = makeBudget(2, 5);
    expect(budget()).toBe(true);
    expect(budget()).toBe(true);
    expect(budget()).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(budget()).toBe(true);
  });

  test("absolutePath still joins relative paths to the root", () => {
    expect(absolutePath("/home/user/proj", "a.ts")).toBe("/home/user/proj/a.ts");
    expect(absolutePath("/home/user/proj", "./a.ts")).toBe("/home/user/proj/a.ts");
  });
});
