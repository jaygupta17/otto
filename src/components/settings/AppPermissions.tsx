/**
 * What an agent may do in your apps: per app, reading / sending and changing
 * / deleting, each Allow, Ask or Block; any single action on its own; and the
 * people and places it was told "always" for, each undoable. Edits the same
 * permission model as the rest of the editor (for one teammate, or for
 * everyone), through lib/appPermissions so the rules stay in the order
 * OpenCode needs.
 */
import { AnimatePresence, motion } from "motion/react";
import { Blocks, ChevronRight, X } from "lucide-react";
import { useContext, useEffect, useMemo, useState } from "react";
import { APPS, appLogo, appName } from "../../lib/composio";
import { serializeRules, type Effect, type PermissionModel, type PermissionRule } from "../../lib/permissions";
import { actionTitle, appEffect, KINDS, kindPermission, loadAppCatalog, parseAppPermission, resourceLabel, sample, setAppRule, type AppCatalog, type Kind } from "../../lib/appPermissions";
import { useConnectors } from "../../state/connectors";
import { useUI } from "../../state/ui";
import { IconButton } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { EffectPicker, LoadMore, PhonePage, SearchBox } from "./common";
import { Pip, type PipTone } from "../ui/Pip";

const PAGE = 40;
/** Where Settings → Apps sends you to change what teammates may do. */
export const APP_PERMISSIONS_ID = "app-permissions";
/** An effect as a pip: on when it may, a plus when it asks you first, an x when it never may. */
export const EFFECT_PIP: Record<Effect, PipTone> = { allow: "on", ask: "needs", deny: "error" };
const SHORT: Record<Kind, string> = { read: "Read", write: "Send", delete: "Delete" };
const MEANS: Record<Effect, string> = { allow: "without asking", ask: "after asking you", deny: "never" };

type Props = { model: PermissionModel; onChange: (m: PermissionModel) => void; globalRules: readonly PermissionRule[] };

export function AppPermissions({ model, onChange, globalRules }: Props) {
  const key = useConnectors((s) => s.key);
  const accounts = useConnectors((s) => s.accounts);
  const agent = useMemo(() => serializeRules(model), [model]);
  const [catalog, setCatalog] = useState<AppCatalog | null>(null);
  useEffect(() => {
    void loadAppCatalog().then(setCatalog);
  }, []);

  // Connected apps, then any app this model still has rules for.
  const apps = useMemo(() => {
    const connected = APPS.map((a) => a.slug).filter((slug) => accounts?.[slug]?.some((a) => a.status === "active"));
    const ruled = Object.keys(model.keys)
      .map((a) => parseAppPermission(a)?.app)
      .filter((a): a is string => !!a && a !== "*");
    return [...new Set([...connected, ...ruled])];
  }, [accounts, model.keys]);

  /** What happens for `action`; `without` drops that key's own any-resource rule (its inherited value). */
  const effect = (action: string, without?: string) => appEffect(action, { global: globalRules, agent: without ? serializeRules(setAppRule(model, without, { effect: null })) : agent });
  const set = (action: string, change: Parameters<typeof setAppRule>[2]) => onChange(setAppRule(model, action, change));
  const ctx = { model, effect, set, catalog };
  const phone = useContext(PhonePage);

  return (
    <div id={APP_PERMISSIONS_ID} className="scroll-mt-4">
      <div className={phone ? "mb-2 text-[11px] font-medium tracking-[0.06em] text-accent-ink uppercase" : "mb-2 text-[14px] font-semibold"}>Apps</div>
      <div className={phone ? "-mt-1 mb-2 text-[13px] text-muted" : "-mt-1 mb-2 text-[12px] text-muted"}>{key ? "What they may do in the apps you've connected. Blocked actions disappear from their tools." : "Connect Gmail, Calendar, Slack and more, then choose here what teammates may do in them."}</div>
      {key ? (
        <div className="group-card divide-y divide-[var(--border)] overflow-hidden">
          <AppCard app="*" {...ctx} />
          {accounts === null ? (
            <div className="flex justify-center py-3 text-muted">
              <Spinner />
            </div>
          ) : apps.length === 0 ? (
            <div className="px-4 py-3 text-[12px] text-faint">No apps connected yet.</div>
          ) : (
            apps.map((app) => <AppCard key={app} app={app} {...ctx} />)
          )}
        </div>
      ) : (
        <button type="button" onClick={() => useUI.getState().openSettings("apps")} className="rounded-full px-3 py-1.5 text-[12px] text-ink-2 hairline transition-colors hover:bg-hover hover:text-ink">
          Connect apps
        </button>
      )}
    </div>
  );
}

type Ctx = {
  model: PermissionModel;
  effect: (action: string, without?: string) => Effect;
  set: (action: string, change: { effect?: Effect | null; patterns?: { pattern: string; effect: Effect }[] }) => void;
  catalog: AppCatalog | null;
};

function AppLogo({ app }: { app: string }) {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white hairline">
      {app === "*" ? <Blocks size={14} className="text-[#555]" /> : <img src={appLogo(app)} alt="" width={16} height={16} draggable={false} />}
    </span>
  );
}

