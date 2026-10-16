/** Lazy Shiki highlighter (loaded on first code block, languages on demand). */
import type { HighlighterGeneric } from "shiki";

type HL = HighlighterGeneric<string, string>;
let hl: Promise<HL> | null = null;
const loaded = new Set<string>();
const cache = new Map<string, string>();

const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  rs: "rust",
  yml: "yaml",
  md: "markdown",
  golang: "go",
  "c++": "cpp",
  cs: "csharp",
  kt: "kotlin",
  rb: "ruby",
  dockerfile: "docker",
};

const EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  md: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  kt: "kotlin",
  java: "java",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  cs: "csharp",
  vue: "vue",
  svelte: "svelte",
  zig: "zig",
  lua: "lua",
  dart: "dart",
};

export function langFromPath(path: string): string {
  const name = path.split("/").pop() ?? "";
  if (/^dockerfile$/i.test(name)) return "docker";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return EXT[ext] ?? "text";
}

/** Above this, highlighting blocks the UI for too long; callers show plain text. */
export const HIGHLIGHT_LIMIT = 150_000;

// LRU by total size: recently used blocks stay, big files don't pin memory.
const CACHE_BUDGET = 6_000_000;
let cacheSize = 0;
const inflight = new Map<string, Promise<string | null>>();

function remember(key: string, html: string) {
  cache.set(key, html);
  cacheSize += key.length + html.length;
  for (const [k, v] of cache) {
    if (cacheSize <= CACHE_BUDGET) break;
    cache.delete(k);
    cacheSize -= k.length + v.length;
  }
}

/** Let the browser paint / handle input before a long synchronous highlight. */
const idle = () => new Promise<void>((r) => ("requestIdleCallback" in window ? requestIdleCallback(() => r(), { timeout: 300 }) : setTimeout(r, 16)));

export function highlight(code: string, lang: string): Promise<string | null> {
  const l = ALIASES[lang?.toLowerCase()] ?? (lang?.toLowerCase() || "text");
  const key = `${l}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return Promise.resolve(hit);
  }
  if (code.length > HIGHLIGHT_LIMIT) return Promise.resolve(null);
  const pending = inflight.get(key);
  if (pending) return pending;
  const p = run(code, l, key).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function run(code: string, l: string, key: string): Promise<string | null> {
  if (!hl) {
    hl = import("shiki/bundle/web").then((m) => m.createHighlighter({ themes: ["github-light-default", "github-dark-default"], langs: [] }) as Promise<HL>);
  }
  const h = await hl;
  if (l !== "text" && !loaded.has(l)) {
    try {
      await h.loadLanguage(l as never);
      loaded.add(l);
    } catch {
      return null;
    }
  }
  if (code.length > 20_000) await idle();
  const html = h.codeToHtml(code, { lang: loaded.has(l) ? l : "text", themes: { light: "github-light-default", dark: "github-dark-default" }, defaultColor: false });
  remember(key, html);
  return html;
}
