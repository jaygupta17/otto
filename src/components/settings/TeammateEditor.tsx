import { AnimatePresence, motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useChat } from "../../state/chat";
import { useExtensions } from "../../state/extensions";
import { useTeammates } from "../../state/teammates";
import type { AgentConfig } from "../../lib/opencode/config";
import { modelRefToString, modelStringToRef } from "../../lib/opencode/config";
import { parseRules, serializeRules, type PermissionModel } from "../../lib/permissions";
import { EVERYDAY_BIRDS, MAX_STARTERS, randomFace, TEAMMATE_COLORS, teammatePrompt, uniqueId, type Teammate } from "../../lib/teammates";
import { BIRDS, type BirdId } from "../../lib/flock/birds";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { Bird } from "../ui/Bird";
import type { Mood } from "../../lib/flock/build";
import { FormRow, formInput, Row, Section, Segmented, TextArea, Toggle } from "./common";
import { ModelSelect, type ModelValue } from "./ModelSelect";
import { PermissionsEditor } from "./AgentsTab";

const NO_RULES: readonly never[] = [];
/** Every face a teammate makes, in the order a run goes through them, then the ones you cause. */
const FACES: { id: Mood; label: string }[] = [
  { id: "idle", label: "Idle" },
  { id: "sleep", label: "Napping" },
  { id: "think", label: "Working" },
  { id: "idea", label: "Got an idea" },
  { id: "type", label: "Writing" },
  { id: "huh", label: "Needs you" },
  { id: "love", label: "Thanks for answering" },
  { id: "brr", label: "Retrying" },
  { id: "cool", label: "Back on track" },
  { id: "happy", label: "Done" },
  { id: "party", label: "Finished" },
  { id: "wow", label: "Hit a snag" },
  { id: "error", label: "Didn't finish" },
  { id: "sad", label: "Stopped" },
  { id: "wink", label: "Wink" },
  { id: "angry", label: "Poked too much" },
];

