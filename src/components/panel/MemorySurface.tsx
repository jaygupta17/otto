/**
 * What teammates remember in this project: every memory the plugin saved,
 * searchable, editable and deletable in place. Nothing is hidden: this is the
 * same file the agents read.
 */
import { Bookmark, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "../../state/chat";
import { useMemory } from "../../state/memory";
import { useTeammates } from "../../state/teammates";
import { basename, timeAgo } from "../../lib/format";
import { MEMORY_TYPES, PROJECT_SCOPE, TYPE_LABEL, USER_SCOPE, type MemoryEntry, type MemoryType } from "../../lib/memory";
import type { Teammate } from "../../lib/teammates";
import { Button, IconButton } from "../ui/Button";
import { Select } from "../ui/Select";
import { Spinner } from "../ui/AgentClock";
import { AgentMark } from "../ui/TeammateFace";
import { PanelEmpty, PanelHeader, PanelTitle, useSurfaceVisible } from "./SidePanel";

const ALL = "";

export function scopeLabel(scope: string, roster: Record<string, Teammate> | null) {
  if (scope === USER_SCOPE) return "About you";
  if (scope === PROJECT_SCOPE) return "This project";
  return roster?.[scope]?.name ?? scope;
}

const typeOptions = MEMORY_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] }));

