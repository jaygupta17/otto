import { AnimatePresence, motion } from "motion/react";
import { Bot, ChevronRight, Lock, Plus, RotateCcw, Trash2, X, ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentInfo } from "@opencode/client";
import { useChat } from "../../state/chat";
import { AGENT_COLORS, agentColor } from "../../lib/agentColor";
import { useExtensions } from "../../state/extensions";
import type { AgentConfig } from "../../lib/opencode/config";
import { modelRefToString, modelStringToRef } from "../../lib/opencode/config";
import { TOOLS, inheritedEffect, parseRules, serializeRules, effectFor, type Effect, type PermissionModel } from "../../lib/permissions";
import { Button, IconButton } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Spinner } from "../ui/AgentClock";
import { DefaultMark, EffectPicker, Empty, Label, Row, Rows, SearchBox, Segmented, TextArea, Toggle } from "./common";
import { ModelSelect, type ModelValue } from "./ModelSelect";
import { TeammateEditor } from "./TeammateEditor";
import { useTeammates } from "../../state/teammates";
import { TeammateFace } from "../ui/TeammateFace";
import { CATALOG, hash, isOfferedAgent, listNames, STARTER_TEAM, type Teammate } from "../../lib/teammates";
import { HireGallery } from "./HireGallery";
import { MEMORY_TOOLS, isMemoryTool } from "../../lib/memory";
import { COMPOSIO_SERVER } from "../../lib/composio";
import { appEffect, KINDS, sample } from "../../lib/appPermissions";
import { useConnectors } from "../../state/connectors";
import { AppPermissions } from "./AppPermissions";

const MEMORY_ALL = "memory_*";

const NO_RULES: readonly { action: string; resource: string; effect: Effect }[] = [];
const BUILTIN = new Set(["build", "plan", "general", "explore", "compaction", "title", "summary"]);
const COLORS = AGENT_COLORS;

interface Draft {
  id: string;
  description: string;
  mode: "primary" | "subagent" | "all";
  model: ModelValue | null;
  system: string;
  color: string;
  steps: string;
  disabled: boolean;
  hidden: boolean;
  perms: PermissionModel;
}

type Origin = "builtin" | "custom" | "file";