interface Draft {
  name: string;
  job: string;
  instructions: string;
  color: string;
  face: number;
  bird: BirdId;
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
    bird: t?.bird ?? EVERYDAY_BIRDS[Math.floor(Math.random() * EVERYDAY_BIRDS.length)],
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

/** `actions` sit under the name (a phone puts "New session" there). */
export function TeammateEditor({ teammate, cfg, onDone, actions }: { teammate?: Teammate; cfg?: AgentConfig; onDone: (id: string | null) => void; actions?: ReactNode }) {
  const isNew = !teammate;
  const save = useTeammates((s) => s.save);
  const remove = useTeammates((s) => s.remove);
  const globalRules = useExtensions((s) => s.config?.permissions) ?? NO_RULES;
  const initial = useMemo(() => draftOf(teammate, cfg), [teammate, cfg]);
  const [d, setD] = useState<Draft>(initial);
  const [section, setSection] = useState<"general" | "personality" | "permissions">("general");
  const [preview, setPreview] = useState<Mood>("idle");
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
      { id, name, job: d.job.trim(), instructions: d.instructions.trim(), color: d.color, face: d.face, bird: d.bird, tagline: d.tagline.trim(), greeting: d.greeting.trim(), voice: d.voice.trim(), starters: d.starters.map((x) => x.trim()).filter(Boolean), leads: d.leads },
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

  const nextPreview = () => setPreview((p) => FACES[(FACES.findIndex((x) => x.id === p) + 1) % FACES.length].id);
  const previewLabel = FACES.find((x) => x.id === preview)!.label;

  return (
    <div className="relative pb-20">
      {/* A profile, not a form: the face, who they are, then what you can do with them. */}
      <div className="mb-7 flex items-center gap-5 max-sm:flex-col max-sm:gap-3 max-sm:text-center">
        <button type="button" onClick={nextPreview} aria-label={`Preview their face: ${previewLabel}. Tap for the next one`} data-tip={`Preview: ${previewLabel}`} className="shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]">
          <Bird bird={d.bird} seed={d.face} size={88} mood={preview} follow label={name || "New teammate"} />
        </button>
        <div className="min-w-0 flex-1 max-sm:w-full">
          <h3 className="truncate text-[22px] font-semibold tracking-[-0.01em]">{name || "New teammate"}</h3>
          <p className="mt-0.5 line-clamp-2 text-[14px] leading-snug text-muted">{d.tagline.trim() || d.job.trim() || "Give them a job below."}</p>
          {actions && <div className="mt-4 flex gap-2 max-sm:justify-center">{actions}</div>}
        </div>
      </div>

      <div className="mb-7">
        <Segmented
          stretch
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
        <>
          <Section title="Profile">
            <div className="group-card divide-y divide-[var(--border)] overflow-hidden">
              <FormRow label="Name" htmlFor="tm-name" aside={name ? <span className="font-mono">@{id}</span> : undefined} error={nameError}>
                <input id="tm-name" autoFocus={isNew} placeholder="Piper" maxLength={40} value={d.name} onChange={(e) => set({ name: e.target.value })} aria-invalid={!!nameError || undefined} className={formInput} />
              </FormRow>
              <FormRow label="Job" htmlFor="tm-job">
                <input id="tm-job" placeholder="Product performance" maxLength={80} value={d.job} onChange={(e) => set({ job: e.target.value })} className={formInput} />
              </FormRow>
            </div>
          </Section>

          <Section title="Bird">
            <div className="group-card grid grid-cols-4 gap-1 p-2" role="radiogroup" aria-label="Bird">
              {BIRDS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={d.bird === b.id}
                  aria-label={`${b.name}, ${b.species.toLowerCase()}`}
                  data-tip={b.species}
                  onClick={() => set({ bird: b.id })}
                  className={`flex flex-col items-center gap-1 rounded-xl pt-2.5 pb-2 transition-colors ${d.bird === b.id ? "chip" : "hover:bg-hover"}`}
                >
                  <Bird bird={b.id} seed={d.face} size={40} greet={false} />
                  <span className={`text-[12px] ${d.bird === b.id ? "text-ink" : "text-muted"}`}>{b.name}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Standing instructions" desc="Applies to every conversation, on top of the project's AGENTS.md.">
            <TextArea
              value={d.instructions}
              onChange={(v) => set({ instructions: v })}
              rows={6}
              placeholder={"Watch checkout and API performance. When something regresses, find the change that caused it and say how sure you are.\nKeep reports short: what changed, the impact, what to do."}
            />
            <button type="button" onClick={() => setShowPrompt((v) => !v)} className="mt-2.5 inline-flex items-center gap-1 px-1 text-[12px] text-muted hover:text-ink max-sm:text-[13px]" aria-expanded={showPrompt}>
              <ChevronRight size={13} className={`transition-transform duration-150 ${showPrompt ? "rotate-90" : ""}`} />
              What {name || "they"} {name ? "is" : "are"} told
            </button>
            <AnimatePresence initial={false}>
              {showPrompt && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
                  <pre className="scroll-quiet group-card mt-2 max-h-[320px] overflow-auto px-3.5 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">
                    {teammatePrompt({ id: id || "teammate", name: name || "your teammate", job: d.job, instructions: d.instructions, tagline: d.tagline, voice: d.voice, leads: d.leads })}
                  </pre>
                </motion.div>
              )}
            </AnimatePresence>
          </Section>

          <Section title="Work">
            <div className="group-card divide-y divide-[var(--border)]">
              <FormRow label="Model">
                <div className="pt-1 pb-1.5">
                  <ModelSelect value={d.model} onChange={(m) => set({ model: m })} inheritLabel="Use the session's model" />
                </div>
              </FormRow>
              <Row label="Leads the team" hint="Splits requests and hands the parts to your other teammates">
                <Toggle on={d.leads} onChange={(v) => set({ leads: v })} label="Leads the team" />
              </Row>
              <Row label="Max steps per turn" htmlFor="tm-steps">
                <input id="tm-steps" type="number" min={1} placeholder="No limit" value={d.steps} onChange={(e) => set({ steps: e.target.value })} className="field h-8 w-[110px] rounded-lg px-2.5 text-right text-[13px] outline-none max-sm:h-9 max-sm:text-[16px]" />
              </Row>
              {!isNew && (
                <Row label="Enabled" hint="Off hides them from the team and the agent picker">
                  <Toggle on={!d.disabled} onChange={(v) => set({ disabled: !v })} label="Enabled" />
                </Row>
              )}
            </div>
          </Section>

          {!isNew && (
            <div className="group-card overflow-hidden">
              {confirmDelete ? (
                <div className="p-4">
                  <p className="text-[13px] text-muted max-sm:text-[14px]">Remove {teammate.name}? Their past conversations stay.</p>
                  <div className="mt-3 flex gap-2">
                    <Button variant="secondary" className="max-sm:h-11 max-sm:flex-1 max-sm:text-[15px]" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="danger"
                      className="max-sm:h-11 max-sm:flex-1 max-sm:text-[15px]"
                      onClick={async () => {
                        if (await remove(teammate.id)) onDone(null);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(true)} className="flex min-h-[48px] w-full items-center justify-center text-[13px] font-medium text-danger transition-colors hover:bg-hover active:bg-active max-sm:text-[15px]">
                  Remove {teammate.name}
                </button>
              )}
            </div>
          )}
        </>
      ) : section === "personality" ? (
        <>
          <Section title="Introduction">
            <div className="group-card divide-y divide-[var(--border)] overflow-hidden">
              <FormRow label="Tagline" hint="One line on what they do for you" htmlFor="tm-tagline">
                <Grow id="tm-tagline" placeholder="Watches your product's vital signs." maxLength={120} value={d.tagline} onChange={(v) => set({ tagline: v })} />
              </FormRow>
              <FormRow label="Greeting" hint="Shown when you start a conversation with them" htmlFor="tm-greeting">
                <input id="tm-greeting" placeholder="What should I keep an eye on?" maxLength={80} value={d.greeting} onChange={(e) => set({ greeting: e.target.value })} className={formInput} />
              </FormRow>
            </div>
          </Section>
          <Section title="Voice" desc="Tone, habits, what they won't do.">
            <TextArea value={d.voice} onChange={(v) => set({ voice: v })} rows={4} placeholder="Calm and exact. Lead with the number and what changed, then why. Say how sure you are." />
          </Section>
          <Section title={`Things to ask ${name || "them"}`} desc="Offered when you start a new conversation.">
            <div className="group-card divide-y divide-[var(--border)] overflow-hidden">
              {d.starters.map((x, i) => (
                <div key={i} className="px-4 py-1.5">
                  <Grow
                    value={x}
                    maxLength={100}
                    aria-label={`Starter ${i + 1}`}
                    placeholder={["Why did checkout conversion drop this week?", "Brief me on yesterday's numbers", "Compare latency before and after the deploy", "Which endpoints got slower?"][i]}
                    onChange={(v) => set({ starters: d.starters.map((y, j) => (j === i ? v : y)) })}
                  />
                </div>
              ))}
            </div>
          </Section>
        </>
      ) : (
        <PermissionsEditor model={d.perms} onChange={(perms) => set({ perms })} globalRules={globalRules} />
      )}

      <AnimatePresence>
        {dirty && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="surface-overlay bg-raised sticky bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-10 mt-6 flex items-center gap-3 rounded-2xl border border-line px-4 py-2.5 shadow-pop"
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

/** A one-line value that wraps instead of scrolling sideways: grows with its text, and Enter never adds a line. */
function Grow({ onChange, ...rest }: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & { value: string; onChange: (v: string) => void }) {
  return (
    <textarea
      {...rest}
      rows={1}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
      className={`${formInput} block h-auto min-h-9 resize-none py-[7px] leading-snug [field-sizing:content]`}
    />
  );
}
