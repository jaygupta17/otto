import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Dices, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useChat } from "../../state/chat";
import { useExtensions } from "../../state/extensions";
import { useTeammates } from "../../state/teammates";
import type { AgentConfig } from "../../lib/opencode/config";
import { modelRefToString, modelStringToRef } from "../../lib/opencode/config";
import { parseRules, serializeRules, type PermissionModel } from "../../lib/permissions";
import { ACCESSORIES, MAX_STARTERS, randomFace, TEAMMATE_COLORS, teammatePrompt, uniqueId, type Accessory, type Teammate } from "../../lib/teammates";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Spinner } from "../ui/AgentClock";
import { TeammateFace, type FaceState } from "../ui/TeammateFace";
import { Label, Row, Rows, Segmented, TextArea, Toggle } from "./common";
import { ModelSelect, type ModelValue } from "./ModelSelect";
import { PermissionsEditor } from "./AgentsTab";

const NO_RULES: readonly never[] = [];
const FACE_STATES: { id: FaceState; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "working", label: "Working" },
  { id: "needs", label: "Needs you" },
  { id: "done", label: "Done" },
];

interface Draft {
  name: string;
  job: string;
  instructions: string;
  color: string;
  face: number;
  accessory: Accessory;
  tagline: string;
  greeting: string;
  voice: string;
  /** Always MAX_STARTERS slots; empty ones are dropped on save. */
  starters: string[];
  leads: boolean;
  model: ModelValue | null;
  steps: string;
  disabled: boolean;
  perms: PermissionModel;
}

function draftOf(t?: Teammate, cfg?: AgentConfig): Draft {
  return {
    name: t?.name ?? "",
    job: t?.job ?? "",
    instructions: t?.instructions ?? "",
    color: t?.color ?? TEAMMATE_COLORS[Math.floor(Math.random() * TEAMMATE_COLORS.length)],
    face: t?.face ?? randomFace(),
    accessory: t?.accessory ?? "none",
    tagline: t?.tagline ?? "",
    greeting: t?.greeting ?? "",
    voice: t?.voice ?? "",
    starters: Array.from({ length: MAX_STARTERS }, (_, i) => t?.starters[i] ?? ""),
    leads: t?.leads ?? false,
    model: modelStringToRef(cfg?.model),
    steps: cfg?.steps ? String(cfg.steps) : "",
    disabled: !!cfg?.disabled,
    perms: parseRules(cfg?.permissions ?? []),
  };
}

const same = (a: Draft, b: Draft) => JSON.stringify({ ...a, perms: serializeRules(a.perms) }) === JSON.stringify({ ...b, perms: serializeRules(b.perms) });

