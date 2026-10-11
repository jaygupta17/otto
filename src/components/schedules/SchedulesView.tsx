import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, FlaskConical, Folder, MoreHorizontal, PackageCheck, PanelLeft, Pencil, Play, Plus, Sunrise, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSchedules } from "../../state/schedules";
import { useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { useActiveWorkspace } from "../../state/workspaces";
import { describe, nextRun, toCron, validCron, type Frequency, type Schedule } from "../../lib/schedules";
import { basename, timeAgo } from "../../lib/format";
import { uid } from "../../lib/id";
import { useTrafficLights } from "../../hooks/useChrome";
import { Button, IconButton } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Spinner } from "../ui/AgentClock";
import { Label, Segmented, TextArea, Toggle } from "../settings/common";
import { AgentSelect } from "../settings/AgentSelect";
import { Select, TimeSelect } from "../ui/Select";
import { Popover, MenuItem } from "../ui/Popover";
import { ModelSelect } from "../settings/ModelSelect";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TEMPLATES: { name: string; prompt: string; frequency: Frequency; icon: typeof Sunrise }[] = [
  { icon: Sunrise, name: "Morning standup", prompt: "Summarize what changed in this repo since yesterday (git log, open branches) and list anything that looks broken or risky.", frequency: { kind: "weekdays", hour: 9, minute: 0 } },
  { icon: PackageCheck, name: "Dependency check", prompt: "Check for outdated or vulnerable dependencies. Propose safe upgrades and run the tests for each one you'd apply. Don't commit.", frequency: { kind: "weekly", days: [1], hour: 10, minute: 0 } },
  { icon: FlaskConical, name: "Nightly tests", prompt: "Run the full test suite. If anything fails, investigate the cause and write a short report with suggested fixes.", frequency: { kind: "daily", hour: 2, minute: 0 } },
];

