/**
 * The agent's browser steps, read back from its shell calls.
 *
 * Agents drive Chrome on a Boat machine with `otto-browser <command>` (see
 * providers/otto-browser.py). Each call prints the page as "Title | URL"
 * followed by numbered refs (`[a:12] link "Sign in"`), so a call and its
 * output say what happened in words a person can follow: "Clicked “Sign in”"
 * on "GitHub · github.com/login".
 */
import type { Block } from "./opencode/projection";
import type { ToolBlock } from "./opencode/tools";
import { isStopError, toolKind } from "./opencode/tools";

export type BrowserAction = "open" | "go" | "read" | "click" | "type" | "press" | "tabs" | "tab";

export interface BrowserStep {
  action: BrowserAction;
  /** "Clicked" / "Click" (while it runs). */
  verb: string;
  /** What it acted on: “Sign in”, github.com/login, Enter. */
  target: string;
  /** The page after the step, when the output says. */
  page?: { title: string; url: string };
  failed: boolean;
}

const ACTIONS = new Set<BrowserAction>(["open", "go", "read", "click", "type", "press", "tabs", "tab"]);
const CALL = /(?:^|[\s;&|(])(?:[^\s;&|()]*\/)?otto-browser\s+([a-z]+)([^\n;&|]*)/g;
const TOKEN = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
const HEADER = /^(.*?) \| ((?:https?|chrome|about|file|data|chrome-extension):\S*)\s*$/;

function tokens(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(TOKEN)) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? m[3]));
  return out;
}

/** "github.com/login" from a URL; the text as-is when it isn't one. */
export function shortUrl(raw: string): string {
  try {
    const u = new URL(raw.includes("://") || raw.startsWith("about:") ? raw : `https://${raw}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return raw;
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    return u.host.replace(/^www\./, "") + path;
  } catch {
    return raw;
  }
}

/** The page an output ends on: the last "Title | URL" header (or the starred tab in a tab list). */
export function pageOf(output?: string): BrowserStep["page"] {
  if (!output) return undefined;
  let page: BrowserStep["page"];
  for (const raw of output.split("\n")) {
    let line = raw.trimEnd();
    const tab = line.match(/^([* ]) \d+\. (.*)$/);
    if (tab) {
      if (tab[1] !== "*") continue;
      line = tab[2];
    }
    const m = line.match(HEADER);
    if (m) page = { title: m[1] === "(untitled)" ? "" : m[1], url: m[2] };
  }
  return page;
}

/** The name a ref had in an earlier read: `[a:12] link "Sign in"` → “Sign in”. */
function refName(ref: string, prior: string[]): string | null {
  const n = ref.replace(/^\[|\]$/g, "");
  const id = n.includes(":") ? n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : `(?:[^\\]:]*:)?${n.replace(/\D/g, "")}`;
  if (!/\d/.test(n)) return null;
  const re = new RegExp(`^\\[${id}\\] (\\w+)(?: "((?:[^"\\\\]|\\\\.)*)")?`, "m");
  for (let i = prior.length - 1; i >= 0; i--) {
    const m = prior[i].match(re);
    if (m) return m[2] ? m[2].replace(/\\(.)/g, "$1") : m[1];
  }
  return null;
}

const clip = (s: string, n = 48) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function describe(action: BrowserAction, args: string[], done: boolean, prior: string[]): Pick<BrowserStep, "verb" | "target"> {
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const rest = args.filter((a) => !a.startsWith("--"));
  const v = (past: string, now: string) => (done ? past : now);
  switch (action) {
    case "open":
      return rest[0] ? { verb: v("Opened", "Open"), target: shortUrl(rest[0]) } : { verb: v("Opened", "Open"), target: "Chrome" };
    case "go":
      return { verb: v("Went to", "Go to"), target: rest[0] ? shortUrl(rest[0]) : "" };
    case "read": {
      const q = args.indexOf("--query");
      if (q >= 0 && args[q + 1]) return { verb: v("Looked for", "Look for"), target: `“${clip(args[q + 1])}”` };
      return { verb: v("Read", "Read"), target: flags.has("--more") ? "more of the page" : "the page" };
    }
    case "click": {
      const name = rest[0] ? refName(rest[0], prior) : null;
      return { verb: v("Clicked", "Click"), target: name ? `“${clip(name)}”` : rest[0] ? `[${rest[0].replace(/^\[|\]$/g, "")}]` : "" };
    }
    case "type": {
      const text = rest.slice(1).join(" ");
      const into = rest[0] ? refName(rest[0], prior) : null;
      const target = [`“${clip(text, 40)}”`, into && `into “${clip(into, 32)}”`].filter(Boolean).join(" ");
      return { verb: v("Typed", "Type"), target: flags.has("--enter") ? `${target} ↵` : target };
    }
    case "press":
      return { verb: v("Pressed", "Press"), target: rest[0] ?? "" };
    case "tabs":
      return { verb: v("Listed", "List"), target: "the tabs" };
    case "tab":
      return { verb: v("Switched to", "Switch to"), target: rest[0] ? `tab ${rest[0]}` : "a tab" };
  }
}

function commandOf(b: ToolBlock): string | null {
  if (toolKind(b.name) !== "shell") return null;
  const input = b.input ?? {};
  const c = input.command ?? input.cmd;
  if (typeof c === "string") return c;
  // Still streaming its arguments: take what's there.
  return b.inputText && b.inputText.includes("otto-browser") ? b.inputText : null;
}

function outputOf(b: ToolBlock): string {
  const md = b.metadata ?? {};
  return b.output || (typeof md.output === "string" ? md.output : "");
}

/**
 * The browser step a shell call made (the last, when it chains several), or
 * null when it isn't one. `prior` is earlier outputs, to name clicked refs.
 */
export function browserStep(b: ToolBlock, prior: string[] = []): BrowserStep | null {
  const cmd = commandOf(b);
  if (!cmd || !cmd.includes("otto-browser")) return null;
  let last: RegExpMatchArray | null = null;
  for (const m of cmd.matchAll(CALL)) if (ACTIONS.has(m[1] as BrowserAction)) last = m;
  if (!last) return null;
  const action = last[1] as BrowserAction;
  const done = b.status === "completed" || b.status === "error";
  return {
    action,
    ...describe(action, tokens(last[2] ?? ""), done, prior),
    page: pageOf(outputOf(b)),
    // The CLI reports failures as "otto-browser: <why>" and exits 1.
    failed: (b.status === "error" && !isStopError(b.error)) || b.metadata?.exit === 1 || /^otto-browser: /m.test(outputOf(b)),
  };
}

/** Browser steps among blocks, in order, each with the block it came from. */
export function browserSteps(blocks: Block[], prior: string[] = []): { b: ToolBlock; step: BrowserStep }[] {
  const seen = [...prior];
  const out: { b: ToolBlock; step: BrowserStep }[] = [];
  for (const b of blocks) {
    if (b.kind !== "tool") continue;
    const step = browserStep(b, seen);
    if (step) {
      out.push({ b, step });
      seen.push(outputOf(b));
    }
  }
  return out;
}