export function AgentsTab({ compact }: { compact: boolean }) {
  const agents = useChat((s) => s.agents);
  const config = useExtensions((s) => s.config);
  const load = useExtensions((s) => s.load);
  const error = useExtensions((s) => s.error);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The hiring gallery: false when closed, null on the grid, an id on someone's profile.
  const [hiring, setHiring] = useState<string | null | false>(false);
  const [q, setQ] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const roster = useTeammates((s) => s.byId);
  const addStarters = useTeammates((s) => s.addStarters);
  const noTeammates = roster !== null && Object.keys(roster).length === 0;
  // Who this machine could still hire (new ones arrive with updates).
  const agentIds = useChat((s) => s.agents.map((a) => a.id).join(" "));
  const missing = useMemo(() => {
    const theirs = new Set(agentIds.split(" "));
    return roster ? CATALOG.filter((t) => !roster[t.id] && !theirs.has(t.id)) : [];
  }, [roster, agentIds]);
  const show = (next: { selected?: string | null; creating?: boolean; hiring?: string | null | false }) => {
    setSelected(next.selected ?? null);
    setCreating(next.creating ?? false);
    setHiring(next.hiring === undefined ? false : next.hiring);
  };
  const editorRef = useRef<HTMLDivElement>(null);

  // A different agent opens at its top, not wherever the last one was left.
  useEffect(() => {
    let el = editorRef.current?.parentElement;
    while (el && !/auto|scroll/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    if (el) el.scrollTop = 0;
  }, [selected, creating, hiring]);

  useEffect(() => {
    void load();
    const s = useExtensions.getState();
    if (!s.skills) void s.loadSkills();
    if (!s.mcp) void s.loadMcp();
  }, [load]);

  const cfgAgents = config?.agents ?? {};
  const team = useMemo(() => {
    const t = q.trim().toLowerCase();
    return Object.values(roster ?? {})
      .filter((m) => !t || `${m.id} ${m.name} ${m.job}`.toLowerCase().includes(t))
      .sort((a, b) => Number(b.leads) - Number(a.leads) || a.created - b.created || a.name.localeCompare(b.name));
  }, [roster, q]);
  const list = useMemo(() => {
    const ids = new Set([...agents.map((a) => a.id), ...Object.keys(cfgAgents)].filter((id) => !roster?.[id] && isOfferedAgent(id)));
    const t = q.trim().toLowerCase();
    return [...ids]
      .map((id) => ({ id, info: agents.find((a) => a.id === id), cfg: cfgAgents[id] }))
      .filter((a) => showHidden || !(a.info?.hidden ?? a.cfg?.hidden))
      .filter((a) => !t || `${a.id} ${a.info?.name ?? ""} ${a.info?.description ?? a.cfg?.description ?? ""}`.toLowerCase().includes(t))
      .sort((a, b) => rankMode(a.info?.mode ?? a.cfg?.mode) - rankMode(b.info?.mode ?? b.cfg?.mode) || a.id.localeCompare(b.id));
  }, [agents, cfgAgents, q, showHidden, roster]);

  useEffect(() => {
    if (selected || creating || hiring !== false || compact) return;
    const first = team[0]?.id ?? list[0]?.id;
    if (first) setSelected(first);
  }, [team, list, selected, creating, hiring, compact]);

  if (error) return <Empty icon={<Bot size={20} />} title="Couldn't read the server config" body={error} action={<Button onClick={() => load(true)}>Retry</Button>} />;
  if (!config)
    return (
      <div className="flex justify-center py-16 text-muted">
        <Spinner />
      </div>
    );

  const showList = !compact || (!selected && !creating && hiring === false);
  const showEditor = !compact || selected || creating || hiring !== false;

  return (
    <div className={`flex gap-5 ${compact ? "flex-col" : "min-h-[540px]"}`}>
      {showList && (
        <div className={compact ? "" : "w-[200px] shrink-0"}>
          <div className="mb-2 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <SearchBox value={q} onChange={setQ} placeholder="Find agent" />
            </div>
            <IconButton label="Hire a teammate" className="hairline" onClick={() => show({ hiring: null })}>
              <Plus size={16} />
            </IconButton>
          </div>
          {/* Phone layout has no editor pane to hold the offer, so it sits in the list. */}
          {compact && noTeammates && (
            <div className="mt-3">
              <MeetTheTeam onAdd={addStarters} onBrowse={() => show({ hiring: null })} compact />
            </div>
          )}
          {team.length > 0 && (
            <>
              <div className="mb-1 mt-3 px-2.5 text-[12px] font-medium text-faint">Teammates</div>
              <div className="space-y-0.5">
                {team.map((m) => (
                  <TeammateRow
                    key={m.id}
                    t={m}
                    disabled={!!cfgAgents[m.id]?.disabled}
                    active={selected === m.id && !creating && hiring === false}
                    onClick={() => show({ selected: m.id })}
                  />
                ))}
              </div>
              {missing.length > 0 && !q.trim() && (
                <button onClick={() => show({ hiring: null })} className={`mt-1 flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors ${hiring !== false ? "bg-active text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}>
                  <span className="flex shrink-0 -space-x-2">
                    {missing.slice(0, 3).map((t) => (
                      <TeammateFace key={t.id} seed={hash(t.id)} color={t.color} accessory={t.accessory} size={26} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">Hire</span>
                  <Plus size={14} className="shrink-0" />
                </button>
              )}
              <div className="mb-1 mt-4 px-2.5 text-[12px] font-medium text-faint">Agents</div>
            </>
          )}
          <div className="space-y-0.5">
            {list.map((a) => (
              <AgentRow
                key={a.id}
                id={a.id}
                info={a.info}
                cfg={a.cfg}
                active={selected === a.id && !creating && hiring === false}
                onClick={() => show({ selected: a.id })}
              />
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 px-2 text-[12px] text-muted">
            <Toggle on={showHidden} onChange={setShowHidden} label="Show internal agents" /> Show internal agents
          </label>
        </div>
      )}
      {showEditor && (
        <div ref={editorRef} className="min-w-0 flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={hiring !== false ? `hire:${hiring ?? ""}` : creating ? "new" : (selected ?? "none")} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.08 } }} transition={{ duration: 0.18 }}>
              {/* A profile in the gallery has its own way back. */}
              {compact && !hiring && (
                <button className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-muted" onClick={() => show({})}>
                  <ArrowLeft size={15} /> All agents
                </button>
              )}
              {hiring !== false ? (
                <HireGallery profile={hiring} onProfile={(id) => setHiring(id)} onCustom={() => show({ creating: true })} onEdit={(id) => show({ selected: id })} compact={compact} />
              ) : creating ? (
                <TeammateEditor
                  key="new"
                  onDone={(id) => {
                    setCreating(false);
                    setSelected(id);
                  }}
                />
              ) : selected && roster?.[selected] ? (
                <TeammateEditor key={`${selected}-${roster[selected].updated}`} teammate={roster[selected]} cfg={cfgAgents[selected]} onDone={(id) => setSelected(id)} />
              ) : selected ? (
                <AgentEditor key={selected} id={selected} info={agents.find((a) => a.id === selected)} cfg={cfgAgents[selected]} origin={originOf(selected, cfgAgents[selected], agents.find((a) => a.id === selected))} onDone={(id) => setSelected(id)} />
              ) : noTeammates ? (
                <MeetTheTeam onAdd={addStarters} onBrowse={() => show({ hiring: null })} compact={false} />
              ) : (
                <Empty icon={<Bot size={20} />} title="Pick a teammate" body="Teammates have a name, a job and standing instructions, and keep their own model and permissions." />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function rankMode(m?: string) {
  return m === "primary" ? 0 : m === "all" ? 1 : 2;
}

function originOf(id: string, cfg?: AgentConfig, info?: AgentInfo): Origin {
  if (BUILTIN.has(id)) return "builtin";
  if (cfg && (cfg.system !== undefined || cfg.description !== undefined || !info)) return "custom";
  return info ? "file" : "custom";
}

/** Otto's starter team, introduced by face before anyone is added. */
function MeetTheTeam({ onAdd, onBrowse, compact }: { onAdd: () => Promise<unknown>; onBrowse: () => void; compact: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className={compact ? "rounded-2xl border border-line p-4" : "mx-auto max-w-[520px] py-8"}>
      <h3 className={`font-semibold tracking-[-0.01em] ${compact ? "text-[15px]" : "text-[20px]"}`}>Meet Otto's team</h3>
      <p className="mt-1 text-[13px] text-muted">Each has a job, a way of working and a memory of their own. Add them to this machine, then change anything.</p>
      <ul className={`mt-4 grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
        {STARTER_TEAM.map((t) => (
          <li key={t.id} className="flex items-start gap-3 rounded-xl border border-line px-3 py-3">
            <TeammateFace seed={hash(t.id)} color={t.color} accessory={t.accessory} size={44} label={t.name} />
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-ink">
                {t.name} <span className="font-normal text-muted">· {t.job}</span>
              </div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{t.tagline}</div>
            </div>
          </li>
        ))}
      </ul>
      <Button
        variant="primary"
        className="mt-4"
        disabled={adding}
        onClick={async () => {
          setAdding(true);
          await onAdd();
          setAdding(false);
        }}
      >
        {adding ? <Spinner size={13} /> : `Add ${listNames(STARTER_TEAM.map((t) => t.name))}`}
      </Button>
      <Button variant="ghost" className="ml-1 mt-4" onClick={onBrowse}>
        Pick who to hire
      </Button>
    </div>
  );
}

function TeammateRow({ t, active, disabled, onClick }: { t: Teammate; active: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors ${active ? "bg-active" : "hover:bg-hover"}`}>
      <TeammateFace seed={t.face} color={t.color} accessory={t.accessory} size={26} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[13.5px] ${disabled ? "text-faint line-through" : "text-ink"}`}>{t.name}</span>
        {t.job && <span className="block truncate text-[12px] text-muted">{t.job}</span>}
      </span>
    </button>
  );
}

function AgentRow({ id, info, cfg, active, onClick }: { id: string; info?: AgentInfo; cfg?: AgentConfig; active: boolean; onClick: () => void }) {
  const disabled = cfg?.disabled;
  const color = cfg?.color ?? info?.color;
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${active ? "bg-active" : "hover:bg-hover"}`}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: agentColor(id, color) }} />
      <span className={`min-w-0 flex-1 truncate text-[13.5px] ${disabled ? "text-faint line-through" : "text-ink"}`}>{info?.name ?? id}</span>
      {(info?.mode ?? cfg?.mode) !== "primary" && <span className="shrink-0 text-[12px] text-faint">{modeLabel(info?.mode ?? cfg?.mode)}</span>}
    </button>
  );
}

function modeLabel(m?: string) {
  return m === "subagent" ? "Subagent" : m === "all" ? "Primary + sub" : "Primary";
}

function draftFrom(id: string, info?: AgentInfo, cfg?: AgentConfig): Draft {
  const model = modelStringToRef(cfg?.model) ?? (info?.model ? { providerID: info.model.providerID, id: info.model.id, variant: info.model.variant } : null);
  return {
    id,
    description: cfg?.description ?? info?.description ?? "",
    mode: cfg?.mode ?? info?.mode ?? "primary",
    model: cfg?.model ? model : null,
    system: cfg?.system ?? "",
    color: cfg?.color ?? (typeof info?.color === "string" ? info.color : "") ?? "",
    steps: cfg?.steps ? String(cfg.steps) : "",
    disabled: !!cfg?.disabled,
    hidden: cfg?.hidden ?? info?.hidden ?? false,
    perms: parseRules(cfg?.permissions ?? []),
  };
}

function AgentEditor({ id, info, cfg, origin, onDone }: { id: string; info?: AgentInfo; cfg?: AgentConfig; origin: Origin; onDone: (id: string) => void }) {
  const update = useExtensions((s) => s.update);
  const globalRules = useExtensions((s) => s.config?.permissions) ?? NO_RULES;
  const initial = useMemo(() => draftFrom(id, info, cfg), [id, info, cfg]);
  const [d, setD] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [section, setSection] = useState<"general" | "permissions">("general");
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const dirty = JSON.stringify({ ...d, perms: serializeRules(d.perms) }) !== JSON.stringify({ ...initial, perms: serializeRules(initial.perms) });
  const editableBasics = origin !== "file";

  async function save() {
    const agentId = id;
    setSaving(true);
    const ok = await update(
      (c) => {
        const agents = { ...(c.agents ?? {}) };
        const prev = agents[agentId] ?? {};
        const next: AgentConfig = { ...prev };
        const assign = <K extends keyof AgentConfig>(k: K, v: AgentConfig[K] | undefined) => {
          if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
          else next[k] = v;
        };
        // For built-ins only persist what the user actually changed.
        const changed = (k: keyof Draft) => origin === "custom" || JSON.stringify(d[k]) !== JSON.stringify(initial[k]);
        if (changed("description")) assign("description", d.description.trim() || undefined);
        if (changed("mode")) assign("mode", d.mode);
        if (changed("system")) assign("system", d.system.trim() ? d.system : undefined);
        if (changed("model")) assign("model", modelRefToString(d.model));
        if (changed("color")) assign("color", d.color || undefined);
        if (changed("steps")) assign("steps", d.steps ? Math.max(1, parseInt(d.steps, 10) || 0) || undefined : undefined);
        if (changed("hidden")) assign("hidden", d.hidden || undefined);
        assign("disabled", d.disabled || undefined);
        assign("permissions", serializeRules(d.perms));
        if (Object.keys(next).length === 0) delete agents[agentId];
        else agents[agentId] = next;
        return { ...c, agents };
      },
      { success: "Agent saved" },
    );
    setSaving(false);
    if (ok) onDone(agentId);
  }

  async function remove() {
    const ok = await update(
      (c) => {
        const agents = { ...(c.agents ?? {}) };
        delete agents[id];
        return { ...c, agents };
      },
      { success: origin === "builtin" ? "Reset to defaults" : "Agent deleted" },
    );
    if (ok) onDone(origin === "builtin" ? id : "");
  }

  return (
    <div className="relative pb-20">
      <div className="mb-5 flex items-start gap-3">

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.color || agentColor(id) }} />
            <h3 className="truncate text-[20px] font-semibold">{info?.name ?? id}</h3>
            {origin === "builtin" && <span className="rounded-full bg-sunken px-2 py-px text-[12px] font-medium text-muted">Built-in</span>}
            {origin === "file" && (
              <span className="flex items-center gap-1 rounded-full bg-sunken px-2 py-px text-[12px] font-medium text-muted">
                <Lock size={10} /> From file
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1 text-[12.5px] text-muted">
          Enabled <Toggle on={!d.disabled} onChange={(v) => set({ disabled: !v })} label="Enabled" />
        </div>

      </div>

      <div className="mb-5">
        <Segmented
          id="agent-section"
          value={section}
          onChange={setSection}
          options={[
            { id: "general", label: "General" },
            { id: "permissions", label: "Permissions" },
          ]}
        />
      </div>

      {section === "general" ? (
        <div className="space-y-5">
          {origin === "file" && <div className="rounded-xl bg-sunken px-3.5 py-2.5 text-[12.5px] text-muted">Defined in a file on the server. Its instructions are edited there.</div>}
          <div>
            <Label>Description</Label>
            <TextField placeholder="What it’s for" value={d.description} onChange={(e) => set({ description: e.target.value })} disabled={!editableBasics} />
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <Label>Model</Label>
              <ModelSelect value={d.model} onChange={(m) => set({ model: m })} inheritLabel="Use the session's model" />
            </div>
            <div>
              <Label>Available as</Label>
              <Segmented
                id="agent-mode"
                value={d.mode}
                onChange={(m) => set({ mode: m })}
                options={[
                  { id: "primary", label: "Agent" },
                  { id: "subagent", label: "Subagent" },
                  { id: "all", label: "Both" },
                ]}
              />
            </div>
          </div>
          {editableBasics && (
            <div>
              <Label hint={origin === "builtin" ? "Empty keeps the built-in prompt" : undefined}>Instructions</Label>
              <TextArea value={d.system} onChange={(v) => set({ system: v })} rows={8} placeholder="You are a meticulous code reviewer. Focus on correctness and security…" />
            </div>
          )}
          <div>
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" onClick={() => set({ color: c })} className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${d.color === c ? "ring-2 ring-[var(--text)] ring-offset-2 ring-offset-[var(--surface-solid)]" : ""}`} style={{ background: c }} aria-label={c} />
              ))}
            </div>
          </div>
          <Rows>
            <Row label="Max steps per turn">
              <input
                type="number"
                min={1}
                aria-label="Max steps per turn"
                placeholder="No limit"
                value={d.steps}
                onChange={(e) => set({ steps: e.target.value })}
                className="field h-8 w-[110px] rounded-lg px-2.5 text-right text-[13px] outline-none"
              />
            </Row>
            <Row label="Hide from the agent menu">
              <Toggle on={d.hidden} onChange={(v) => set({ hidden: v })} label="Hidden" />
            </Row>
          </Rows>
        </div>
      ) : (
        <PermissionsEditor model={d.perms} onChange={(perms) => set({ perms })} globalRules={globalRules} />
      )}

      {origin !== "file" && (
        <div className="mt-8 flex items-center justify-between rounded-2xl border border-line px-4 py-3">
          <div>
            <div className="text-[13.5px] font-medium">{origin === "builtin" ? "Reset to defaults" : "Delete agent"}</div>
            <div className="text-[12px] text-muted">{origin === "builtin" ? "Removes your overrides for this built-in agent." : "Removes it from the server config."}</div>
          </div>
          {confirmDelete ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" onClick={() => void remove()}>
                Confirm
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" icon={origin === "builtin" ? <RotateCcw size={13} /> : <Trash2 size={13} />} onClick={() => setConfirmDelete(true)}>
              {origin === "builtin" ? "Reset" : "Delete"}
            </Button>
          )}
        </div>
      )}

      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 500, damping: 36 }}
            className="surface-overlay bg-raised sticky bottom-3 z-10 mt-6 flex items-center gap-3 rounded-2xl border border-line px-4 py-2.5 shadow-pop"
          >
            <span className="flex-1 text-[13px] text-muted">Unsaved changes</span>
            <Button size="sm" variant="ghost" onClick={() => setD(initial)}>
              Discard
            </Button>
            <Button size="sm" variant="primary" disabled={saving} onClick={() => void save()}>
              {saving ? <Spinner size={13} /> : "Save"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export function PermissionsEditor({ model, onChange, globalRules }: { model: PermissionModel; onChange: (m: PermissionModel) => void; globalRules: readonly { action: string; resource: string; effect: Effect }[] }) {
  const skills = useExtensions((s) => s.skills);
  const mcp = useExtensions((s) => s.mcp);
  const mcpConfig = useExtensions((s) => s.config?.mcp?.servers);
  const hasApps = useConnectors((s) => !!s.key);

  const setKey = (action: string, effect: Effect | null) => {
    const keys = { ...model.keys };
    const cur = keys[action] ?? { effect: null, patterns: [] };
    if (effect === null && cur.patterns.length === 0) delete keys[action];
    else keys[action] = { ...cur, effect };
    onChange({ ...model, keys });
  };
  const setPatterns = (action: string, patterns: { pattern: string; effect: Effect }[]) => {
    const keys = { ...model.keys };
    const cur = keys[action] ?? { effect: null, patterns: [] };
    if (cur.effect === null && patterns.length === 0) delete keys[action];
    else keys[action] = { ...cur, patterns };
    onChange({ ...model, keys });
  };
  const inherited = (action: string) => inheritedEffect(action, { global: globalRules, agentGlobal: model.global });

  // Last rule wins, so "All memory tools" must come before the per-tool rows.
  // Re-emit every memory row from the keys, in that order, on each change.
  const setMemoryKey = (action: string, effect: Effect | null) => {
    const cur = model.keys[action] ?? { effect: null, patterns: [] };
    const keys = { ...model.keys, [action]: { ...cur, effect } };
    if (effect === null && cur.patterns.length === 0) delete keys[action];
    const isMem = (a: string) => a === MEMORY_ALL || isMemoryTool(a);
    const rest = Object.entries(keys).filter(([a]) => !isMem(a));
    const mem = Object.entries(keys).filter(([a]) => isMem(a)).sort(([a], [b]) => Number(b === MEMORY_ALL) - Number(a === MEMORY_ALL));
    onChange({ ...model, keys: Object.fromEntries([...rest, ...mem]), source: model.source.filter((r) => !(isMem(r.action) && r.resource === "*")) });
  };
  const memoryAll = model.keys[MEMORY_ALL]?.effect ?? null;

  // Apps have their own section; a machine set up before the plugin may still list the old server until it's swapped.
  const mcpNames = useMemo(() => [...new Set([...(mcp ?? []).map((m) => m.name), ...Object.keys(mcpConfig ?? {})])].filter((n) => n !== COMPOSIO_SERVER), [mcp, mcpConfig]);
  const appRules = useMemo(() => (hasApps ? serializeRules(model) : []), [hasApps, model]);
  const presets: { id: string; label: string; apply: () => void }[] = [
    { id: "full", label: "Full access", apply: () => onChange({ ...model, global: "allow", keys: {} }) },
    {
      id: "careful",
      label: "Ask before changes",
      apply: () =>
        onChange({
          ...model,
          global: null,
          keys: { ...model.keys, shell: { effect: "ask", patterns: [] }, edit: { effect: "ask", patterns: [] }, webfetch: { effect: "ask", patterns: [] } },
        }),
    },
    {
      id: "readonly",
      label: "Read-only",
      apply: () =>
        onChange({
          ...model,
          global: null,
          keys: { ...model.keys, shell: { effect: "deny", patterns: [] }, edit: { effect: "deny", patterns: [] }, external_directory: { effect: "deny", patterns: [] } },
        }),
    },
  ];

  return (
    <div className="space-y-7">
      <div className="rounded-2xl bg-raised p-4 hairline">
        <Summary effect={(a) => (a.startsWith("composio.") ? appEffect(a, { global: globalRules, agent: appRules }) : (model.keys[a]?.effect ?? inherited(a)))} apps={hasApps} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <div>
            <div className="text-[13.5px] font-medium">Everything else</div>
            <div className="text-[12.5px] text-muted">Anything without its own choice below</div>
          </div>
          <EffectPicker value={model.global} inherited={inheritedEffect("*", { global: globalRules, agentGlobal: null })} onChange={(v) => onChange({ ...model, global: v })} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
          <span className="mr-1 self-center text-[12.5px] text-muted">Presets</span>
          {presets.map((p) => (
            <button key={p.id} type="button" onClick={p.apply} className="rounded-full px-2.5 py-1 text-[12.5px] text-ink-2 hairline transition-colors hover:bg-hover hover:text-ink">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <PermGroup title="Tools">
        {TOOLS.map((t) => (
          <PermRow
            key={t.action}
            title={t.label}
            subtitle={t.hint}
            code={t.action}
            value={model.keys[t.action]?.effect ?? null}
            inherited={inherited(t.action)}
            onChange={(v) => setKey(t.action, v)}
            patterns={model.keys[t.action]?.patterns ?? []}
            onPatterns={(p) => setPatterns(t.action, p)}
            example={t.example}
          />
        ))}
      </PermGroup>

      <PermGroup title="Skills">
        <PermRow title="All skills" code="skill" value={model.keys.skill?.effect ?? null} inherited={inherited("skill")} onChange={(v) => setKey("skill", v)} />
        {skills === null ? (
          <div className="flex justify-center py-3 text-muted">
            <Spinner />
          </div>
        ) : skills.length === 0 ? (
          <div className="px-4 py-3 text-[12.5px] text-faint">No skills installed.</div>
        ) : (
          skills.map((s) => {
            const pat = model.keys.skill?.patterns.find((p) => p.pattern === s.id);
            const fallback = model.keys.skill?.effect ?? effectFor("skill", s.id, [...globalRules, ...(model.global ? [{ action: "*", resource: "*", effect: model.global }] : [])]);
            return (
              <PermRow
                key={s.id}
                indent
                title={s.name}
                subtitle={s.description}
                value={pat?.effect ?? null}
                inherited={fallback}
                onChange={(v) => {
                  const others = (model.keys.skill?.patterns ?? []).filter((p) => p.pattern !== s.id);
                  setPatterns("skill", v ? [...others, { pattern: s.id, effect: v }] : others);
                }}
              />
            );
          })
        )}
      </PermGroup>

      <PermGroup title="Memory">
        <PermRow noAsk title="All memory tools" subtitle="Saving and recalling across sessions. Teammates never stop to ask, so it is on or off." code={MEMORY_ALL} value={memoryAll} inherited={inherited(MEMORY_ALL)} onChange={(v) => setMemoryKey(MEMORY_ALL, v)} />
        {MEMORY_TOOLS.map((t) => (
          <PermRow
            key={t.action}
            noAsk
            indent
            title={t.label}
            subtitle={t.hint ?? t.action}
            code={t.action}
            value={model.keys[t.action]?.effect ?? null}
            inherited={memoryAll ?? inherited(t.action)}
            onChange={(v) => setMemoryKey(t.action, v)}
          />
        ))}
      </PermGroup>

      <AppPermissions model={model} onChange={onChange} globalRules={globalRules} />

      <PermGroup title="MCP servers">
        {mcp === null ? (
          <div className="flex justify-center py-3 text-muted">
            <Spinner />
          </div>
        ) : mcpNames.length === 0 ? (
          <div className="px-4 py-3 text-[12.5px] text-faint">No MCP servers configured.</div>
        ) : (
          mcpNames.map((name) => {
            const action = `${name}_*`;
            const st = mcp.find((m) => m.name === name)?.status.status;
            return <PermRow key={name} title={name} subtitle={st && st !== "connected" ? st.replace("_", " ") : undefined} code={action} value={model.keys[action]?.effect ?? null} inherited={inherited(action)} onChange={(v) => setKey(action, v)} />;
          })
        )}
      </PermGroup>
    </div>
  );
}

/** The things people care about, in the words they'd use. */
const CAPABILITIES: { action: string; verb: string }[] = [
  { action: "shell", verb: "run commands" },
  { action: "edit", verb: "edit files" },
  { action: "webfetch", verb: "open web pages" },
  { action: "websearch", verb: "search the web" },
  { action: "subagent", verb: "hand work to other agents" },
  { action: "external_directory", verb: "work outside the project" },
];

const joinList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** What this agent will actually do, in three plain lines: free, asks first, can't. */
function Summary({ effect, apps }: { effect: (action: string) => Effect; apps: boolean }) {
  const caps = [...CAPABILITIES, ...(apps ? KINDS.map((k) => ({ action: sample("*", k.kind), verb: `${k.verb} in your apps` })) : [])];
  const by = (e: Effect) => caps.filter((c) => effect(c.action) === e).map((c) => c.verb);
  const lines: { tone: string; text: string }[] = [];
  const free = by("allow");
  const asks = by("ask");
  const never = by("deny");
  if (free.length) lines.push({ tone: "bg-ok", text: asks.length || never.length ? `Free to ${joinList(free)}` : `Free to do anything: ${joinList(free)}` });
  if (asks.length) lines.push({ tone: "bg-warn", text: `Asks you first to ${joinList(asks)}` });
  if (never.length) lines.push({ tone: "bg-danger", text: `Never allowed to ${joinList(never)}` });
  return (
    <div>
      <div className="text-[13.5px] font-medium text-ink">What this agent can do</div>
      <ul className="mt-2 space-y-1.5">
        {lines.map((l) => (
          <li key={l.tone} className="flex items-start gap-2.5 text-[13px] leading-snug text-ink-2">
            <span className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${l.tone}`} />
            {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PermGroup({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[14px] font-semibold">{title}</div>
      {note && <div className="-mt-1 mb-2 text-[12.5px] text-muted">{note}</div>}
      <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl bg-raised hairline">{children}</div>
    </div>
  );
}

function PermRow({
  noAsk,
  title,
  subtitle,
  code,
  value,
  inherited,
  onChange,
  patterns,
  onPatterns,
  example,
  indent,
}: {
  title: string;
  subtitle?: string;
  code?: string;
  value: Effect | null;
  inherited: Effect;
  onChange: (v: Effect | null) => void;
  patterns?: { pattern: string; effect: Effect }[];
  onPatterns?: (p: { pattern: string; effect: Effect }[]) => void;
  example?: string;
  indent?: boolean;
  noAsk?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const canPattern = !!onPatterns;
  return (
    <div className={indent ? "pl-5" : ""}>
      <div className="flex items-center gap-3 px-4 py-2.5">
        {/* Not a <button>: Reset sits inside it. */}
        <div
          role={canPattern ? "button" : undefined}
          tabIndex={canPattern ? 0 : undefined}
          aria-expanded={canPattern ? open : undefined}
          onClick={() => canPattern && setOpen((v) => !v)}
          onKeyDown={(e) => canPattern && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setOpen((v) => !v))}
          className={`flex min-w-0 flex-1 items-center gap-2 text-left ${canPattern ? "cursor-pointer" : ""}`}
        >
          {canPattern && <ChevronRight size={13} className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />}
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[13.5px] text-ink">
              <span className="truncate">{title}</span>
              {patterns && patterns.length > 0 && <span className="rounded-md bg-active px-1.5 text-[12px] font-medium text-ink">{patterns.length} rule{patterns.length === 1 ? "" : "s"}</span>}
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
              {subtitle && <span className="truncate">{subtitle}</span>}
              {subtitle && <span className="text-faint">·</span>}
              <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <DefaultMark verbose own={value !== null} fallback={noAsk && inherited === "ask" ? "allow" : inherited} onReset={() => onChange(null)} />
              </span>
            </span>
          </span>
        </div>
        <EffectPicker value={value} inherited={inherited} onChange={onChange} noAsk={noAsk} marker={false} />
      </div>
      <AnimatePresence initial={false}>
        {open && canPattern && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
            <div className="space-y-1.5 bg-sunken/60 px-4 py-3 pl-10">
              <div className="text-[12.5px] text-muted">Specific {code === "shell" ? "commands" : code === "webfetch" ? "URLs" : "paths"}. Later rules win.</div>
              {patterns!.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <code className="field min-w-0 flex-1 truncate rounded-lg px-2.5 py-1.5 font-mono text-[12px]">{p.pattern}</code>
                  <EffectPicker allowInherit={false} value={p.effect} onChange={(v) => v && onPatterns!(patterns!.map((x, j) => (j === i ? { ...x, effect: v } : x)))} />
                  <IconButton label="Remove rule" size={26} onClick={() => onPatterns!(patterns!.filter((_, j) => j !== i))}>
                    <X size={13} />
                  </IconButton>
                </div>
              ))}
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = draft.trim();
                  if (!v) return;
                  onPatterns!([...patterns!, { pattern: v, effect: "ask" }]);
                  setDraft("");
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={example ? `e.g. ${example}` : "pattern"}
                  className="field h-8 min-w-0 flex-1 rounded-lg px-2.5 font-mono text-[12px] outline-none"
                />
                <Button size="sm" type="submit" disabled={!draft.trim()} icon={<Plus size={13} />}>
                  Add
                </Button>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
