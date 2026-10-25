/**
 * Compact link previews: title, domain and favicon, with Open Graph
 * detail when a page offers it. The fetch is best-effort — queued, cached,
 * time-limited — and everything it learns is optional, so a link card is
 * useful before (and without) it.
 */
import { httpFetch } from "./platform";

export type LinkMeta = {
  title?: string;
  description?: string;
  image?: string;
  favicon?: string;
};

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&nbsp;": " " };

function decode(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(tag);
  return decode(m?.[2] ?? m?.[3] ?? m?.[4] ?? "").trim() || null;
}

function absolute(base: string, value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, base).href;
  } catch {
    return undefined;
  }
}

/** Read the head tags a preview wants. Pure; the caller fetches. */
export function parseLinkMeta(html: string, base: string): LinkMeta {
  const meta = new Map<string, string>();
  let favicon: string | undefined;
  for (const tag of html.match(/<(?:meta|link|title)\b[^>]*>/gi) ?? []) {
    const name = (attr(tag, "property") ?? attr(tag, "name") ?? "").toLowerCase();
    if (/^<meta/i.test(tag)) {
      const content = attr(tag, "content");
      if (name && content && !meta.has(name)) meta.set(name, content);
    } else if (/^<link/i.test(tag)) {
      const rel = (attr(tag, "rel") ?? "").toLowerCase();
      if (/(^|\s)(icon|shortcut icon|apple-touch-icon)(\s|$)/.test(rel) && !favicon) favicon = absolute(base, attr(tag, "href"));
    }
  }
  const titleTag = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = meta.get("og:title") ?? meta.get("twitter:title") ?? ((titleTag ? decode(titleTag[1]).trim() : "") || undefined);
  const description = meta.get("og:description") ?? meta.get("twitter:description") ?? meta.get("description") ?? undefined;
  const image = absolute(base, meta.get("og:image") ?? meta.get("twitter:image"));
  return { title, description: description ? decode(description).trim() : undefined, image, favicon };
}

// ---------------------------------------------------------------------------
// Fetching: one queue, a shared cache, never blocking the caller.
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<LinkMeta | null>>();
const waiting: (() => void)[] = [];
let active = 0;
const MAX_ACTIVE = 3;

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

const TIMEOUT_MS = 6000;
const MAX_HTML = 262_144;

async function fetchMeta(url: string): Promise<LinkMeta | null> {
  await slot();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await httpFetch(url, { signal: ctrl.signal, headers: { Accept: "text/html,application/xhtml+xml" } });
      if (!res.ok) return null;
      const type = res.headers.get("content-type") ?? "";
      if (type && !/text\/html|application\/xhtml/i.test(type)) return null;
      const html = (await res.text()).slice(0, MAX_HTML);
      return parseLinkMeta(html, url);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  } finally {
    release();
  }
}

/**
 * Cached metadata for a link. Resolves with null (and remembers it) when the
 * page can't be read, so a hundred copies of one link cost one request.
 */
export function linkMeta(url: string): Promise<LinkMeta | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetchMeta(url).catch(() => null);
    cache.set(url, p);
  }
  return p;
}

/** The usual place a site keeps its icon, when the page hasn't said. */
export function faviconGuess(url: string): string | undefined {
  try {
    return new URL("/favicon.ico", url).href;
  } catch {
    return undefined;
  }
}
