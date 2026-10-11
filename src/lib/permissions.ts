/**
 * Per-agent permission model for OpenCode v2.
 *
 * Adapted from OpenChamber's agentPermissionModel (MIT,
 * https://github.com/openchamber/openchamber).
 *
 * OpenCode stores an ORDERED list of `{ action, resource, effect }` rules
 * where the last match wins. People think "what may this agent do with each
 * tool?", so the editor shows one row per tool (inherit / allow / ask / deny)
 * plus optional resource patterns, and this module maps that view to and
 * from the rule list without disturbing rules the user didn't touch.
 */

export type Effect = "allow" | "ask" | "deny";
export interface PermissionRule {
  action: string;
  resource: string;
  effect: Effect;
}

export interface ToolMeta {
  action: string;
  label: string;
  /** Only for labels that aren't self-explanatory. */
  hint?: string;
  /** Example pattern shown when adding a resource-specific rule. */
  example?: string;
}

/** Built-in v2 tool actions, in display order, with plain-language labels. */
export const TOOLS: ToolMeta[] = [
  { action: "shell", label: "Run commands", example: "git push *" },
  { action: "edit", label: "Edit files", example: "src/**" },
  { action: "read", label: "Read files", example: "*.env" },
  { action: "glob", label: "Find files", },
  { action: "grep", label: "Search code", },
  { action: "webfetch", label: "Fetch web pages", example: "https://github.com/*" },
  { action: "websearch", label: "Search the web", },
  { action: "subagent", label: "Delegate to subagents", example: "explore" },
  { action: "question", label: "Ask you questions", },
  { action: "external_directory", label: "Leave the project", hint: "Files outside the project folder", example: "/tmp/*" },
];

/** v1 keys OpenCode 2 ignores; dropped on save. */
const LEGACY = new Set(["bash", "task", "write", "list", "lsp", "todowrite", "todoread", "multiedit", "doom_loop", "plan_enter", "plan_exit"]);

/** OpenCode's built-in base policy (before global config and the agent's own rules). */
const DEFAULT_RULES: readonly PermissionRule[] = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "external_directory", resource: "*", effect: "ask" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
];

export interface PatternRule {
  pattern: string;
  effect: Effect;
}
export interface KeyState {
  effect: Effect | null;
  patterns: PatternRule[];
}
export interface PermissionModel {
  global: Effect | null;
  keys: Record<string, KeyState>;
  source: readonly PermissionRule[];
}

export function parseRules(rules: readonly PermissionRule[]): PermissionModel {
  const model: PermissionModel = { global: null, keys: {}, source: rules.map((r) => ({ ...r })) };
  for (const rule of rules) {
    if (LEGACY.has(rule.action)) continue;
    if (rule.action === "*") {
      if (rule.resource === "*") model.global = rule.effect;
      continue;
    }
    const state = model.keys[rule.action] ?? { effect: null, patterns: [] };
    if (rule.resource === "*") state.effect = rule.effect;
    else {
      const i = state.patterns.findIndex((p) => p.pattern === rule.resource);
      if (i >= 0) state.patterns[i] = { pattern: rule.resource, effect: rule.effect };
      else state.patterns.push({ pattern: rule.resource, effect: rule.effect });
    }
    model.keys[rule.action] = state;
  }
  return model;
}

const key = (a: string, r: string) => `${a}\u0000${r}`;
const isViewRule = (r: PermissionRule) => r.action !== "*" || r.resource === "*";

function wanted(model: PermissionModel) {
  const w = new Map<string, Effect>();
  if (model.global !== null) w.set(key("*", "*"), model.global);
  for (const [action, st] of Object.entries(model.keys)) {
    if (st.effect !== null) w.set(key(action, "*"), st.effect);
    for (const p of st.patterns) {
      const pat = p.pattern.trim();
      if (pat) w.set(key(action, pat), p.effect);
    }
  }
  return w;
}

/** Write the view back as an ordered rule list, editing the source in place. */
export function serializeRules(model: PermissionModel): PermissionRule[] {
  const w = wanted(model);
  const emitted = new Set<string>();
  const rules: PermissionRule[] = [];
  for (const rule of model.source) {
    if (LEGACY.has(rule.action)) continue;
    if (!isViewRule(rule)) {
      rules.push({ ...rule });
      continue;
    }
    const k = key(rule.action, rule.resource);
    const eff = w.get(k);
    if (eff === undefined) continue;
    rules.push({ action: rule.action, resource: rule.resource, effect: eff });
    emitted.add(k);
  }
  if (model.global !== null && !emitted.has(key("*", "*"))) rules.unshift({ action: "*", resource: "*", effect: model.global });
  for (const [action, st] of Object.entries(model.keys)) {
    const wk = key(action, "*");
    if (st.effect !== null && !emitted.has(wk)) {
      const first = rules.findIndex((r) => r.action === action);
      const rule = { action, resource: "*", effect: st.effect };
      if (first >= 0) rules.splice(first, 0, rule);
      else rules.push(rule);
      emitted.add(wk);
    }
    for (const p of st.patterns) {
      const pat = p.pattern.trim();
      if (!pat) continue;
      const k = key(action, pat);
      const eff = w.get(k);
      if (eff === undefined || emitted.has(k)) continue;
      emitted.add(k);
      rules.push({ action, resource: pat, effect: eff });
    }
  }
  return rules;
}

/** What OpenCode decides for `action` (any resource) from the layers below the agent's own row. */
export function inheritedEffect(action: string, layers: { global: readonly PermissionRule[]; agentGlobal: Effect | null }): Effect {
  const combined: PermissionRule[] = [...DEFAULT_RULES, ...layers.global, ...(layers.agentGlobal ? [{ action: "*", resource: "*", effect: layers.agentGlobal }] : [])];
  let effect: Effect = "ask";
  for (const r of combined) {
    if (r.resource !== "*") continue;
    if (r.action === "*" || r.action === action || (r.action.endsWith("*") && action.startsWith(r.action.slice(0, -1)))) effect = r.effect;
  }
  return effect;
}

/** Does `resource` match a skill-level rule? Used to show per-skill effective state. */
export function effectFor(action: string, resource: string, rules: readonly PermissionRule[]): Effect {
  let effect: Effect = "ask";
  for (const r of rules) {
    if (!(r.action === "*" || r.action === action)) continue;
    if (r.resource === "*" || r.resource === resource || globMatch(r.resource, resource)) effect = r.effect;
  }
  return effect;
}

function globMatch(pattern: string, value: string) {
  const re = new RegExp("^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*").replace(/\?/g, ".") + "$");
  return re.test(value);
}
