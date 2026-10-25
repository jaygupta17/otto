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
// ---------------------------------------------------------------------------

interface FsClient {
  listDir(path: string, directory?: string): Promise<{ path: string; type: "file" | "directory" }[]>;
}

const dirCache = new Map<string, { at: number; list: Promise<{ path: string; type: "file" | "directory" }[] | null> }>();
const fileCache = new Map<string, { at: number; ok: Promise<boolean> }>();

/** A minute: long enough to absorb a stream of mentions, short enough that a file the agent just created still gets linked. */
const TTL_MS = 60_000;

const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() ?? p;

export function absolutePath(root: string, p: string) {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) ? p : `${root.replace(/\/$/, "")}/${p.replace(/^\.\//, "")}`;
}

/**
 * Whether `path` names a file (not a directory) under `root`. Directory
 * listings are cached per folder, so a message full of paths in one folder
 * costs one request.
 */
export function checkFile(client: FsClient, root: string, path: string): Promise<boolean> {
  const abs = absolutePath(root, path).replace(/[.,;!?]+$/, "");
  const hit = fileCache.get(abs);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;
  const ok = (async () => {
    const dir = abs.slice(0, abs.lastIndexOf("/")) || "/";
    let entry = dirCache.get(dir);
    if (!entry || Date.now() - entry.at >= TTL_MS) {
      entry = {
        at: Date.now(),
        list: client
          .listDir(dir, root)
          .then((list) => list)
          .catch(() => null),
      };
      dirCache.set(dir, entry);
    }
    const list = await entry.list;
    return !!list?.some((e) => e.type === "file" && baseName(e.path) === baseName(abs));
  })();
  fileCache.set(abs, { at: Date.now(), ok });
  return ok;
}
