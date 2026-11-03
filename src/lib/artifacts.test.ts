import { describe, expect, test } from "bun:test";
import { classify, extOf, fileSize, isHttpUrl, isUrlSource, kindOfPath, localAddress, looksLikeMarkup, MAX_SOURCE, parsePresent, resolveArtifactPath, titleFor } from "./artifacts";

describe("parsePresent", () => {
  test("takes a source, a title and a renderer", () => {
    expect(parsePresent({ source: " out/cover.png ", title: " Cover ", as: "image" })).toEqual({ source: "out/cover.png", title: "Cover", as: "image" });
  });

  test("title and `as` are optional", () => {
    expect(parsePresent({ source: "https://example.com" })).toEqual({ source: "https://example.com", title: undefined, as: undefined });
  });

  test("an unknown renderer falls back to inference instead of failing", () => {
    expect(parsePresent({ source: "a.png", as: "hologram" })).toEqual({ source: "a.png", title: undefined, as: undefined });
  });

  test("no source is a problem with a sentence, not a crash", () => {
    expect(parsePresent({})).toEqual({ problem: "The agent didn't say what to show." });
    expect(parsePresent({ source: "   " })).toEqual({ problem: "The agent didn't say what to show." });
    expect(parsePresent(undefined)).toEqual({ problem: "The agent didn't say what to show." });
  });

  test("a page's worth of markup is refused with a way out", () => {
    const big = `<html>${"x".repeat(MAX_SOURCE)}</html>`;
    const out = parsePresent({ source: big });
    expect("problem" in out && /write it to a file/i.test(out.problem)).toBe(true);
  });

  test("the cap holds for a path too, not only markup", () => {
    const out = parsePresent({ source: `/tmp/big/bundle.bin.${"x".repeat(MAX_SOURCE)}` });
    expect("problem" in out && /write it to a file/i.test(out.problem)).toBe(true);
  });

  test("a long title is cut, not rejected", () => {
    const out = parsePresent({ source: "a.png", title: "t".repeat(400) });
    expect("title" in out && out.title?.length).toBe(160);
  });
});

describe("what a source is", () => {
  test("markup is markup, and a comparison is not", () => {
    expect(looksLikeMarkup("<h1>Hi</h1>")).toBe(true);
    expect(looksLikeMarkup("<!doctype html><html></html>")).toBe(true);
    expect(looksLikeMarkup("<div>")).toBe(true);
    expect(looksLikeMarkup("<div")).toBe(false); // half a stream
    expect(looksLikeMarkup("a < b")).toBe(false);
    expect(looksLikeMarkup("src/index.html")).toBe(false);
  });

  test("URLs are http(s), and a dev server can leave the scheme off", () => {
    expect(isHttpUrl("https://example.com/x")).toBe(true);
    expect(isUrlSource("http://localhost:3000")).toBe(true);
    expect(isUrlSource("localhost:5173")).toBe(true);
    expect(isUrlSource("127.0.0.1:8080/app")).toBe(true);
    expect(isUrlSource("[::1]:3000")).toBe(true);
    expect(isUrlSource("localhost")).toBe(false);
    expect(isUrlSource("ftp://example.com")).toBe(false);
    expect(isUrlSource("src/lib/artifacts.ts")).toBe(false);
  });

  test("classify follows the source, then `as`", () => {
    expect(classify("cover.png")).toEqual({ kind: "path", path: "cover.png" });
    expect(classify("<h1>hi</h1>")).toEqual({ kind: "markup", markup: "<h1>hi</h1>" });
    expect(classify("https://example.com")).toEqual({ kind: "url", url: "https://example.com" });
    expect(classify("localhost:3000/x")).toEqual({ kind: "url", url: "localhost:3000/x" });
    // A path can't be a page, and markup can't be a file.
    expect(classify("cover.png", "url")).toEqual({ problem: "That isn't an http(s) address." });
    expect(classify("<h1>hi</h1>", "download")).toEqual({ problem: "Markup can't be shown as download." });
    // `as` can rename a file's renderer, but not change what it is.
    expect(classify("app.html", "text")).toEqual({ kind: "path", path: "app.html" });
    expect(classify("<h1>hi</h1>", "html")).toEqual({ kind: "markup", markup: "<h1>hi</h1>" });
  });

  test("the renderer follows the extension", () => {
    expect(extOf("out/Cover.PNG")).toBe("png");
    expect(kindOfPath("out/cover.png")).toBe("image");
    expect(kindOfPath("cover.svg")).toBe("image");
    expect(kindOfPath("app/index.html")).toBe("html");
    expect(kindOfPath("notes.md")).toBe("text");
    expect(kindOfPath("report.pdf")).toBe("text");
    expect(kindOfPath("src/artifacts.ts")).toBe("text");
    expect(kindOfPath("Makefile")).toBe("text");
    expect(kindOfPath("build.zip")).toBe("download");
    expect(kindOfPath("bin/server")).toBe("text");
    expect(kindOfPath("thing.unknownext")).toBe("download");
  });

  test("titles fall back to something readable", () => {
    expect(titleFor("out/cover.png")).toBe("cover.png");
    expect(titleFor("https://example.com/docs?q=1")).toBe("example.com/docs");
    expect(titleFor("https://example.com/")).toBe("example.com");
    expect(titleFor("localhost:5173/")).toBe("localhost:5173");
    expect(titleFor("<h1>hi</h1>")).toBe("Markup");
  });
});

