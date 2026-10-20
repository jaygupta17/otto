/**
 * Apps (Gmail, Calendar, Slack…) through Composio Connect, with the user's own
 * consumer key. No server of ours: Otto talks to Composio's connector endpoint
 * directly to list and add connections, and each agent machine gets the
 * opencode-composio plugin, its key in a file beside the config. The plugin
 * makes every app action its own tool with its own permission
 * (`composio.<app>.<read|write|delete>.<action>`), which is what the
 * permission settings and approvals here speak.
 *
 * Connections belong to the Composio account, not the machine: connect Gmail
 * once and every workspace has it.
 */
import { httpFetch } from "./platform";
import type { GlobalConfig } from "./opencode/config";

export const COMPOSIO_MCP_URL = "https://connect.composio.dev/mcp";
/** Where people get their key: Composio dashboard → For You → Sessions & API Key. */
export const COMPOSIO_KEY_URL = "https://dashboard.composio.dev";
/** The MCP server older Otto builds installed; replaced by the plugin on the next connect. */
export const COMPOSIO_SERVER = "composio";
export const COMPOSIO_PLUGIN = "opencode-composio";
export const COMPOSIO_PLUGIN_REPO = "jaygupta17/opencode-composio";
/**
 * Pinned to a commit: OpenCode leaves pinned plugins alone, and the permission
 * names below come from this one. Bump both with `bun run composio:sync`,
 * which copies that commit's `permissions.json` to `composio-permissions.json`
 * and checks it's `COMPOSIO_PLUGIN_VERSION`.
 */
export const COMPOSIO_PLUGIN_COMMIT = "51c7e6f797dd57d1acd66878d74f8aaa383802d7";
export const COMPOSIO_PLUGIN_VERSION = "0.1.0";
/** For working on the plugin: a local checkout to load instead of the pinned one (dev builds only). */
const DEV_PLUGIN = import.meta.env.DEV ? (import.meta.env.VITE_COMPOSIO_PLUGIN as string | undefined) : undefined;
export const COMPOSIO_PLUGIN_SPEC = DEV_PLUGIN || `github:${COMPOSIO_PLUGIN_REPO}#${COMPOSIO_PLUGIN_COMMIT}`;
/** Device secret holding the key. */
export const COMPOSIO_SECRET = "composio.key";

