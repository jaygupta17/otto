import { describe, expect, test } from "bun:test";
import { faviconGuess, isPreviewable, linkMeta, parseLinkMeta } from "./linkPreview";

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

describe("isPreviewable", () => {
  const yes = (url: string) => expect(isPreviewable(url)).toBe(true);
  const no = (url: string) => expect(isPreviewable(url)).toBe(false);

  test("only http and https survive; other schemes are refused", () => {
    yes("https://example.com/");
    yes("http://example.com:8443/a?b#c");
    no("file:///etc/passwd");
    no("file://127.0.0.1/etc/passwd");
    no("javascript:alert(1)");
    no("data:text/html,<script>hi</script>");
    no("ftp://example.com/x");
    no("mailto:a@b.com");
    no("about:blank");
    no("");
    no("not a url");
    no("/relative/path");
  });

  test("local hostnames are refused, case-insensitively, and with a trailing dot", () => {
    no("http://localhost");
    no("https://LOCALHOST:8080/x");
    no("https://Foo.Local.");
    no("http://localhost./");
    no("https://foo.localhost");
    no("https://deep.x.local");
    no("https://a.internal");
    no("https://a.home");
    no("https://router.lan");
    no("https://printer.intranet");
    no("https://");
    yes("https://localhost.com/"); // a public name that merely starts with "local"
    yes("https://example.local.com/");
  });

  test("IPv4 literals in private and reserved ranges are refused", () => {
    no("http://0.0.0.0/");
    no("http://0.1.2.3/");
    no("http://10.0.0.1/");
    no("http://10.255.255.255/");
    no("http://127.0.0.1:9229/");
    no("http://127.255.255.254/");
    no("http://169.254.169.254/latest/meta-data/"); // cloud metadata
    no("http://169.254.0.1/");
    no("http://172.16.0.1/");
    no("http://172.31.255.255/");
    no("http://192.168.0.1/");
    no("http://192.168.255.255/");
    no("http://100.64.0.1/");
    no("http://100.127.255.255/");
  });

  test("IPv4 literals outside those ranges are allowed", () => {
    yes("http://1.1.1.1/");
    yes("http://8.8.8.8/");
    yes("http://9.255.255.255/");
    yes("http://11.0.0.1/");
    yes("http://126.255.255.255/");
    yes("http://128.0.0.1/");
    yes("http://169.253.255.255/");
    yes("http://169.255.0.1/");
    yes("http://172.15.255.255/");
    yes("http://172.32.0.1/");
    yes("http://192.167.255.255/");
    yes("http://192.169.0.1/");
    yes("http://100.63.255.255/");
    yes("http://100.128.0.1/");
  });

  test("IPv6 literals, with and without brackets", () => {
    no("http://[::1]/");
    no("http://[::1]:8080/");
    no("http://[::]/");
    no("http://[fe80::1]/");
    no("http://[febf:ffff::1]/"); // inside fe80::/10
    no("http://[FE80::1]/");
    no("http://[fc00::1]/");
    no("http://[fd12:3456::1]/"); // inside fc00::/7
    yes("http://[2001:db8::1]/");
    yes("http://[fec0::1]/"); // just outside fe80::/10
    yes("http://[fbff::1]/"); // just outside fc00::/7
  });

  test("IPv4-mapped and IPv4-compatible IPv6 take the IPv4 rules", () => {
    no("http://[::ffff:127.0.0.1]/"); // parses to ::ffff:7f00:1
    no("http://[::ffff:7f00:1]/");
    no("http://[::ffff:169.254.169.254]/");
    no("http://[::ffff:a9fe:a9fe]/");
    no("http://[::a00:1]/"); // ::10.0.0.1
    yes("http://[::ffff:8.8.8.8]/");
  });

  test("userinfo is not a way in; the hostname decides", () => {
    no("https://user@127.0.0.1/");
    no("https://user:pass@169.254.169.254/latest/meta-data/");
    no("https://user@localhost/");
    yes("https://127.0.0.1@evil.example.com/");
    yes("https://user:pass@example.com/");
  });

  test("odd IPv4 spellings canonicalise to the blocks above", () => {
    no("http://2130706433/"); // 127.0.0.1 in a trench coat
    no("http://0x7f000001/");
    no("http://0177.0.0.1/");
    no("http://999.999.999.999/"); // unparseable: refused, not guessed
  });
});

describe("the gate before any request", () => {
  test("blocked URLs cost no request at all", async () => {
    const calls: unknown[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((...args: unknown[]) => {
      calls.push(args);
      return Promise.reject(new Error("must not fetch"));
    }) as typeof fetch;
    try {
      for (const url of ["http://127.0.0.1:9229/", "http://169.254.169.254/latest/meta-data/", "file:///etc/passwd", "https://router.lan/"]) {
        expect(await linkMeta(url)).toBeNull();
      }
      expect(faviconGuess("http://127.0.0.1/")).toBeUndefined();
      expect(faviconGuess("file:///etc/passwd")).toBeUndefined();
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toEqual([]);
  });

  test("faviconGuess only fires for previewable URLs", () => {
    expect(faviconGuess("https://example.com/a/b")).toBe("https://example.com/favicon.ico");
  });
});
