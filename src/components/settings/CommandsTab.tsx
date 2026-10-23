import { AnimatePresence, motion } from "motion/react";
import { Plus, SquareSlash, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useExtensions } from "../../state/extensions";
import type { CommandConfig } from "../../lib/opencode/config";
import { modelRefToString, modelStringToRef } from "../../lib/opencode/config";
import { Button, IconButton } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Spinner } from "../ui/AgentClock";
import { Card, Empty, Label, Section, TextArea, Toggle } from "./common";
import { ModelSelect } from "./ModelSelect";
import { AgentSelect } from "./AgentSelect";

/** Slash commands: reusable prompt templates (`/name args`). */
export function CommandsTab() {
  const config = useExtensions((s) => s.config);
  const load = useExtensions((s) => s.load);
  const [editing, setEditing] = useState<string | "new" | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  if (!config)
    return (
      <div className="flex justify-center py-16 text-muted">
        <Spinner />
      </div>
    );
  const commands = config.commands ?? {};
  const names = Object.keys(commands).sort();

  return (
    <Section
      page
      title="Commands"
      desc={
        <>
          Saved prompts you run with <code className="font-mono text-[12px] text-ink-2">/name</code>.
        </>
      }
      action={
        <Button size="sm" icon={<Plus size={14} />} onClick={() => setEditing("new")}>
          New command
        </Button>
      }
    >
      <AnimatePresence initial={false}>
        {editing && (
          <motion.div key={editing} initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <CommandEditor name={editing === "new" ? null : editing} cmd={editing === "new" ? undefined : commands[editing]} existing={names} onClose={() => setEditing(null)} />
          </motion.div>
        )}
      </AnimatePresence>
      {names.length === 0 && editing !== "new" ? (
        <Empty icon={<SquareSlash size={20} />} title="No custom commands" body="Save prompts you use often, like /review." />
      ) : (
        <Card className="divide-y divide-[var(--border)]">
          {names.map((n) => (
            <button key={n} onClick={() => setEditing(n)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover">
              <span className="grid w-5 shrink-0 place-items-center font-mono text-[14px] text-muted">/</span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[13px] font-medium">/{n}</span>
                <span className="block truncate text-[12px] text-muted">{commands[n].description || commands[n].template.slice(0, 80)}</span>
              </span>
              {commands[n].agent && <span className="rounded-md bg-sunken px-1.5 py-px text-[12px] text-muted">@{commands[n].agent}</span>}
            </button>
          ))}
        </Card>
      )}
    </Section>
  );
}

function CommandEditor({ name, cmd, existing, onClose }: { name: string | null; cmd?: CommandConfig; existing: string[]; onClose: () => void }) {
  const update = useExtensions((s) => s.update);
  const [n, setN] = useState(name ?? "");
  const [description, setDescription] = useState(cmd?.description ?? "");
  const [template, setTemplate] = useState(cmd?.template ?? "");
  const [agent, setAgent] = useState(cmd?.agent ?? "");
  const [model, setModel] = useState(modelStringToRef(cmd?.model));
  const [subagent, setSubagent] = useState(!!cmd?.subagent);
  const [saving, setSaving] = useState(false);
  const nameErr = !name && n ? (!/^[a-z0-9][a-z0-9_-]*$/.test(n) ? "Lowercase letters, numbers, - and _." : existing.includes(n) ? "Already exists." : null) : null;

  async function save() {
    if (!n || nameErr || !template.trim()) return;
    setSaving(true);
    const next: CommandConfig = { template };
    if (description.trim()) next.description = description.trim();
    if (agent) next.agent = agent;
    const m = modelRefToString(model);
    if (m) next.model = m;
    if (subagent) next.subagent = true;
    const ok = await update((c) => ({ ...c, commands: { ...(c.commands ?? {}), [n]: next } }), { success: `/${n} saved` });
    setSaving(false);
    if (ok) onClose();
  }

  async function remove() {
    const ok = await update(
      (c) => {
        const commands = { ...(c.commands ?? {}) };
        delete commands[name!];
        return { ...c, commands };
      },
      { success: `/${name} removed` },
    );
    if (ok) onClose();
  }

  return (
    <div className="mb-4 space-y-4 group-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold">{name ? `/${name}` : "New command"}</div>
        <IconButton label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Name" placeholder="review" value={n} onChange={(e) => setN(e.target.value.toLowerCase())} disabled={!!name} error={nameErr} />
        <TextField label="Description" placeholder="Review my uncommitted changes" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div>
        <Label hint="$ARGUMENTS is replaced by the text after the command">Prompt</Label>
        <TextArea value={template} onChange={setTemplate} rows={5} placeholder="Review the uncommitted changes in this repo. Focus on $ARGUMENTS." />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Agent</Label>
<AgentSelect value={agent} onChange={setAgent} emptyLabel="Current agent" primaryOnly={false} />
        </div>
        <div>
          <Label>Model</Label>
          <ModelSelect value={model} onChange={setModel} inheritLabel="Current model" />
        </div>
      </div>
      <label className="flex items-center justify-between gap-3">
        <span className="text-[13px]">Run as a subagent</span>
        <Toggle on={subagent} onChange={setSubagent} label="Run as subagent" />
      </label>
      <div className="flex items-center justify-between border-t border-line pt-3">
        {name ? (
          <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => void remove()}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <Button size="sm" variant="primary" disabled={saving || !n || !!nameErr || !template.trim()} onClick={() => void save()}>
          {saving ? <Spinner size={13} /> : "Save command"}
        </Button>
      </div>
    </div>
  );
}