export function TeammateEditor({ teammate, cfg, onDone }: { teammate?: Teammate; cfg?: AgentConfig; onDone: (id: string | null) => void }) {
  const isNew = !teammate;
  const save = useTeammates((s) => s.save);
  const remove = useTeammates((s) => s.remove);
  const globalRules = useExtensions((s) => s.config?.permissions) ?? NO_RULES;
  const initial = useMemo(() => draftOf(teammate, cfg), [teammate, cfg]);
  const [d, setD] = useState<Draft>(initial);
  const [section, setSection] = useState<"general" | "personality" | "permissions">("general");
  const [preview, setPreview] = useState<FaceState>("idle");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const name = d.name.trim();
  const id = useMemo(() => {
    if (teammate) return teammate.id;
    const s = useChat.getState();
    const roster = useTeammates.getState().byId ?? {};
    const cfgAgents = useExtensions.getState().config?.agents ?? {};
    return uniqueId(name, (x) => !!roster[x] || !!cfgAgents[x] || s.agents.some((a) => a.id === x));
  }, [teammate, name]);
  const dirty = isNew || !same(d, initial);
  const nameError = !name && d.name.length > 0 ? "Give them a name." : null;

  async function submit() {
    if (!name) return;
    setSaving(true);
    const ok = await save(
      { id, name, job: d.job.trim(), instructions: d.instructions.trim(), color: d.color, face: d.face, accessory: d.accessory, tagline: d.tagline.trim(), greeting: d.greeting.trim(), voice: d.voice.trim(), starters: d.starters.map((x) => x.trim()).filter(Boolean), leads: d.leads },
      {
        model: modelRefToString(d.model) ?? null,
        steps: d.steps ? Math.max(1, parseInt(d.steps, 10) || 0) || null : null,
        disabled: d.disabled || null,
        permissions: serializeRules(d.perms),
      },
      { isNew },
    );
    setSaving(false);
    if (ok) onDone(id);
  }

  return (
    <div className="relative pb-20">
      <div className="mb-6 flex items-center gap-4">
        <TeammateFace seed={d.face} color={d.color} accessory={d.accessory} size={72} state={preview} follow interactive label={name || "New teammate"} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[20px] font-semibold">{name || "New teammate"}</h3>
          <div className="truncate text-[13px] text-muted">{d.tagline.trim() || d.job.trim() || "No job yet"}</div>
          <div className="mt-2 flex flex-wrap items-center gap-1">
            {FACE_STATES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setPreview(s.id)}
                className={`rounded-md px-2 py-0.5 text-[12px] transition-colors ${preview === s.id ? "bg-active text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {!isNew && (
          <div className="flex shrink-0 items-center gap-2 self-start pt-1 text-[12.5px] text-muted">
            Enabled <Toggle on={!d.disabled} onChange={(v) => set({ disabled: !v })} label="Enabled" />
          </div>
        )}
      </div>

      <div className="mb-5">
        <Segmented
          id="teammate-section"
          value={section}
          onChange={setSection}
          options={[
            { id: "general", label: "General" },
            { id: "personality", label: "Personality" },
            { id: "permissions", label: "Permissions" },
          ]}
        />
      </div>

      {section === "general" ? (
        <div className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <TextField label="Name" autoFocus={isNew} placeholder="Piper" maxLength={40} value={d.name} onChange={(e) => set({ name: e.target.value })} error={nameError} hint={name ? <span className="font-mono">@{id}</span> : undefined} />
            <TextField label="Job" placeholder="Product performance" maxLength={80} value={d.job} onChange={(e) => set({ job: e.target.value })} />
          </div>
          <div>
            <Label>Look</Label>
            <div className="flex flex-wrap items-center gap-2">
              {TEAMMATE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set({ color: c })}
                  aria-label={`Colour ${c}`}
                  aria-pressed={d.color === c}
                  className={`h-7 w-7 rounded-full transition-transform hover:scale-110 ${d.color === c ? "ring-2 ring-[var(--text)] ring-offset-2 ring-offset-[var(--surface-solid)]" : ""}`}
                  style={{ background: c }}
                />
              ))}
              <span className="mx-1 h-5 w-px bg-[var(--border)]" />
              <Button size="sm" variant="secondary" icon={<Dices size={13} />} onClick={() => set({ face: randomFace() })}>
                New face
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Accessory">
              {ACCESSORIES.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={d.accessory === a}
                  title={a === "none" ? "Nothing" : a[0].toUpperCase() + a.slice(1)}
                  onClick={() => set({ accessory: a })}
                  className={`grid h-11 w-11 place-items-center rounded-xl transition-colors ${d.accessory === a ? "bg-active ring-1 ring-[var(--border-strong)]" : "hover:bg-hover"}`}
                >
                  <TeammateFace seed={d.face} color={d.color} accessory={a} size={30} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label hint="Applies to every conversation">Standing instructions</Label>
            <TextArea
              value={d.instructions}
              onChange={(v) => set({ instructions: v })}
              rows={7}
              placeholder={"Watch checkout and API performance. When something regresses, find the change that caused it and say how sure you are.\nKeep reports short: what changed, the impact, what to do."}
            />
            <button type="button" onClick={() => setShowPrompt((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink" aria-expanded={showPrompt}>
              <ChevronRight size={13} className={`transition-transform duration-150 ${showPrompt ? "rotate-90" : ""}`} />
              What {name || "they"} {name ? "is" : "are"} told
            </button>
            <AnimatePresence initial={false}>
              {showPrompt && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                  <pre className="scroll-quiet mt-2 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg bg-sunken px-3.5 py-3 font-mono text-[12px] leading-relaxed text-ink-2">
                    {teammatePrompt({ id: id || "teammate", name: name || "your teammate", job: d.job, instructions: d.instructions, tagline: d.tagline, voice: d.voice, leads: d.leads })}
                  </pre>
                  <p className="mt-1.5 text-[12px] text-faint">Otto writes this as the agent's prompt on your machine. Project instructions (AGENTS.md) still apply on top.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <div>
            <Label>Model</Label>
            <ModelSelect value={d.model} onChange={(m) => set({ model: m })} inheritLabel="Use the session's model" />
          </div>
          <Rows>
            <Row label="Leads the team" hint="Splits requests up and hands the parts to your other teammates. Nobody hands work to a lead.">
              <Toggle on={d.leads} onChange={(v) => set({ leads: v })} label="Leads the team" />
            </Row>
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
          </Rows>
        </div>
      ) : section === "personality" ? (
        <div className="space-y-5">
          <TextField label="Tagline" placeholder="Watches your product's vital signs and tells you what moved." maxLength={120} value={d.tagline} onChange={(e) => set({ tagline: e.target.value })} hint="One line on what they do for you" />
          <TextField label="Greeting" placeholder="What should I keep an eye on?" maxLength={80} value={d.greeting} onChange={(e) => set({ greeting: e.target.value })} hint="Shown when you start a conversation with them" />
          <div>
            <Label hint="Tone, habits, what they won't do">Voice</Label>
            <TextArea value={d.voice} onChange={(v) => set({ voice: v })} rows={4} placeholder="Calm and exact. Lead with the number and what changed, then why. Say how sure you are." />
          </div>
          <div>
            <Label hint="Offered on a new conversation">Things to ask {name || "them"}</Label>
            <div className="space-y-2">
              {d.starters.map((x, i) => (
                <input
                  key={i}
                  value={x}
                  maxLength={100}
                  aria-label={`Starter ${i + 1}`}
                  placeholder={["Why did checkout conversion drop this week?", "Brief me on yesterday's numbers", "Compare latency before and after the deploy", "Which endpoints got slower?"][i]}
                  onChange={(e) => set({ starters: d.starters.map((y, j) => (j === i ? e.target.value : y)) })}
                  className="field h-9 w-full rounded-lg px-3 text-[14px] outline-none placeholder:text-faint"
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <PermissionsEditor model={d.perms} onChange={(perms) => set({ perms })} globalRules={globalRules} />
      )}

      {!isNew && (
        <div className="mt-8 flex items-center justify-between gap-4 rounded-2xl border border-line px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium">Remove {teammate.name}</div>
            <div className="text-[12px] text-muted">Their past conversations stay.</div>
          </div>
          {confirmDelete ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={async () => {
                  if (await remove(teammate.id)) onDone(null);
                }}
              >
                Remove
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)}>
              Remove
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
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="surface-overlay bg-raised sticky bottom-3 z-10 mt-6 flex items-center gap-3 rounded-2xl border border-line px-4 py-2.5 shadow-pop"
          >
            <span className="flex-1 text-[13px] text-muted">{isNew ? "New teammate" : "Unsaved changes"}</span>
            {!isNew && (
              <Button size="sm" variant="ghost" onClick={() => setD(initial)}>
                Discard
              </Button>
            )}
            <Button size="sm" variant="primary" disabled={saving || !name} onClick={() => void submit()}>
              {saving ? <Spinner size={13} /> : isNew ? "Add teammate" : "Save"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
