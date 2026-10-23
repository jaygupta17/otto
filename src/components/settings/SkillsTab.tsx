import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, BookOpen, ChevronRight, Lock, Plus, Puzzle, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useExtensions } from "../../state/extensions";
import type { SkillInfo } from "../../lib/opencode/client";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Spinner } from "../ui/AgentClock";
import { Markdown } from "../chat/Markdown";
import { Empty, Label, SearchBox, Section, Segmented, TextArea } from "./common";

function splitFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: m[2] };
}

function buildSkill(name: string, description: string, body: string) {
  const esc = (s: string) => (/[:#\n"]/.test(s) ? JSON.stringify(s) : s);
  return `---\nname: ${esc(name)}\ndescription: ${esc(description.replace(/\n/g, " "))}\n---\n\n${body.trim()}\n`;
}

export function SkillsTab({ compact }: { compact: boolean }) {
  const skills = useExtensions((s) => s.skills);
  const loc = useExtensions((s) => s.loc);
  const load = useExtensions((s) => s.load);
  const loadSkills = useExtensions((s) => s.loadSkills);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<SkillInfo | "new" | null>(null);

  useEffect(() => {
    void load();
    void loadSkills();
  }, [load, loadSkills]);

  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = (skills ?? []).filter((s) => !t || `${s.name} ${s.description ?? ""}`.toLowerCase().includes(t));
    const mine = list.filter((s) => loc && s.path.startsWith(loc.dir + "/"));
    const builtin = list.filter((s) => s.path.startsWith("/builtin/"));
    const other = list.filter((s) => !mine.includes(s) && !builtin.includes(s));
    return [
      ["Yours", mine],
      ["Found on the server", other],
      ["Built in", builtin],
    ] as const;
  }, [skills, q, loc]);

  if (open) {
    return (
      <AnimatePresence mode="wait">
        <motion.div key={open === "new" ? "new" : open.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.18 }}>
          <button className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink" onClick={() => setOpen(null)}>
            <ArrowLeft size={15} /> Skills
          </button>
          <SkillEditor skill={open === "new" ? null : open} editable={open === "new" || (!!loc && open.path.startsWith(loc.dir + "/"))} onDone={() => setOpen(null)} compact={compact} />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <Section
      page
      title="Skills"
      desc="Instructions agents load when relevant."
      action={
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setOpen("new")}>
          New skill
        </Button>
      }
    >
      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search skills" />
      </div>
      {skills === null ? (
        <div className="flex justify-center py-10 text-muted">
          <Spinner />
        </div>
      ) : skills.length === 0 ? (
        <Empty icon={<Puzzle size={20} />} title="No skills yet" body="Create one to teach your agents a repeatable workflow." action={<Button onClick={() => setOpen("new")}>New skill</Button>} />
      ) : (
        groups.map(([label, list]) =>
          list.length ? (
            <div key={label} className="mb-5">
              <div className={`mb-2 text-[11px] font-medium tracking-[0.06em] text-accent-ink uppercase`}>
                {label} <span className="text-faint tabular-nums">{list.length}</span>
              </div>
              <div className="group-card divide-y divide-[var(--border)] overflow-hidden">
                {list.map((s) =>
                  compact ? (
                    // A phone has no room for two columns: name over description, and a way in.
                    <button key={s.id} onClick={() => setOpen(s)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-hover">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{s.name}</span>
                        <span className="block truncate text-[13px] text-muted">{s.description || "No description"}</span>
                      </span>
                      <ChevronRight size={18} className="shrink-0 text-faint" />
                    </button>
                  ) : (
                    <button key={s.id} onClick={() => setOpen(s)} className="flex w-full items-baseline gap-3 px-4 py-2.5 text-left transition-colors hover:bg-hover">
                      <span className="w-44 shrink-0 truncate text-[14px] font-medium">{s.name}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{s.description || "No description"}</span>
                    </button>
                  ),
                )}
              </div>
            </div>
          ) : null,
        )
      )}
    </Section>
  );
}

function SkillEditor({ skill, editable, onDone, compact }: { skill: SkillInfo | null; editable: boolean; onDone: () => void; compact: boolean }) {
  const writeSkill = useExtensions((s) => s.writeSkill);
  const deleteSkill = useExtensions((s) => s.deleteSkill);
  const parsed = useMemo(() => splitFrontmatter(skill?.content ?? ""), [skill]);
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? parsed.meta.description ?? "");
  const [body, setBody] = useState(skill ? parsed.body.trim() : "## When to use\n\n## Steps\n\n1. ");
  const [view, setView] = useState<"edit" | "preview">(editable ? "edit" : "preview");
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const nameErr = !skill && name && !/^[a-z0-9][a-z0-9-]*$/.test(name) ? "Lowercase letters, numbers and - only." : null;

  async function save() {
    if (!name || nameErr || !description.trim()) return;
    setSaving(true);
    const ok = await writeSkill(name, buildSkill(name, description, body), skill?.path);
    setSaving(false);
    if (ok) onDone();
  }

  return (
    <div className="space-y-5 pb-6">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-[18px] font-semibold">{skill ? skill.name : name || "New skill"}</h3>
            {!editable && (
              <span className="flex items-center gap-1 rounded-full bg-sunken px-2 py-px text-[12px] font-medium text-muted">
                <Lock size={10} /> Read-only
              </span>
            )}
          </div>
          {skill && <div className="selectable truncate font-mono text-[12px] text-faint">{skill.path}</div>}
        </div>
      </div>
      {editable && (
        <div className={`grid gap-4 ${compact ? "" : "sm:grid-cols-2"}`}>
          <TextField label="Name" placeholder="deploy-checklist" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} disabled={!!skill} error={nameErr} />
          <TextField label="When should agents use it?" placeholder="Use when deploying the web app to production" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      )}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>Instructions</Label>
          {editable && (
            <Segmented
              id="skill-view"
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { id: "edit", label: "Write" },
                { id: "preview", label: "Preview" },
              ]}
            />
          )}
        </div>
        {view === "edit" && editable ? (
          <TextArea value={body} onChange={setBody} rows={16} mono />
        ) : (
          <div className="group-card px-5 py-4">
            {body.trim() ? <Markdown text={body} /> : <div className="flex items-center gap-2 text-[13px] text-faint"><BookOpen size={14} /> Nothing here yet.</div>}
          </div>
        )}
      </div>
      {editable && (
        <div className="flex items-center justify-between">
          {skill ? (
            confirm ? (
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                  Keep
                </Button>
                <Button size="sm" variant="danger" onClick={async () => (await deleteSkill(skill)) && onDone()}>
                  Delete skill
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => setConfirm(true)}>
                Delete
              </Button>
            )
          ) : (
            <span />
          )}
          <Button variant="primary" size="sm" disabled={saving || !name || !!nameErr || !description.trim()} onClick={() => void save()}>
            {saving ? <Spinner size={13} /> : skill ? "Save skill" : "Create skill"}
          </Button>
        </div>
      )}
    </div>
  );
}