export function MemorySurface({ root }: { root: string | null }) {
  const client = useChat((s) => s.client);
  const visible = useSurfaceVisible("memory");
  const installed = useMemory((s) => s.installed);
  const folder = useMemory((s) => (root ? s.byRoot[root] : undefined));
  const roster = useTeammates((s) => s.byId);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState(ALL);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load on show, and again whenever the panel comes back.
  useEffect(() => {
    if (!visible || !client) return;
    const m = useMemory.getState();
    if (m.installed === null) void m.checkInstalled();
    if (root) void m.load(root);
  }, [visible, client, root]);

  // "Show in Memory" from a chat: take its search once the panel is up.
  const pending = useMemory((s) => s.query);
  useEffect(() => {
    if (!visible || pending === null) return;
    setQuery(useMemory.getState().takeQuery() ?? "");
    setScope(ALL);
  }, [pending, visible]);

  useEffect(() => {
    setScope(ALL);
    setAdding(false);
  }, [root]);

  const entries = folder?.entries ?? null;

  /** Scopes in use, people first: you, the project, teammates, then anything else. */
  const scopes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries ?? []) counts.set(e.scope, (counts.get(e.scope) ?? 0) + 1);
    const rank = (s: string) => (s === USER_SCOPE ? 0 : s === PROJECT_SCOPE ? 1 : roster?.[s] ? 2 : 3);
    return [...counts].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  }, [entries, roster]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (entries ?? []).filter((e) => {
      if (scope && e.scope !== scope) return false;
      if (!words.length) return true;
      const hay = `${e.content} ${e.type} ${e.scope} ${scopeLabel(e.scope, roster)} ${e.tags?.join(" ") ?? ""} ${e.issue ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [entries, scope, query, roster]);

  const turnOn = async () => {
    setBusy(true);
    await useMemory.getState().setEnabled(true);
    setBusy(false);
  };

  const header = (
    <PanelHeader
      actions={
        root && (
          <>
            <IconButton label="Refresh" size={28} onClick={() => void useMemory.getState().load(root)}>
              <RefreshCw size={13} />
            </IconButton>
            <IconButton label="Add a memory" size={28} active={adding} onClick={() => setAdding((a) => !a)}>
              <Plus size={15} />
            </IconButton>
          </>
        )
      }
    >
      <PanelTitle surface="memory" detail={root ? basename(root) : undefined} />
    </PanelHeader>
  );

  if (!root)
    return (
      <>
        {header}
        <PanelEmpty icon={<Bookmark size={18} />} title="No project yet" body="Open a session to see what its teammates remember." />
      </>
    );

  if (installed === null || (entries === null && !folder?.error))
    return (
      <>
        {header}
        <div className="flex flex-1 items-center justify-center text-muted">
          <Spinner size={16} />
        </div>
      </>
    );

  const empty = !entries?.length;

  if (!installed && empty && !adding)
    return (
      <>
        {header}
        <PanelEmpty
          icon={<Bookmark size={18} />}
          title="Memory is off"
          body="With memory on, teammates save what they learn about you and this project, and pick it up again in later sessions. You can see and edit all of it here."
        >
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void turnOn()}>
            {busy ? <Spinner size={12} /> : "Turn on memory"}
          </Button>
        </PanelEmpty>
      </>
    );

  return (
    <>
      {header}
      {!installed && (
        <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5 text-[12.5px] text-muted">
          <span className="min-w-0 flex-1">Memory is off. Teammates won't save or recall these.</span>
          <Button size="sm" disabled={busy} onClick={() => void turnOn()}>
            {busy ? <Spinner size={12} /> : "Turn on"}
          </Button>
        </div>
      )}

      {adding && <Composer root={root} roster={roster} onDone={() => setAdding(false)} />}

      {!empty && (
        <div className="shrink-0 space-y-2 px-3 pt-3 pb-2">
          <div className="field flex h-8 items-center gap-2 rounded-lg px-2.5">
            <Search size={13} className="text-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search memories"
              aria-label="Search memories"
              data-own-escape={query ? "" : undefined}
              onKeyDown={(e) => e.key === "Escape" && query && setQuery("")}
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
            />
            {query && (
              <button aria-label="Clear search" className="text-faint hover:text-ink" onClick={() => setQuery("")}>
                <X size={13} />
              </button>
            )}
          </div>
          {scopes.length > 1 && (
            <div className="scroll-quiet -mx-3 flex gap-1 overflow-x-auto px-3" role="tablist" aria-label="Whose memories">
              <ScopeChip active={scope === ALL} onClick={() => setScope(ALL)} label="All" count={entries!.length} />
              {scopes.map(([s, n]) => (
                <ScopeChip key={s} active={scope === s} onClick={() => setScope(scope === s ? ALL : s)} label={scopeLabel(s, roster)} count={n} mark={roster?.[s] ? s : undefined} />
              ))}
            </div>
          )}
        </div>
      )}

      {folder?.error && (
        <div className="mx-3 mt-2 rounded-lg border border-line px-3 py-2 text-[12.5px] text-muted">
          Couldn't read this project's memory: {folder.error}
        </div>
      )}

      {empty && !folder?.error ? (
        !adding && (
          <PanelEmpty
            icon={<Bookmark size={18} />}
            title="Nothing remembered yet"
            body={
              <>
                Tell a teammate “remember that…”, or let them note decisions and preferences as they work. Everything they save in {basename(root)} shows up here.
              </>
            }
          >
            <Button size="sm" icon={<Plus size={13} />} onClick={() => setAdding(true)}>
              Add one yourself
            </Button>
          </PanelEmpty>
        )
      ) : (
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {shown.length === 0 ? (
            <div className="px-2 py-8 text-center text-[13px] text-muted">
              Nothing matches.{" "}
              <button
                className="text-ink underline-offset-2 hover:underline"
                onClick={() => {
                  setQuery("");
                  setScope(ALL);
                }}
              >
                Show everything
              </button>
            </div>
          ) : (
            <ul className="space-y-1.5 pt-1">
              {shown.map((e) => (
                <Card key={`${e.file}\n${e.raw}`} entry={e} root={root} roster={roster} />
              ))}
            </ul>
          )}
          <Footer root={root} installed={!!installed} />
        </div>
      )}
    </>
  );
}

function ScopeChip({ active, onClick, label, count, mark }: { active: boolean; onClick(): void; label: string; count: number; mark?: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-colors ${active ? "border-transparent bg-active text-ink" : "border-line text-muted hover:bg-hover hover:text-ink"}`}
    >
      {mark && <AgentMark id={mark} size={16} />}
      {label}
      <span className="text-faint tabular-nums">{count}</span>
    </button>
  );
}

/** Neutral on purpose: hue is reserved for agent state. */
export function TypeChip({ type }: { type: MemoryType }) {
  return <span className="rounded-md bg-hover px-1.5 py-px text-[11.5px] font-medium text-muted">{TYPE_LABEL[type]}</span>;
}

