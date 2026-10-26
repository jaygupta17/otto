/**
 * What the agent's `present` tool shows: reading the call, deciding what kind
 * of thing it is, and the checks that keep a presentation inside the session.
 *
 * A `source` is one of three shapes, and the shape is decided by what it is,
 * not by asking the agent:
 *
 *   a path   `out/cover.png`, `/work/app/index.html` — resolved against the
 *            session root and refused outside it (mdLinks' `insideRoot`)
 *   a URL    `https://…`, `localhost:5173` — a page to frame
 *   markup   `<html>…` — raw HTML from the agent, framed as-is
 *
 * The renderer follows from the extension (`image`, `html`, `text`) and falls
 * back to a download row for archives, binaries and anything unrecognised.
 * `as` lets the agent force one when the name doesn't say enough.
 */
import { basename } from "./format";
import { absolutePath, insideRoot, normalizePath } from "./mdLinks";

export const ARTIFACT_KINDS = ["image", "html", "url", "text", "download"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface PresentInput {
  source: string;
  title?: string;
  as?: ArtifactKind;
}

/**
 * The most a presentation may carry. An `http(s)` URL is short, a path is
 * short, and raw markup is bounded so one call can't park a whole site in the
 * store; past this the agent should write a file and present that. The tool
 * (`presentPlugin.ts`) refuses the same size first, so a model gets told.
 */
export const MAX_SOURCE = 512_000;

const isKind = (v: unknown): v is ArtifactKind => typeof v === "string" && (ARTIFACT_KINDS as readonly string[]).includes(v);

/**
 * The agent-facing input, normalised. Returns `{ problem }` when it can't be
 * used, so the surface can say what was wrong instead of drawing nothing.
 */
export function parsePresent(input: Record<string, unknown> | undefined): PresentInput | { problem: string } {
  const raw = input?.source;
  const source = typeof raw === "string" ? raw.trim() : "";
  if (!source) return { problem: "The agent didn't say what to show." };
  if (source.length > MAX_SOURCE) return { problem: "That's too much to show here. Write it to a file and present the file." };
  const title = typeof input?.title === "string" && input.title.trim() ? input.title.trim().slice(0, 160) : undefined;
  // An unknown `as` is ignored rather than refused: the source still knows
  // what it is, and a wrong hint is the agent's problem, not the user's.
  const as = isKind(input?.as) ? input.as : undefined;
  return { source, title, as };
}

// ---------------------------------------------------------------------------
// What a source is
// ---------------------------------------------------------------------------

/** `<…>`, with a letter or `!` after the bracket, so `a < b` stays a path. */
const MARKUP = /^\s*<(?:!doctype|!doctype\s+html|html|head|body|div|section|main|article|header|footer|nav|aside|p|span|a|img|picture|video|audio|canvas|svg|h[1-6]|ul|ol|li|table|form|button|input|style|script|meta|link|title)\b/i;

/** The addresses that mean "the machine the agent runs on", with or without a scheme. */
const LOOPBACK = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])$/i;

/**
 * A loopback address and its port — `localhost:5173/app`, `http://127.0.0.1:8080`,
 * `[::1]:3000` — or null when the address isn't the agent's own machine. The
 * agent writes these the short way (no scheme), so both spellings are read.
 */