export function SchedulesView({ compact = false, onBack }: { compact?: boolean; onBack?: () => void }) {
  const list = useSchedules((s) => s.list);
  const env = useSchedules((s) => s.env);
  const error = useSchedules((s) => s.error);
  const load = useSchedules((s) => s.load);
  const client = useChat((s) => s.client);
  const ws = useActiveWorkspace();
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [template, setTemplate] = useState<(typeof TEMPLATES)[number] | null>(null);

  useEffect(() => {
    if (client) void load();
  }, [client, load]);

  const mac = useTrafficLights();
  return (
    <div className="flex h-full flex-col">
      <header className={`drag flex h-[52px] shrink-0 items-center gap-2 pr-3 ${compact ? "safe-top h-auto pt-2 pl-3" : !sidebarOpen && mac ? "pl-[84px]" : "pl-3"}`} data-tauri-drag-region>
        {compact && onBack && (
          <button onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full bg-sunken" aria-label="Back">
            <ArrowLeft size={20} />
          </button>
        )}
        {!compact && !sidebarOpen && (
          <IconButton label="Show sidebar" className="no-drag" onClick={() => toggleSidebar(true)}>
            <PanelLeft size={17} />
          </IconButton>
        )}
        <div className="flex-1" data-tauri-drag-region />
      </header>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-5 pb-16 sm:px-8">
          <AnimatePresence mode="wait" initial={false}>
            {editing ? (
              <motion.div key="edit" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 16 }} transition={{ duration: 0.18 }}>
                <ScheduleEditor
                  initial={editing === "new" ? null : editing}
                  template={template}
                  onClose={() => {
                    setEditing(null);
                    setTemplate(null);
                  }}
                />
              </motion.div>
            ) : (
              <motion.div key="list" initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
                <div className="mb-2 flex items-center justify-between gap-4 pt-6">
                  <h1 className="text-[22px] font-semibold tracking-[-0.01em]">Scheduled</h1>
                  <Button variant="primary" icon={<Plus size={15} />} onClick={() => setEditing("new")}>
                    New
                  </Button>
                </div>
                <p className="mb-8 text-[13.5px] text-muted">
                  Agents that start on their own, even with Otto closed.
                  {ws?.provider === "boat" && " They run while the sandbox is awake."}
                </p>

                {error && <div className="selectable mb-4 rounded-xl bg-danger-soft px-4 py-3 text-[13px] text-danger">{error}</div>}
                {env && !env.hasCron && env.os !== "Linux" && <div className="mb-4 rounded-xl bg-info-soft px-4 py-3 text-[13px] text-info">This machine has no cron, so schedules can’t run here.</div>}

                {list === null ? (
                  <div className="flex justify-center py-16 text-muted">
                    <Spinner />
                  </div>
                ) : list.length === 0 ? (
                  <>
                    <h2 className="mb-3 text-[13px] font-medium text-muted">Start from an example</h2>
                    <div className="grid gap-2.5 sm:grid-cols-3">
                      {TEMPLATES.map((t) => (
                        <button
                          key={t.name}
                          onClick={() => {
                            setTemplate(t);
                            setEditing("new");
                          }}
                          className="group flex flex-col items-start gap-6 rounded-2xl bg-raised p-4 text-left hairline transition-colors hover:bg-hover"
                        >
                          <t.icon size={17} className="text-muted transition-colors group-hover:text-ink" />
                          <span>
                            <span className="block text-[14px] font-medium">{t.name}</span>
                            <span className="mt-0.5 block text-[12.5px] text-muted">{describe(t.frequency)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="divide-y divide-[var(--border)] overflow-hidden rounded-2xl bg-raised hairline">
                    {list.map((s) => (
                      <ScheduleRow key={s.id} s={s} serverOffset={env?.serverOffset ?? 0} onEdit={() => setEditing(s)} />
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function ScheduleRow({ s, serverOffset, onEdit }: { s: Schedule; serverOffset: number; onEdit: () => void }) {
  const runs = useSchedules((st) => st.runs[s.id]);
  const setEnabled = useSchedules((st) => st.setEnabled);
  const runNow = useSchedules((st) => st.runNow);
  const remove = useSchedules((st) => st.remove);
  const more = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [running, setRunning] = useState(false);
  const next = useMemo(() => (s.enabled ? nextRun(toCron(s.frequency, serverOffset), serverOffset) : null), [s, serverOffset]);
  const last = runs?.[0];

  return (
    <div className={`group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-hover ${s.enabled ? "" : "opacity-60"}`}>
      <span
        title={!last ? "Hasn't run yet" : last.ok ? `Last run ${timeAgo(last.at)} ago` : `Last run failed ${timeAgo(last.at)} ago`}
        className={`h-2 w-2 shrink-0 rounded-full ${!last ? "bg-line-strong" : last.ok ? "bg-ok" : "bg-danger"}`}
      />
      <button onClick={onEdit} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[14px] text-ink">{s.name}</span>
        <span className="block truncate text-[12.5px] text-muted">
          {describe(s.frequency)}
          {next && <span className="text-faint"> · next {formatNext(next)}</span>}
        </span>
      </button>
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <IconButton
          label="Run now"
          size={30}
          disabled={running}
          onClick={async () => {
            setRunning(true);
            await runNow(s.id);
            setRunning(false);
          }}
        >
          {running ? <Spinner size={13} /> : <Play size={14} />}
        </IconButton>
        <IconButton ref={more} label="More" size={30} active={menu} onClick={() => setMenu((v) => !v)}>
          <MoreHorizontal size={15} />
        </IconButton>
      </div>
      <Toggle on={s.enabled} onChange={(v) => void setEnabled(s.id, v)} label={s.enabled ? "Pause" : "Resume"} />
      <Popover open={menu} onClose={() => setMenu(false)} anchor={more.current} placement="bottom-end" width={180}>
        <div className="p-1">
          <MenuItem icon={<Pencil size={14} />} label="Edit" onClick={() => (setMenu(false), onEdit())} />
          <MenuItem icon={<Trash2 size={14} />} label="Delete" danger onClick={() => (setMenu(false), void remove(s.id))} />
        </div>
      </Popover>
    </div>
  );
}

function formatNext(t: number) {
  const d = new Date(t);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ` ${time}`;
}

function ScheduleEditor({ initial, template, onClose }: { initial: Schedule | null; template: (typeof TEMPLATES)[number] | null; onClose: () => void }) {
  const upsert = useSchedules((s) => s.upsert);
  const saving = useSchedules((s) => s.saving);
  const env = useSchedules((s) => s.env);
  const home = useChat((s) => s.homeDir);
  const client = useChat((s) => s.client);
  const [name, setName] = useState(initial?.name ?? template?.name ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? template?.prompt ?? "");
  const [directory, setDirectory] = useState(initial?.directory ?? home ?? "");
  const [agent, setAgent] = useState(initial?.agent ?? "");
  const [model, setModel] = useState(initial?.model ?? null);
  const [freq, setFreq] = useState<Frequency>(initial?.frequency ?? template?.frequency ?? { kind: "weekdays", hour: 9, minute: 0 });
  const [folders, setFolders] = useState<string[]>([]);

  useEffect(() => {
    if (!client || !home) return;
    client
      .listDir(home, home)
      .then((l) => setFolders(l.filter((e) => e.type === "directory" && !e.path.startsWith(".")).map((e) => `${home.replace(/\/$/, "")}/${e.path.replace(/\/$/, "")}`)))
      .catch(() => {});
  }, [client, home]);

  const time = "hour" in freq ? `${String(freq.hour).padStart(2, "0")}:${String(freq.minute).padStart(2, "0")}` : "09:00";
  const setTime = (v: string) => {
    const [h, m] = v.split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(m) && "hour" in freq) setFreq({ ...freq, hour: h, minute: m });
  };
  const kind = freq.kind;
  const cronOk = freq.kind !== "custom" || validCron(freq.cron);
  const next = cronOk && env ? nextRun(toCron(freq, env.serverOffset), env.serverOffset) : null;
  const valid = name.trim() && prompt.trim() && cronOk && !(freq.kind === "weekly" && freq.days.length === 0);

  function switchKind(k: Frequency["kind"]) {
    const h = "hour" in freq ? freq.hour : 9;
    const m = "minute" in freq ? freq.minute : 0;
    if (k === "hourly") setFreq({ kind: "hourly", minute: m });
    else if (k === "daily") setFreq({ kind: "daily", hour: h, minute: m });
    else if (k === "weekdays") setFreq({ kind: "weekdays", hour: h, minute: m });
    else if (k === "weekly") setFreq({ kind: "weekly", days: [1], hour: h, minute: m });
    else setFreq({ kind: "custom", cron: env ? toCron(freq, env.serverOffset) : "0 9 * * 1-5" });
  }

  async function save() {
    if (!valid) return;
    const ok = await upsert({
      id: initial?.id ?? uid("sch"),
      name: name.trim(),
      prompt: prompt.trim(),
      directory: directory || undefined,
      agent: agent || undefined,
      model: model ?? undefined,
      frequency: freq,
      enabled: initial?.enabled ?? true,
      createdAt: initial?.createdAt ?? Date.now(),
    });
    if (ok) onClose();
  }

  const runs = useSchedules((st) => (initial ? st.runs[initial.id] : undefined));
  const remove = useSchedules((st) => st.remove);
  const open = useChat((st) => st.open);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const folderOptions = [
    ...(home ? [{ value: home, label: "projects", icon: <Folder size={14} /> }] : []),
    ...folders.map((f) => ({ value: f, label: basename(f), icon: <Folder size={14} /> })),
    ...(directory && directory !== home && !folders.includes(directory) ? [{ value: directory, label: basename(directory), icon: <Folder size={14} /> }] : []),
  ];

  return (
    <div className="pt-6">
      <button className="-ml-1 mb-4 inline-flex items-center gap-1 rounded-md px-1 text-[13px] text-muted transition-colors hover:text-ink" onClick={onClose}>
        <ArrowLeft size={14} /> Scheduled
      </button>
      <h2 className="mb-7 text-[22px] font-semibold tracking-[-0.01em]">{initial ? initial.name : "New schedule"}</h2>

      <div className="space-y-5">
        <TextField label="Name" placeholder="Morning standup" value={name} onChange={(e) => setName(e.target.value)} autoFocus={!initial} />
        <div>
          <Label>Instructions</Label>
          <TextArea value={prompt} onChange={setPrompt} rows={5} placeholder="Check open PRs, run the tests, and summarize anything that needs my attention." />
        </div>

        <div>
          <Label>Repeat</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              id="sched-kind"
              value={kind}
              onChange={switchKind}
              options={[
                { id: "hourly", label: "Hourly" },
                { id: "daily", label: "Daily" },
                { id: "weekdays", label: "Weekdays" },
                { id: "weekly", label: "Weekly" },
                { id: "custom", label: "Cron" },
              ]}
            />
            {freq.kind === "hourly" && (
              <div className="w-[120px]">
                <Select
                  ariaLabel="Minute past the hour"
                  value={String(freq.minute)}
                  onChange={(v) => setFreq({ kind: "hourly", minute: Number(v) })}
                  options={Array.from(new Set([...Array.from({ length: 12 }, (_, i) => i * 5), freq.minute]))
                    .sort((x, y) => x - y)
                    .map((m) => ({ value: String(m), label: `at :${String(m).padStart(2, "0")}` }))}
                />
              </div>
            )}
            {"hour" in freq && (
              <div className="w-[120px]">
                <TimeSelect value={time} onChange={setTime} />
              </div>
            )}
          </div>
          {freq.kind === "weekly" && (
            <div className="mt-3 flex gap-1">
              {DAYS.map((d, i) => {
                const on = freq.days.includes(i);
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={DAY_NAMES[i]}
                    aria-pressed={on}
                    title={DAY_NAMES[i]}
                    onClick={() => setFreq({ ...freq, days: on ? freq.days.filter((x) => x !== i) : [...freq.days, i].sort() })}
                    className={`grid h-8 w-8 place-items-center rounded-full text-[12px] font-medium transition-colors ${on ? "bg-ink text-bg" : "text-muted hairline hover:bg-hover hover:text-ink"}`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          )}
          {freq.kind === "custom" && (
            <input
              value={freq.cron}
              onChange={(e) => setFreq({ kind: "custom", cron: e.target.value })}
              placeholder="m h dom mon dow"
              aria-invalid={!cronOk}
              className="field mt-3 h-9 w-full rounded-lg px-3 font-mono text-[13px]"
            />
          )}
          <p className={`mt-2 text-[12.5px] ${cronOk ? "text-muted" : "text-danger"}`}>
            {!cronOk ? "That cron expression isn’t valid." : freq.kind === "custom" ? `Server time, UTC${fmtOffset(env?.serverOffset ?? 0)}${next ? ` · next ${formatNext(next)}` : ""}` : next ? `Next ${formatNext(next)}` : ""}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>Project</Label>
            <Select ariaLabel="Project folder" value={directory} onChange={setDirectory} options={folderOptions} />
          </div>
          <div>
            <Label>Agent</Label>
            <AgentSelect value={agent} onChange={setAgent} emptyLabel="Default" />
          </div>
          <div>
            <Label>Model</Label>
            <ModelSelect value={model} onChange={setModel} inheritLabel="Default" />
          </div>
        </div>

        {runs && runs.length > 0 && (
          <div>
            <Label>Recent runs</Label>
            <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl hairline">
              {runs.slice(0, 6).map((r, i) => (
                <div key={i} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.ok ? "bg-ok" : "bg-danger"}`} />
                  <span className="text-ink-2">{new Date(r.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                  <span className="min-w-0 flex-1 truncate text-faint">{r.ok ? "" : r.error}</span>
                  {r.sessionID && (
                    <button className="text-muted transition-colors hover:text-ink" onClick={() => open(r.sessionID!)}>
                      Open
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-8 flex items-center gap-2 border-t border-line pt-4">
        {initial &&
          (confirmDelete ? (
            <>
              <Button variant="danger" size="sm" onClick={() => void remove(initial.id).then(onClose)}>
                Delete schedule
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          ))}
        <div className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!valid || saving} onClick={() => void save()}>
          {saving ? <Spinner size={14} /> : initial ? "Save" : "Create"}
        </Button>
      </div>
    </div>
  );
}

function fmtOffset(min: number) {
  const sign = min < 0 ? "-" : "+";
  const a = Math.abs(min);
  return `${sign}${Math.floor(a / 60)}${a % 60 ? ":" + String(a % 60).padStart(2, "0") : ""}`;
}