function Card({ entry, root, roster }: { entry: MemoryEntry; root: string; roster: Record<string, Teammate> | null }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const teammate = roster?.[entry.scope];
  const ts = Date.parse(entry.ts);

  if (editing)
    return (
      <li>
        <Editor
          initial={{ content: entry.content, type: entry.type }}
          saveLabel="Save"
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            if (v.content === entry.content && v.type === entry.type) return setEditing(false);
            if (await useMemory.getState().update(root, entry, v)) setEditing(false);
          }}
        />
      </li>
    );

  return (
    <li className="group rounded-lg border border-line px-3 py-2.5 transition-colors hover:bg-hover/50">
      <div className="text-[13.5px] leading-relaxed whitespace-pre-wrap break-words text-ink">{entry.content || <span className="text-faint">Empty</span>}</div>
      <div className="mt-2 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
        <TypeChip type={entry.type} />
        <span className="flex items-center gap-1 text-muted">
          {teammate && <AgentMark id={entry.scope} size={14} />}
          {scopeLabel(entry.scope, roster)}
        </span>
        {!Number.isNaN(ts) && <span title={new Date(ts).toLocaleString()}>{timeAgo(ts)}</span>}
        {entry.issue && <span className="font-mono">{entry.issue}</span>}
        {entry.tags?.map((t) => (
          <span key={t}>#{t}</span>
        ))}
        <span className="ml-auto flex items-center gap-0.5">
          {confirming ? (
            <>
              <span className="mr-1 text-muted">Delete this?</span>
              <Button size="sm" variant="ghost" autoFocus onClick={() => setConfirming(false)}>
                Keep
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  if (!(await useMemory.getState().forget(root, entry))) setSaving(false);
                }}
              >
                {saving ? <Spinner size={12} /> : "Delete"}
              </Button>
            </>
          ) : (
            <span className="flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
              <IconButton label="Edit memory" size={24} onClick={() => setEditing(true)}>
                <Pencil size={12} />
              </IconButton>
              <IconButton label="Delete memory" size={24} onClick={() => setConfirming(true)}>
                <Trash2 size={12} />
              </IconButton>
            </span>
          )}
        </span>
      </div>
    </li>
  );
}

/** Content + type, shared by "add" and "edit". */
function Editor({
  initial,
  saveLabel,
  onSave,
  onCancel,
  children,
}: {
  initial: { content: string; type: MemoryType };
  saveLabel: string;
  onSave(v: { content: string; type: MemoryType }): Promise<unknown>;
  onCancel(): void;
  children?: React.ReactNode;
}) {
  const [content, setContent] = useState(initial.content);
  const [type, setType] = useState<MemoryType>(initial.type);
  const [saving, setSaving] = useState(false);
  const ok = content.trim().length > 0 && !saving;
  const save = async () => {
    if (!ok) return;
    setSaving(true);
    await onSave({ content: content.trim(), type });
    setSaving(false);
  };
  return (
    <div className="rounded-lg border border-line-strong bg-raised p-2.5">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        autoFocus
        rows={3}
        data-own-escape
        placeholder="What should teammates remember?"
        aria-label="Memory"
        onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void save();
          }
        }}
        className="block w-full resize-none bg-transparent text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-faint"
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select value={type} onChange={setType} options={typeOptions} ariaLabel="Kind" width={150} className="!h-7 !w-auto !text-[12.5px]" />
        {children}
        <span className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" disabled={!ok} onClick={() => void save()}>
            {saving ? <Spinner size={12} /> : saveLabel}
          </Button>
        </span>
      </div>
    </div>
  );
}

function Composer({ root, roster, onDone }: { root: string; roster: Record<string, Teammate> | null; onDone(): void }) {
  const [scope, setScope] = useState(USER_SCOPE);
  const options = useMemo(
    () => [
      { value: USER_SCOPE, label: "About you", hint: "Every teammate" },
      { value: PROJECT_SCOPE, label: "This project", hint: "Every teammate" },
      ...Object.values(roster ?? {})
        .sort((a, b) => a.created - b.created)
        .map((t) => ({ value: t.id, label: t.name, icon: <AgentMark id={t.id} size={16} />, hint: "Only them" })),
    ],
    [roster],
  );
  return (
    <div className="shrink-0 border-b border-line p-3">
      <Editor
        initial={{ content: "", type: "preference" }}
        saveLabel="Remember"
        onCancel={onDone}
        onSave={async (v) => {
          if (await useMemory.getState().add(root, { ...v, scope })) onDone();
        }}
      >
        <Select value={scope} onChange={setScope} options={options} ariaLabel="For" width={200} className="!h-7 !w-auto !text-[12.5px]" />
      </Editor>
    </div>
  );
}

function Footer({ root, installed }: { root: string; installed: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-5 space-y-1 px-1 text-[11.5px] leading-relaxed text-faint">
      <div>
        Saved in <span className="font-mono">{basename(root)}/.opencode/memory</span>. Teammates get the memories that match each message.
      </div>
      {installed && (
        <button
          disabled={busy}
          className="text-faint underline-offset-2 hover:text-muted hover:underline disabled:opacity-50"
          onClick={async () => {
            if (!confirm("Turn memory off for every teammate? Saved memories stay where they are.")) return;
            setBusy(true);
            await useMemory.getState().setEnabled(false);
            setBusy(false);
          }}
        >
          Turn memory off
        </button>
      )}
    </div>
  );
}