export function localAddress(raw: string): { port: number; rest: string } | null {
  let u: URL;
  try {
    u = new URL(/^\w+:\/\//.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (!LOOPBACK.test(u.hostname)) return null;
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const rest = u.pathname + u.search + u.hash;
  return { port, rest: rest === "/" ? "" : rest };
}

export function looksLikeMarkup(source: string): boolean {
  return MARKUP.test(source) && source.includes(">");
}

export function isHttpUrl(source: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(source);
}

/** A page. Without a scheme it needs a port (`localhost:5173`); with one, a URL parser decides. */
export const isUrlSource = (source: string): boolean => isHttpUrl(source) || /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d{1,5}(?:[/?#]|$)/i.test(source);

/** Extension of a path, lowercased; "" when it has none. */
export function extOf(path: string): string {
  const name = basename(path).toLowerCase();
  return name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
}

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "icns", "heic", "tif", "tiff", "svg"]);
const HTML = new Set(["html", "htm", "xhtml"]);

/**
 * Text the existing file preview reads well: source, prose, config, data and
 * PDFs. Everything else — archives, images the panel can't draw, binaries,
 * unknown extensions — is a download row.
 */
const TEXT = new Set([
  ...[
    "ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "jsonc", "css", "scss", "less", "html", "htm", "md", "markdown", "mdx", "mdx",
    "txt", "text", "log", "csv", "tsv", "yml", "yaml", "toml", "ini", "cfg", "conf", "env", "xml", "svg",
  ],
  ...[
    "py", "rs", "go", "java", "kt", "kts", "swift", "rb", "php", "c", "h", "cc", "cpp", "hpp", "cs", "m", "mm",
    "sh", "bash", "zsh", "fish", "ps1", "sql", "lua", "zig", "ex", "exs", "dart", "vue", "svelte", "astro",
    "proto", "graphql", "gql", "diff", "patch", "lock", "gitignore", "dockerfile", "makefile",
  ],
  "pdf",
]);

/** Extensions that are never worth framing or colouring: a row with a size and a download. */
export const ARCHIVE = new Set(["zip", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar", "tar", "jar", "war"]);

/** The renderer a path's name asks for. */
export function kindOfPath(path: string): ArtifactKind {
  const ext = extOf(path);
  if (IMAGE.has(ext)) return "image";
  if (HTML.has(ext)) return "html";
  if (TEXT.has(ext)) return "text";
  // A name with no extension is nearly always text (`Makefile`, `LICENSE`).
  if (!ext) return "text";
  return "download";
}

export type Classified =
  | { kind: "url"; url: string }
  | { kind: "markup"; markup: string }
  | { kind: "path"; path: string };

/**
 * What the source is, once `as` has had its say. `as: "url"`/`"html"` on raw
 * markup and `as: "image"` on a path are the agent overriding the guess; a
 * contradiction (`as: "url"` on a file path) is reported, not rendered.
 */
export function classify(source: string, as?: ArtifactKind): Classified | { problem: string } {
  const markup = looksLikeMarkup(source);
  if (as === "url") {
    if (!isUrlSource(source)) return { problem: "That isn't an http(s) address." };
    return { kind: "url", url: source };
  }
  if (as === "html") return markup ? { kind: "markup", markup: source } : { kind: "path", path: source };
  if (as === "image" || as === "text" || as === "download") {
    if (markup) return { problem: `Markup can't be shown as ${as}.` };
    return { kind: "path", path: source };
  }
  if (isUrlSource(source)) return { kind: "url", url: source };
  if (markup) return { kind: "markup", markup: source };
  return { kind: "path", path: source };
}

/** The label a presentation gets when the agent gave none. */
export function titleFor(source: string, as?: ArtifactKind): string {
  if (looksLikeMarkup(source)) return "Markup";
  if (isHttpUrl(source)) {
    try {
      const u = new URL(source);
      return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
    } catch {
      return source.slice(0, 80);
    }
  }
  const local = localAddress(source);
  if (local) return `localhost:${local.port}${local.rest}`;
  return basename(source) || (as === "url" ? "Page" : "Artifact");
}

/**
 * A file path from the agent, resolved and kept inside the session root.
 * `insideRoot` answers for the path and for its folder, so a symlinked parent
 * written as `..` can't slip out either.
 */
export function resolveArtifactPath(root: string, source: string): { path: string } | { problem: string } {
  if (!root) return { problem: "This session has no folder to look in yet." };
  const path = normalizePath(absolutePath(root, source));
  const dir = path.slice(0, path.lastIndexOf("/")) || "/";
  if (!insideRoot(root, path) || !insideRoot(root, dir)) return { problem: "That file is outside this session's folder, so it isn't shown here." };
  return { path };
}

/** Bytes as the panel writes them ("12.4 KB"). */
export function fileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
