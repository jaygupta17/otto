/**
 * File paths in message text. A path in prose (`src/lib/preview.ts`, `README.md`)
 * becomes a link that opens the file, and markdown links whose target is a path
 * are routed the same way. Detection is permissive; whether it really is a file
 * is settled by an existence check (see `checkFile`), so false positives —
 * `e.g.`, versions, hostnames — fall back to plain text.
 */
import type { Element, ElementContent, Root, Text } from "hast";

export type PathSeg = { text: string; path: string; line?: number };

export type PathTarget = { path: string; line?: number };

/** A run of characters that can appear in a path, a URL or a version string. */
const RUN = /[\w@%+~.:/#\\-]+/g;

const LINE_SUFFIX = /:(\d{1,5})$/;
const ANCHOR_SUFFIX = /#L(\d{1,5})$/i;
const EXT = /\.([A-Za-z][A-Za-z0-9_-]{0,7})$/;

/** Strip `:12` / `#L12` off a token; `text` stays as written. */
export function parsePathToken(raw: string): PathTarget | null {
  let t = raw.replace(/[.,;!?]+$/, "");
  let line: number | undefined;
  const lm = LINE_SUFFIX.exec(t);
  if (lm) {
    line = Number(lm[1]);
    t = t.slice(0, lm.index);
  } else {
    const hm = ANCHOR_SUFFIX.exec(t);
    if (hm) {
      line = Number(hm[1]);
      t = t.slice(0, hm.index);
    }
  }
  t = t.replace(/[.,;!?]+$/, "");
  // Anything still carrying one of these is a URL, a Windows path or a port
  // range — not something the file panel can open.
  if (!t || t.endsWith("/") || /[:#\\]/.test(t)) return null;
  const slash = t.lastIndexOf("/");
  const base = slash === -1 ? t : t.slice(slash + 1);
  const ext = EXT.exec(base);
  if (slash === -1 && !ext) return null; // bare word
  if (ext) {
    const name = base.slice(0, ext.index);
    // `e.g`, `i.e`, `a.b`: initials, not filenames.
    if (name.length < 2 && ext[1].length < 2) return null;
  }
  return { path: t, line };
}

/**
 * A markdown link target that is a local path rather than a URL. Lenient on
 * shape (`Makefile` has no extension); the existence check decides.
 */
export function pathFromHref(href: string): PathTarget | null {
  const t = href.trim();
  if (!t || t.startsWith("#") || t.startsWith("?") || t.startsWith("//")) return null;
  // A scheme means a URL (or Windows drive `C:\`); those stay links.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(t) && !/^[A-Za-z]:[\\/]/.test(t)) return null;
  const target = parsePathToken(t);
  return target ?? (/[:#\\]/.test(t) || t.endsWith("/") ? null : { path: t.replace(/[.,;!?]+$/, ""), line: undefined });
}

/** True when a urlTransform should keep this value instead of sanitising it away. */
export function isPathHref(href: string): boolean {
  return pathFromHref(href) !== null;
}

/** Split text into plain strings and path segments (with `text` as written). */
export function splitPathTokens(text: string): (string | PathSeg)[] {
  const out: (string | PathSeg)[] = [];
  let at = 0;
  RUN.lastIndex = 0;
  for (let m = RUN.exec(text); m; m = RUN.exec(text)) {
    const target = parsePathToken(m[0]);
    if (target) {
      if (m.index > at) out.push(text.slice(at, m.index));
      out.push({ text: m[0], path: target.path, line: target.line });
      at = m.index + m[0].length;
    }
  }
  if (out.length === 0) return [text];
  if (at < text.length) out.push(text.slice(at));
  return out;
}

// ---------------------------------------------------------------------------
// The rehype pass: plain-text paths in the tree become link nodes. Text inside
// links and code is left alone, so `src/x.ts` in backticks or in link text
// stays as written.
// ---------------------------------------------------------------------------

function isSkipped(el: Element) {
  return el.tagName === "a" || el.tagName === "code" || el.tagName === "pre";
}

function walk(node: Root | Element, skipped: boolean) {
  const kids = node.children as ElementContent[];
  for (let i = 0; i < kids.length; i++) {
    const kid = kids[i];
    if (kid.type === "element") {
      walk(kid, skipped || isSkipped(kid));
    } else if (kid.type === "text" && !skipped) {
      const segs = splitPathTokens(kid.value);
      if (segs.length === 1 && typeof segs[0] === "string") continue;
      const nodes: ElementContent[] = segs.map((s) =>
        typeof s === "string"
          ? ({ type: "text", value: s } as Text)
          : { type: "element", tagName: "a", properties: { href: s.text }, children: [{ type: "text", value: s.text }] },
      );
      kids.splice(i, 1, ...nodes);
      i += nodes.length - 1;
    }
  }
}

/** A react-markdown rehype plugin that links file paths found in prose. */
export function rehypeFileLinks() {
  return (tree: Root) => walk(tree, false);
}

/** The one link a paragraph holds and nothing else, if any. */
export function soleLink(node: { children?: unknown[] } | undefined): { href: string; text: string } | null {
  let link: Element | null = null;
  for (const k of (node?.children ?? []) as ElementContent[]) {
    if (k.type === "element" && k.tagName === "a") {
      if (link) return null;
      link = k;
    } else if (k.type !== "text" || k.value.trim() !== "") {
      return null;
    }
  }
  const href = link?.properties?.href;
  if (!link || typeof href !== "string" || !href) return null;
  const text = (link.children as ElementContent[])
    .map((c) => (c.type === "text" ? c.value : ""))
    .join("")
    .trim();
  return { href, text };
}

// ---------------------------------------------------------------------------
// Existence: a path only becomes a link once we know it is a file.
//
// Message text is untrusted, so a path-shaped token is a question about the
// filesystem and nothing more. It is only asked when the resolved path sits
// inside the session root (the root's own parent is off limits too), and only
// within a budget: a message can hold hundreds of tokens and each check is a
// listing.
// ---------------------------------------------------------------------------

interface FsClient {
  listDir(path: string, directory?: string): Promise<{ path: string; type: "file" | "directory" }[]>;
}

/** Bounded LRU: `Map` holds insertion order, so the oldest key comes first. */
const CACHE_MAX = 300;

type Cached<T> = { at: number; v: T };

function cacheGet<T>(m: Map<string, Cached<T>>, k: string): Cached<T> | undefined {
  const hit = m.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) {
    m.delete(k);
    m.set(k, hit);
    return hit;
  }
  return undefined;
}

function cacheSet<T>(m: Map<string, Cached<T>>, k: string, v: T): Cached<T> {
  const entry = { at: Date.now(), v };
  m.delete(k);
  m.set(k, entry);
  const oldest = m.keys().next();
  if (!oldest.done && m.size > CACHE_MAX) m.delete(oldest.value);
  return entry;
}

const dirCache = new Map<string, Cached<Promise<{ path: string; type: "file" | "directory" }[] | null>>>();
const fileCache = new Map<string, Cached<Promise<boolean>>>();

/** A minute: long enough to absorb a stream of mentions, short enough that a file the agent just created still gets linked. */
const TTL_MS = 60_000;

/** Listings at a time (the `linkPreview` queue shape), so one message can't fan out into a burst of RPCs. */
const waiting: (() => void)[] = [];
let active = 0;
const MAX_ACTIVE = 2;

function slot(): Promise<void> {
  if (active < MAX_ACTIVE) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiting.push(() => resolve())).then(() => {
    active++;
  });
}

function release() {
  active--;
  waiting.shift()?.();
}

/** Checks per window, then the rest of the window's tokens stay plain text. */
export function makeBudget(max: number, windowMs: number): () => boolean {
  let at = 0;
  let used = 0;
  return () => {
    const now = Date.now();
    if (now - at >= windowMs) {
      at = now;
      used = 0;
    }
    if (used >= max) return false;
    used++;
    return true;
  };
}

const budgeted = makeBudget(60, 10_000);

const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() ?? p;

export function absolutePath(root: string, p: string) {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) ? p : `${root.replace(/\/$/, "")}/${p.replace(/^\.\//, "")}`;
}

/** Collapse `.`/`..` and duplicate separators so containment can be compared. */
function normalizeAbs(p: string): string {
  const drive = /^[A-Za-z]:/.exec(p)?.[0] ?? "";
  const up: string[] = [];
  for (const seg of p.slice(drive.length).split(/[\\/]+/)) {
    if (!seg || seg === ".") continue;
    if (seg === "..") up.pop();
    else up.push(seg);
  }
  return `${drive}/${up.join("/")}`;
}

/**
 * Whether `path` resolves inside `root` (after `.`/`..` are collapsed). The
 * root itself counts; its parent does not. Absolute paths from a message are
 * checked the same way, so `/home/user/.ssh/id_rsa` is outside and stays plain
 * text.
 */
export function insideRoot(root: string, path: string): boolean {
  if (!root) return false;
  const r = normalizeAbs(root).replace(/\/+$/, "");
  const p = normalizeAbs(path);
  return r === "/" ? p.startsWith("/") : p === r || p.startsWith(`${r}/`);
}

/**
 * Whether `path` names a file (not a directory) under `root`. Directory
 * listings are cached per folder, so a message full of paths in one folder
 * costs one request. Paths outside `root` are refused outright, and checks
 * beyond the budget (`makeBudget`) simply report false.
 */
export function checkFile(client: FsClient, root: string, path: string): Promise<boolean> {
  const abs = normalizeAbs(absolutePath(root, path).replace(/[.,;!?]+$/, ""));
  const dir = abs.slice(0, abs.lastIndexOf("/")) || "/";
  if (!insideRoot(root, abs) || !insideRoot(root, dir) || !budgeted()) return Promise.resolve(false);
  const hit = cacheGet(fileCache, abs);
  if (hit) return hit.v;
  const ok = (async () => {
    const entry = cacheGet(dirCache, dir) ?? cacheSet(dirCache, dir, listDir(client, dir, root));
    return (await entry.v)?.some((e) => e.type === "file" && baseName(e.path) === baseName(abs)) ?? false;
  })();
  cacheSet(fileCache, abs, ok);
  return ok;
}

async function listDir(client: FsClient, dir: string, root: string) {
  await slot();
  try {
    return await client.listDir(dir, root).catch(() => null);
  } finally {
    release();
  }
}
