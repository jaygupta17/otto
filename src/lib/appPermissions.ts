/**
 * Permissions for app actions, as the opencode-composio plugin names them:
 * `composio.<app>.<read|write|delete>.<action>`, the resource being who or
 * what the action reaches (recipients, guests, a channel, a repo). Rules are
 * ordinary OpenCode rules, so they sit in the same lists as every other
 * permission (lib/permissions); this adds what's special about apps: the
 * plugin's own defaults, the order rules need, and the action catalogue.
 */
import type { Effect, PermissionModel, PermissionRule } from "./permissions";
import { appName } from "./composio";

export type Kind = "read" | "write" | "delete";

export const KINDS: { kind: Kind; label: string; hint: string; verb: string }[] = [
  { kind: "read", label: "Reading", hint: "Searching, listing and opening", verb: "read" },
  { kind: "write", label: "Sending and changing", hint: "Sending, creating, editing and sharing", verb: "send and change things" },
  { kind: "delete", label: "Deleting", hint: "Removing things for good", verb: "delete things" },
];

/** The plugin's defaults for agents without a rule of their own (opencode-composio `defaults`). */
export const PLUGIN_DEFAULTS: Record<Kind, Effect> = { read: "allow", write: "ask", delete: "ask" };

export const APP_PREFIX = "composio.";
export const isAppPermission = (action: string) => action.startsWith(APP_PREFIX);

/** `composio.gmail.write.*`; app `*` for every app. */
export const kindPermission = (app: string, kind: Kind) => `${APP_PREFIX}${app}.${kind}.*`;

/** composio.gmail.write.send_email → its parts; null for anything else (composio.connect, patterns). */
export function parseAppPermission(action: string): { app: string; kind: Kind; name: string } | null {
  const m = /^composio\.([a-z0-9_]+|\*)\.(read|write|delete)\.([a-z0-9_]+|\*)$/.exec(action);
  return m ? { app: m[1], kind: m[2] as Kind, name: m[3] } : null;
}

/** OpenCode's wildcard: `*` is any run of characters, dots included. */
function wild(pattern: string, value: string) {
  if (pattern === "*" || pattern === value) return true;
  if (!pattern.includes("*") && !pattern.includes("?")) return false;
  return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(value);
}

/** Stands in for "any" when asking about a whole app or kind, so only rules that cover all of it count. */
const ANY = "\u0000any";

/** A concrete permission to evaluate: `composio.<app|any>.<kind>.<name|any>`. */
export const sample = (app: string, kind: Kind, name?: string) => `${APP_PREFIX}${app === "*" ? ANY : app}.${kind}.${name ?? ANY}`;

/**
 * What OpenCode decides for an app permission, with the plugin's defaults
 * where the plugin puts them: right after the last catch-all allow, so any
 * rule of yours after that (an agent's own, or one for everyone with no
 * catch-all of the agent's after it) wins. `resource` "*" asks about the
 * action in general, so only rules for any resource count.
 */
export function appEffect(action: string, layers: { global: readonly PermissionRule[]; agent: readonly PermissionRule[] }, resource = "*"): Effect {
  const list: PermissionRule[] = [{ action: "*", resource: "*", effect: "allow" }, ...layers.global, ...layers.agent];
  const at = list.findLastIndex((r) => r.action === "*" && r.resource === "*");
  if (list[at].effect === "allow") list.splice(at + 1, 0, ...(Object.entries(PLUGIN_DEFAULTS) as [Kind, Effect][]).filter(([, e]) => e !== "allow").map(([k, effect]) => ({ action: kindPermission("*", k), resource: "*", effect })));
  let effect: Effect = "ask";
  for (const r of list) {
    if (!wild(r.action, action)) continue;
    if (r.resource === "*" || (resource !== "*" && wild(r.resource, resource))) effect = r.effect;
  }
  return effect;
}

/** Broad before narrow, since the last matching rule wins: every app, an app, a kind, one action. */
function rank(action: string) {
  const p = parseAppPermission(action);
  if (!p) return action === "composio.*" ? 0 : /^composio\.[a-z0-9_]+\.\*$/.test(action) ? 2 : 1;
  return p.app === "*" ? (p.name === "*" ? 1 : 3) : p.name === "*" ? 3 : 4;
}

/**
 * Sets one app permission (`effect` null clears it) and re-emits every app
 * rule in rank order after the rest, the way the memory rows do: a rule for
 * one action must come after the one for its kind, and a remembered person
 * after both.
 */