describe("paths on this machine", () => {
  const root = "/work/project";

  test("a relative path resolves against the root", () => {
    expect(resolveArtifactPath(root, "out/cover.png")).toEqual({ path: "/work/project/out/cover.png", inside: true });
    expect(resolveArtifactPath(root, "/work/project/index.html")).toEqual({ path: "/work/project/index.html", inside: true });
    expect(resolveArtifactPath(root, "./a/../b.txt")).toEqual({ path: "/work/project/b.txt", inside: true });
  });

  test("an absolute path outside the root is taken, wherever the file lives", () => {
    expect(resolveArtifactPath(root, "/tmp/opencode/x.png")).toEqual({ path: "/tmp/opencode/x.png", inside: false });
    expect(resolveArtifactPath(root, "/var/log/app.log")).toEqual({ path: "/var/log/app.log", inside: false });
    expect(resolveArtifactPath(root, "/work/other/x.txt")).toEqual({ path: "/work/other/x.txt", inside: false });
  });

  test("without a session root an absolute path still resolves", () => {
    expect(resolveArtifactPath("", "/tmp/opencode/x.png")).toEqual({ path: "/tmp/opencode/x.png", inside: false });
  });

  test("climbing is resolved, not shown raw: `..` never reaches a reader", () => {
    expect(resolveArtifactPath(root, "../bench/shot.png")).toEqual({ path: "/work/bench/shot.png", inside: false });
    expect(resolveArtifactPath(root, "a/../../etc/passwd")).toEqual({ path: "/work/etc/passwd", inside: false });
  });

  test("a session with no folder still refuses a bare name", () => {
    expect(resolveArtifactPath("", "a.png")).toEqual({ problem: "This session has no folder to look in yet." });
  });
});

describe("loopback addresses", () => {
  test("a dev server is read the short way or the long way", () => {
    expect(localAddress("localhost:5173")).toEqual({ port: 5173, rest: "" });
    expect(localAddress("localhost:5173/app?x=1")).toEqual({ port: 5173, rest: "/app?x=1" });
    expect(localAddress("http://127.0.0.1:8080/x")).toEqual({ port: 8080, rest: "/x" });
    expect(localAddress("[::1]:3000")).toEqual({ port: 3000, rest: "" });
    // No port given: the scheme's default, as a browser would read it.
    expect(localAddress("https://localhost/")).toEqual({ port: 443, rest: "" });
  });

  test("anything else isn't the agent's own machine", () => {
    expect(localAddress("https://example.com")).toBeNull();
    expect(localAddress("cover.png")).toBeNull();
    expect(localAddress("")).toBeNull();
  });

  test("a scheme-less page needs a port to be read as a page", () => {
    expect(isUrlSource("localhost")).toBe(false);
    expect(isUrlSource("localhost:5173")).toBe(true);
  });
});

describe("fileSize", () => {
  test("reads like the rest of the app", () => {
    expect(fileSize(12)).toBe("12 B");
    expect(fileSize(2048)).toBe("2.0 KB");
    expect(fileSize(48 * 1024)).toBe("48 KB");
    expect(fileSize(3.5 * 1024 * 1024)).toBe("3.5 MB");
    expect(fileSize(Number.NaN)).toBe("");
  });
});