type PluginEntry = string | { package?: string; options?: Record<string, unknown> };
const specOf = (e: PluginEntry) => (typeof e === "string" ? e : e?.package);
/** Ours from anywhere: npm (`opencode-composio@0.1.0`), GitHub (`github:…/opencode-composio#sha`, `git+https://…/opencode-composio.git`), or a checkout. */
const isComposioEntry = (e: PluginEntry) => {
  const spec = specOf(e);
  return typeof spec === "string" && (spec === DEV_PLUGIN || /(^|[/:])opencode-composio(\.git)?\/?([#@].*)?$/.test(spec));
};

/** The plugin is there, this release, reading this key file; and the old MCP server is gone. */
export function composioInstalled(cfg: GlobalConfig, keyFile: string): boolean {
  const entries = [cfg.plugins, cfg.plugin].flatMap((l) => (Array.isArray(l) ? (l as PluginEntry[]) : [])).filter(isComposioEntry);
  const e = entries[0];
  return entries.length === 1 && typeof e === "object" && e.package === COMPOSIO_PLUGIN_SPEC && e.options?.keyFile === keyFile && !cfg.mcp?.servers?.[COMPOSIO_SERVER];
}

/** Drops every copy of the plugin and the old MCP server. */
export function withoutComposio(cfg: GlobalConfig): GlobalConfig {
  const next = { ...cfg };
  for (const key of ["plugins", "plugin"] as const) {
    const list = next[key];
    if (!Array.isArray(list)) continue;
    const kept = (list as PluginEntry[]).filter((e) => !isComposioEntry(e));
    if (kept.length) next[key] = kept;
    else delete next[key];
  }
  if (next.mcp?.servers?.[COMPOSIO_SERVER]) {
    const servers = { ...next.mcp.servers };
    delete servers[COMPOSIO_SERVER];
    next.mcp = { ...next.mcp, servers };
  }
  return next;
}

/** Exactly one plugin entry, the pinned release, reading `keyFile`. Otto owns it, so an older pin is replaced. */
export function withComposio(cfg: GlobalConfig, keyFile: string): GlobalConfig {
  const next = withoutComposio(cfg);
  const plugins = Array.isArray(next.plugins) ? (next.plugins as PluginEntry[]) : [];
  return { ...next, plugins: [...plugins, { package: COMPOSIO_PLUGIN_SPEC, options: { keyFile } }] };
}

export type App = { slug: string; name: string; blurb: string };

/** The apps worth having first, in the order people reach for them. Anything else Composio has, the agent can still find and connect. */
export const APPS: App[] = [
  { slug: "gmail", name: "Gmail", blurb: "Read, search and draft email" },
  { slug: "googlecalendar", name: "Google Calendar", blurb: "Your schedule, free time and invites" },
  { slug: "googledrive", name: "Google Drive", blurb: "Find and read your files" },
  { slug: "googledocs", name: "Google Docs", blurb: "Read and write documents" },
  { slug: "googlesheets", name: "Google Sheets", blurb: "Read and update spreadsheets" },
  { slug: "slack", name: "Slack", blurb: "Channels, threads and messages" },
  { slug: "notion", name: "Notion", blurb: "Pages, databases and notes" },
  { slug: "github", name: "GitHub", blurb: "Issues, pull requests and repos" },
  { slug: "linear", name: "Linear", blurb: "Issues, projects and cycles" },
  { slug: "outlook", name: "Outlook", blurb: "Microsoft mail and calendar" },
];

export const appLogo = (slug: string) => `https://logos.composio.dev/api/${slug}`;
export const appName = (slug: string) => APPS.find((a) => a.slug === slug)?.name ?? slug.replace(/^google/, "Google ").replace(/\b\w/g, (c) => c.toUpperCase());

export type AccountStatus = "active" | "initiated" | "failed" | "expired" | "inactive";
export type Account = { id: string; status: AccountStatus; alias?: string; isDefault?: boolean };

export class ComposioError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

let rpcId = 0;

/** One JSON-RPC call to the connector endpoint. It answers as JSON or as a short event stream. */
async function rpc<T>(key: string, method: string, params?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await httpFetch(COMPOSIO_MCP_URL, {
      method: "POST",
      headers: { "x-consumer-api-key": key, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
  } catch (e) {
    throw new ComposioError(`Couldn't reach Composio: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) throw new ComposioError("Composio didn't accept that key. Copy it again from For You → Sessions & API Key.", res.status);
  if (!res.ok) throw new ComposioError(`Composio answered ${res.status}.`, res.status);
  const text = await res.text();
  const body = text.trimStart().startsWith("{")
    ? text
    : text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .pop();
  if (!body) throw new ComposioError("Composio sent an empty answer.");
  const msg = JSON.parse(body) as { result?: T; error?: { message?: string } };
  if (msg.error) throw new ComposioError(msg.error.message ?? "Composio returned an error.");
  return msg.result as T;
}

/** Call one of Composio's tools and unwrap its `{successful, data, error}` answer. */
async function tool<T>(key: string, name: string, args: unknown): Promise<T> {
  const r = await rpc<{ content?: { type: string; text?: string }[]; isError?: boolean }>(key, "tools/call", { name, arguments: args });
  const text = r.content?.find((c) => c.type === "text")?.text ?? "";
  let out: { successful?: boolean; data?: T; error?: string | null };
  try {
    out = JSON.parse(text);
  } catch {
    throw new ComposioError(text || "Composio returned something unexpected.");
  }
  if (r.isError || out.successful === false) throw new ComposioError(out.error || "Composio couldn't do that.");
  return out.data as T;
}

/** Does this key open a Composio account? */
export async function checkKey(key: string): Promise<void> {
  await rpc(key, "tools/list");
}

type ManageResult = { results: Record<string, { status?: string; redirect_url?: string; accounts?: { id: string; status: string; alias?: string; is_default?: boolean }[] }> };

const toAccount = (a: { id: string; status: string; alias?: string; is_default?: boolean }): Account => ({ id: a.id, status: a.status.toLowerCase() as AccountStatus, alias: a.alias, isDefault: a.is_default });

/** Every account connected for these apps, by app. */
export async function listAccounts(key: string, slugs: string[]): Promise<Record<string, Account[]>> {
  const data = await tool<ManageResult>(key, "COMPOSIO_MANAGE_CONNECTIONS", { toolkits: slugs.map((name) => ({ name, action: "list" })) });
  const out: Record<string, Account[]> = {};
  for (const slug of slugs) out[slug] = (data.results?.[slug]?.accounts ?? []).map(toAccount);
  return out;
}

/** Start connecting an app: the link to open (good for 10 minutes) and the account it will become. */
export async function addAccount(key: string, slug: string): Promise<{ url: string; accountId?: string }> {
  const data = await tool<ManageResult>(key, "COMPOSIO_MANAGE_CONNECTIONS", { toolkits: [{ name: slug, action: "add" }] });
  const r = data.results?.[slug];
  if (!r?.redirect_url) throw new ComposioError(`Composio didn't return a link for ${appName(slug)}.`);
  const pending = r.accounts?.find((a) => a.status.toLowerCase() === "initiated");
  return { url: r.redirect_url, accountId: pending?.id };
}

export async function removeAccount(key: string, slug: string, accountId: string): Promise<void> {
  await tool(key, "COMPOSIO_MANAGE_CONNECTIONS", { toolkits: [{ name: slug, action: "remove", account_id: accountId }] });
}

/** The link Composio hands the agent when it needs an app connected (shown as a card in chat). */
export const CONNECT_LINK = /https:\/\/connect\.composio\.dev\/link\/[A-Za-z0-9_-]+/;