export function setAppRule(model: PermissionModel, action: string, change: { effect?: Effect | null; patterns?: { pattern: string; effect: Effect }[] }): PermissionModel {
  const cur = model.keys[action] ?? { effect: null, patterns: [] };
  const next = { effect: change.effect !== undefined ? change.effect : cur.effect, patterns: change.patterns ?? cur.patterns };
  const keys = { ...model.keys, [action]: next };
  if (next.effect === null && next.patterns.length === 0) delete keys[action];
  const rest = Object.entries(keys).filter(([a]) => !isAppPermission(a));
  const apps = Object.entries(keys)
    .filter(([a]) => isAppPermission(a))
    .sort(([a], [b]) => rank(a) - rank(b));
  return { ...model, keys: Object.fromEntries([...rest, ...apps]), source: model.source.filter((r) => !isAppPermission(r.action)) };
}

/** Adds "allow this action for these people/places" to a rule list (what "Always" on an approval writes). */
export function withRemembered(rules: readonly PermissionRule[], action: string, resources: string[]): PermissionRule[] {
  const out = rules.filter((r) => !(r.action === action && resources.includes(r.resource)));
  return [...out, ...resources.map((resource) => ({ action, resource, effect: "allow" as Effect }))];
}

/** Takes back what withRemembered added. */
export function withoutRemembered(rules: readonly PermissionRule[], action: string, resources: string[]): PermissionRule[] {
  return rules.filter((r) => !(r.action === action && r.effect === "allow" && resources.includes(r.resource)));
}

/** What the plugin sent along with an app approval (opencode-composio `act`). */
export type AppRequest = { app: string; appName: string; action: string; kind?: Kind; targets: string[]; names: Record<string, string>; about?: string; preview?: string };

export function appRequest(action: string, metadata: Record<string, unknown> | undefined, resources: string[]): AppRequest | null {
  if (!isAppPermission(action)) return null;
  const md = metadata ?? {};
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const p = parseAppPermission(action);
  const app = str(md.app) ?? p?.app ?? "";
  const names = md.names && typeof md.names === "object" ? (Object.fromEntries(Object.entries(md.names).filter(([, v]) => typeof v === "string")) as Record<string, string>) : {};
  return {
    app,
    appName: str(md.appName) ?? appName(app),
    action: str(md.action) ?? actionTitle(action),
    kind: p?.kind ?? (md.kind === "read" || md.kind === "write" || md.kind === "delete" ? md.kind : undefined),
    targets: (Array.isArray(md.targets) ? md.targets.filter((t): t is string => typeof t === "string") : resources).filter((t) => t !== "*"),
    names,
    about: str(md.about),
    preview: str(md.preview),
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** The plugin's stand-ins for "nobody in particular". */
export const JUST_YOU = "just-you";
export const ANYONE = "anyone";

/** How a remembered resource reads: "Only you", "Anyone with the link", "everyone at acme.com". */
export function resourceLabel(resource: string, names?: Record<string, string>): string {
  if (resource === "*") return "Anyone or anything";
  if (resource === JUST_YOU) return "Only you";
  if (resource === ANYONE) return "Anyone with the link";
  if (resource.startsWith("*@")) return `Anyone at ${resource.slice(2)}`;
  return names?.[resource] ?? resource;
}

// ---------------------------------------------------------------------------
// The catalogue (the plugin's permissions.json, loaded on first use)
// ---------------------------------------------------------------------------

export type AppAction = { permission: string; title: string; kind: Kind; name: string };
export type AppCatalog = Record<string, { name: string; actions: AppAction[] }>;

let catalog: Promise<AppCatalog> | null = null;

/** Every featured app's actions with their permission names, from the plugin release Otto installs. */
export function loadAppCatalog(): Promise<AppCatalog> {
  catalog ??= import("./composio-permissions.json").then((m) => {
    const raw = m.default as unknown as { apps: Record<string, { name: string; actions: [string, string][] }> };
    const out: AppCatalog = {};
    for (const [app, a] of Object.entries(raw.apps)) {
      out[app] = {
        name: a.name,
        actions: a.actions.map(([permission, title]) => {
          const p = parseAppPermission(permission)!;
          return { permission, title, kind: p.kind, name: p.name };
        }),
      };
    }
    return out;
  });
  return catalog;
}

/** "Send email" for a permission, from the catalogue when it's loaded, else from its name. */
export function actionTitle(permission: string, cat?: AppCatalog | null): string {
  const p = parseAppPermission(permission);
  if (!p) return permission;
  if (p.name === "*") return `${KINDS.find((k) => k.kind === p.kind)!.label} in ${p.app === "*" ? "every app" : appName(p.app)}`;
  return cat?.[p.app]?.actions.find((a) => a.permission === permission)?.title ?? p.name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
