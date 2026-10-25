import { describe, expect, test } from "bun:test";
import { parsePathToken, pathFromHref, rehypeFileLinks, soleLink, splitPathTokens, type PathSeg } from "./mdLinks";

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