function AppCard({ app, model, effect, set, catalog }: { app: string } & Ctx) {
  const [open, setOpen] = useState(false);
  const every = app === "*";
  const kinds = KINDS.map((k) => ({ ...k, action: kindPermission(app, k.kind), now: effect(sample(app, k.kind)) }));
  // Rules narrower than the kinds: single actions, and remembered people and places.
  const prefix = every ? null : `composio.${app}.`;
  const actions = prefix ? Object.entries(model.keys).filter(([a, st]) => a.startsWith(prefix) && parseAppPermission(a)?.name !== "*" && st.effect !== null).length : 0;
  const remembered = Object.entries(model.keys).flatMap(([action, st]) => (action.startsWith(prefix ?? "composio.*.") ? st.patterns.map((p) => ({ action, ...p })) : []));
  const extra = [actions && `${actions} action${actions === 1 ? "" : "s"} set`, remembered.length && `${remembered.length} remembered`].filter(Boolean).join(" · ");

  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover/50">
        <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
        <AppLogo app={app} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink">{every ? "Every app" : appName(app)}</span>
          <span className="block truncate text-[12px] text-muted">{every ? "Unless an app below says otherwise, and the 500+ apps they find themselves" : extra || "Same as every app"}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2.5 max-sm:hidden" aria-hidden>
          {kinds.map((k) => (
            <span key={k.kind} className="inline-flex items-center gap-1 text-[11px] text-muted" title={`${k.label}: ${MEANS[k.now]}`}>
              <Pip tone={EFFECT_PIP[k.now]} />
              {SHORT[k.kind]}
            </span>
          ))}
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="divide-y divide-[var(--border)] border-t border-line bg-sunken/40">
              {kinds.map((k) => (
                <div key={k.kind} className="flex items-center gap-3 py-2.5 pr-4 pl-10 sm:pl-[60px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-ink">{k.label}</span>
                    <span className="block truncate text-[12px] text-muted">{k.hint}</span>
                  </span>
                  <EffectPicker value={model.keys[k.action]?.effect ?? null} inherited={effect(sample(app, k.kind), k.action)} onChange={(v) => set(k.action, { effect: v })} />
                </div>
              ))}
              {remembered.length > 0 && <Remembered items={remembered} model={model} set={set} catalog={catalog} />}
              {!every && <EveryAction app={app} model={model} effect={effect} set={set} catalog={catalog} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** "Always" answers, and any rule for a particular person or place. */
function Remembered({ items, model, set, catalog }: { items: { action: string; pattern: string; effect: Effect }[] } & Omit<Ctx, "effect">) {
  const drop = (action: string, pattern: string) => set(action, { patterns: (model.keys[action]?.patterns ?? []).filter((p) => p.pattern !== pattern) });
  const change = (action: string, pattern: string, effect: Effect) => set(action, { patterns: (model.keys[action]?.patterns ?? []).map((p) => (p.pattern === pattern ? { ...p, effect } : p)) });
  return (
    <div className="py-2.5 pr-4 pl-10 sm:pl-[60px]">
      <div className="mb-1.5 text-[12px] font-medium text-ink-2">Remembered</div>
      <div className="space-y-1.5">
        {items.map((r) => (
          <div key={`${r.action}\u0000${r.pattern}`} className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-ink">{actionTitle(r.action, catalog)}</span>
              <span className="block truncate text-[12px] text-muted">{resourceLabel(r.pattern)}</span>
            </span>
            <EffectPicker allowInherit={false} value={r.effect} onChange={(v) => v && change(r.action, r.pattern, v)} />
            <IconButton label="Forget" size={26} onClick={() => drop(r.action, r.pattern)}>
              <X size={13} />
            </IconButton>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Each of the app's actions on its own, the ones you've set first. */
function EveryAction({ app, model, effect, set, catalog }: { app: string } & Ctx) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const all = catalog?.[app]?.actions;
  const list = useMemo(() => {
    if (!all) return [];
    const needle = q.trim().toLowerCase();
    const order = { read: 0, write: 1, delete: 2 };
    return all
      .filter((a) => !needle || a.title.toLowerCase().includes(needle) || a.name.includes(needle.replace(/\s+/g, "_")))
      .sort((a, b) => Number(model.keys[b.permission]?.effect != null) - Number(model.keys[a.permission]?.effect != null) || order[a.kind] - order[b.kind] || a.title.localeCompare(b.title));
    // Sorted on open and on search, not on every pick, so a row doesn't jump out from under the pointer.
  }, [all, q, open]);

  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 py-2.5 pr-4 pl-10 text-left text-[13px] text-ink-2 hover:text-ink sm:pl-[60px]">
        <ChevronRight size={12} className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
        Every action{all ? ` (${all.length})` : ""}
      </button>
      {open && (
        <div className="pr-4 pb-3 pl-10 sm:pl-[60px]">
          {!all ? (
            <div className="flex justify-center py-3 text-muted">{catalog ? <span className="text-[12px] text-faint">The list for {appName(app)} isn't available.</span> : <Spinner />}</div>
          ) : (
            <>
              <SearchBox value={q} onChange={(v) => (setQ(v), setShown(PAGE))} placeholder={`Search ${all.length} ${appName(app)} actions`} />
              <div className="mt-2 divide-y divide-[var(--border)] overflow-hidden rounded-xl bg-raised hairline">
                {list.slice(0, shown).map((a) => (
                  <div key={a.permission} className="flex items-center gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{a.title}</span>
                      <span className="block truncate text-[11px] text-muted">{KINDS.find((k) => k.kind === a.kind)!.label}</span>
                    </span>
                    <EffectPicker value={model.keys[a.permission]?.effect ?? null} inherited={effect(a.permission, a.permission)} onChange={(v) => set(a.permission, { effect: v })} />
                  </div>
                ))}
                {list.length === 0 && <div className="px-3 py-3 text-[12px] text-faint">Nothing matches “{q}”.</div>}
              </div>
              <LoadMore active={shown < list.length} onVisible={() => setShown((n) => n + PAGE)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
