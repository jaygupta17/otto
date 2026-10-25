/**
 * Compact link previews: title, domain and favicon, with Open Graph
 * detail when a page offers it. The fetch is best-effort — queued, cached,
 * time-limited — and everything it learns is optional, so a link card is
 * useful before (and without) it.
 *
 * Message text is untrusted: it can quote anything the agent read, including
 * a page written to be seen by this app. So fetching is opt-in (Settings ›
 * Appearance › Link previews) and gated on `isPreviewable` before every
 * request and before any remote image is shown.
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
// What may be fetched at all. Message text can name any URL, so this is the
// boundary between "a link" and "a request from the user's machine".
// ---------------------------------------------------------------------------

/** Hostnames that name the local machine or the network it sits on. */
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".home", ".lan", ".intranet"];

function parseIPv4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? (parts as [number, number, number, number]) : null;
}

/** Loopback, private, link-local (incl. the cloud metadata endpoint), CGNAT. */
function blockedIPv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16: link-local, incl. 169.254.169.254
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  return false;
}

/** Eight hextets, or null when `host` is not a literal we can read. */
function parseIPv6(host: string): number[] | null {
  let s = host.toLowerCase();
  if (!s.includes(":")) return null;
  // A trailing dotted quad (`::ffff:127.0.0.1`) is folded into two hextets;
  // the URL parser already canonicalises it (`[::ffff:7f00:1]`), but not
  // every caller goes through it.
  const dot = s.lastIndexOf(".");
  if (dot !== -1) {
    const col = s.lastIndexOf(":");
    const v4 = col === -1 ? null : parseIPv4(s.slice(col + 1));
    if (!v4) return null;
    s = `${s.slice(0, col + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 0 : missing !== 0) return null;
  const out: number[] = [];
  for (const p of [...head, ...Array(missing).fill("0"), ...tail]) {
    if (!/^[0-9a-f]{1,4}$/.test(p)) return null;
    out.push(parseInt(p, 16));
  }
  return out;
}

function blockedIPv6(g: number[]): boolean {
  if (g.every((x) => x === 0)) return true; // ::, the unspecified address
  // IPv4-mapped (`::ffff:a.b.c.d`) and IPv4-compatible (`::a.b.c.d`) addresses
  // route to the IPv4 hiding in the last two hextets, so they take the IPv4
  // rules (which also catches `::1`, i.e. 0.0.0.1).
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    return blockedIPv4([(g[6] >> 8) & 0xff, g[6] & 0xff, (g[7] >> 8) & 0xff, g[7] & 0xff]);
  }
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  return false;
}

/**
 * Whether a URL may be fetched for a preview — and whether an image URL a page
 * named may be loaded. Rules:
 *
 * - scheme must be `http:` or `https:` (this also refuses `file:`,
 *   `javascript:` and `data:`),
 * - `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home`, `*.lan`,
 *   `*.intranet` and anything without a hostname are refused (case-insensitive),
 * - IP literals are refused inside 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8,
 *   169.254.0.0/16 (the cloud metadata endpoint), 172.16.0.0/12,
 *   192.168.0.0/16 and 100.64.0.0/10 (CGNAT); IPv6 literals (with or without
 *   brackets) are refused at `::`, `::1`, fe80::/10 and fc00::/7.
 *
 * Userinfo is not a way in: `URL.hostname` never includes it, so
 * `https://user@127.0.0.1` is checked as `127.0.0.1`. The URL parser also
 * canonicalises odd IPv4 spellings (`http://2130706433` is `127.0.0.1`) and
 * lowercases hosts, and both are re-checked here rather than assumed.
 *
 * Residual risk, deliberately unresolved: these are string checks on the
 * hostname, so a *public* name that resolves to a private address slips
 * through — direct DNS rebinding, or names like `localtest.me`. Closing that
 * needs the fetch to resolve the name first, vet every resolved address, and
 * pin the connection to the vetted ones (refusing mixed answers). That has to
 * happen in the Rust HTTP client (reqwest does its own DNS), so it can't be
 * done from here. Until then previews are opt-in, redirects are re-validated
 * per hop, and the response body is parsed, never executed.
 */
export function isPreviewable(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  let host = parsed.hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1); // `localhost.` is localhost
  if (!host) return false;
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (bare.includes(":")) {
    const groups = parseIPv6(bare);
    return groups ? !blockedIPv6(groups) : false;
  }
  const v4 = parseIPv4(bare);
  if (v4) return !blockedIPv4(v4);
  if (host === "localhost") return false;
  return !LOCAL_SUFFIXES.some((s) => host.endsWith(s));
}

// ---------------------------------------------------------------------------
// Fetching: one queue, a shared cache, never blocking the caller.
// ---------------------------------------------------------------------------

/** Bounded LRU: `Map` holds insertion order, so the oldest key comes first. */
const CACHE_MAX = 300;

function cacheGet<T>(m: Map<string, T>, k: string): T | undefined {
  const hit = m.get(k);
  if (hit !== undefined) {
    m.delete(k);
    m.set(k, hit);
  }
  return hit;
}

function cacheSet<T>(m: Map<string, T>, k: string, v: T) {
  m.delete(k);
  m.set(k, v);
  const oldest = m.keys().next();
  if (!oldest.done && m.size > CACHE_MAX) m.delete(oldest.value);
}

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
const MAX_HOPS = 5;

/** Read at most `MAX_HTML` bytes and stop: a lying `content-length` is caught by the counter, and a gzip bomb is cut off mid-stream. */
async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_HTML) return "";
  const body = res.body;
  if (!body) return (await res.text()).slice(0, MAX_HTML);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_HTML) {
        out += decoder.decode(value.subarray(0, value.byteLength - (total - MAX_HTML)), { stream: true });
        void reader.cancel().catch(() => {});
        return out + decoder.decode();
      }
      out += decoder.decode(value, { stream: true });
    }
  } catch {
    return out;
  }
  return out + decoder.decode();
}

