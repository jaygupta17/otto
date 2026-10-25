import { describe, expect, test } from "bun:test";
import { parseLinkMeta } from "./linkPreview";

const PAGE = `
<html><head>
  <title>  Example Page  </title>
  <meta property="og:title" content="Example &amp; Co" />
  <meta property="og:description" content="A page about things" />
  <meta property="og:image" content="/og.png" />
  <link rel="icon" href="/icon.svg" />
</head><body>ignored</body></html>`;

describe("parseLinkMeta", () => {
  test("reads Open Graph fields and resolves relative URLs", () => {
    expect(parseLinkMeta(PAGE, "https://example.com/some/page")).toEqual({
      title: "Example & Co",
      description: "A page about things",
      image: "https://example.com/og.png",
      favicon: "https://example.com/icon.svg",
    });
  });

  test("falls back to the title tag and the page description", () => {
    const html = `<html><head><title>Plain title</title><meta name="description" content="Plain description"></head></html>`;
    expect(parseLinkMeta(html, "https://example.com/")).toEqual({
      title: "Plain title",
      description: "Plain description",
      image: undefined,
      favicon: undefined,
    });
  });

  test("twitter tags stand in for Open Graph", () => {
    const html = `<meta name="twitter:title" content="Tweet"><meta name="twitter:image" content="https://img.example/x.png">`;
    const meta = parseLinkMeta(html, "https://example.com/");
    expect(meta.title).toBe("Tweet");
    expect(meta.image).toBe("https://img.example/x.png");
  });

  test("survives a page with nothing useful", () => {
    expect(parseLinkMeta("<html><body>hi</body></html>", "https://example.com/")).toEqual({
      title: undefined,
      description: undefined,
      image: undefined,
      favicon: undefined,
    });
  });

  test("single-quoted attributes and unreadable image URLs are handled", () => {
    const meta = parseLinkMeta(`<meta property='og:image' content='http://'><link rel="shortcut icon" href="icon.png">`, "https://example.com/a");
    expect(meta.image).toBeUndefined();
    expect(meta.favicon).toBe("https://example.com/icon.png");
  });
});