/** The plugin's fetch takes reqwest options on top of `RequestInit`. */
type FetchInit = RequestInit & { maxRedirections?: number };

async function fetchMeta(url: string): Promise<LinkMeta | null> {
  await slot();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      let target = url;
      for (let hop = 0; hop < MAX_HOPS; hop++) {
        // `maxRedirections: 0` is what actually stops reqwest following
        // redirects (the Tauri plugin never forwards fetch's `redirect`
        // option); `redirect: "manual"` covers the plain-browser path. Every
        // hop is re-validated here before it is requested, so a public URL
        // can't 302 into `http://127.0.0.1:…`.
        const init: FetchInit = {
          signal: ctrl.signal,
          headers: { Accept: "text/html,application/xhtml+xml" },
          redirect: "manual",
          maxRedirections: 0,
        };
        const res = await httpFetch(target, init);
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get("location");
          if (!loc) return null;
          try {
            target = new URL(loc, target).href;
          } catch {
            return null;
          }
          if (!isPreviewable(target)) return null;
          continue;
        }
        if (!res.ok) return null;
        const type = res.headers.get("content-type") ?? "";
        if (type && !/text\/html|application\/xhtml/i.test(type)) return null;
        return safeMeta(parseLinkMeta(await readCapped(res), target));
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  } finally {
    release();
  }
}

/** A page can name any image URL; only previewable ones leave this module. */
function safeMeta(meta: LinkMeta): LinkMeta {
  return {
    ...meta,
    image: meta.image && isPreviewable(meta.image) ? meta.image : undefined,
    favicon: meta.favicon && isPreviewable(meta.favicon) ? meta.favicon : undefined,
  };
}

/**
 * Cached metadata for a link. Resolves with null (and remembers it) when the
 * page can't be read, so a hundred copies of one link cost one request.
 * Nothing is fetched for a URL that isn't previewable.
 */
export function linkMeta(url: string): Promise<LinkMeta | null> {
  if (!isPreviewable(url)) return Promise.resolve(null);
  let p = cacheGet(cache, url);
  if (!p) {
    p = fetchMeta(url).catch(() => null);
    cacheSet(cache, url, p);
  }
  return p;
}

/** The usual place a site keeps its icon, when the page hasn't said. */
export function faviconGuess(url: string): string | undefined {
  if (!isPreviewable(url)) return undefined;
  try {
    return new URL("/favicon.ico", url).href;
  } catch {
    return undefined;
  }
}
