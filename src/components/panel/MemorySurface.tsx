/**
 * Memory: the markdown teammates keep on this machine. `context.md` is
 * injected into every new session, so it sits at the top in an editor; the
 * rest of the folder is a small index, and any file opens here to edit.
 * Nothing is hidden: this is the same folder the agents read and write.
 */
import { AlertTriangle, ArrowLeft, FileText, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useChat } from "../../state/chat";
import { useMemory } from "../../state/memory";
import { prettyPath, timeAgo } from "../../lib/format";
import { CONTEXT_LINE_LIMIT, lineCount, type MemoryFile, type MemoryKind } from "../../lib/memory";
import { Toggle } from "../settings/common";
import { Button, IconButton } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { Hint } from "../ui/Tooltip";
import { PanelEmpty, PanelHeader, PanelTitle, useSurfaceVisible } from "./SidePanel";

const KIND_LABEL: Record<Exclude<MemoryKind, "context" | "other">, string> = {
  daily: "Daily",
  project: "Project",
  learning: "Learning",
  agent: "Agent",
};

const relPath = (f: MemoryFile) => {
  switch (f.kind) {
    case "daily":
      return `daily/${f.name}.md`;
    case "project":
      return `projects/${f.name}.md`;
    case "learning":
      return `learnings/${f.name}.md`;
    case "agent":
      return `agents/${f.name}.md`;
    case "context":
      return "context.md";
    default:
      return f.name;
  }
};

const todayStamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function MemorySurface(_props: { root: string | null }) {
  const client = useChat((s) => s.client);
  const visible = useSurfaceVisible("memory");
  const installed = useMemory((s) => s.installed);
  const context = useMemory((s) => s.context);
  const files = useMemory((s) => s.files);
  const active = useMemory((s) => s.active);
  const loading = useMemory((s) => s.loading);
  const error = useMemory((s) => s.error);
  const [busy, setBusy] = useState(false);

  // Load on show, and again whenever the panel comes back.
  useEffect(() => {
    if (!visible || !client) return;
    const m = useMemory.getState();
    void m.checkInstalled();
    void m.load();
  }, [visible, client]);

  const toggle = async (on: boolean) => {
    setBusy(true);
    await useMemory.getState().setEnabled(on);
    setBusy(false);
  };

  const header = (
    <PanelHeader
      actions={
        <>
          <IconButton label="Refresh" size={28} disabled={loading} onClick={() => void useMemory.getState().load()}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </IconButton>
          <div className="mr-1 ml-1 flex items-center" data-tip={installed ? "Memory is on" : "Memory is off"}>
            <Toggle on={!!installed} onChange={(v) => void toggle(v)} disabled={installed === null || busy} label="Memory" />
          </div>
        </>
      }
    >
      <PanelTitle label="Memory" />
    </PanelHeader>
  );

  if (installed === null || (files === null && !error))
    return (
      <>
        {header}
        <div className="flex flex-1 items-center justify-center text-muted">
          <Spinner size={16} />
        </div>
      </>
    );

  if (active) {
    const file = files?.find((f) => f.path === active);
    return (
      <>
        {header}
        <FileEditor path={active} file={file} onBack={() => useMemory.getState().closeFile()} />
      </>
    );
  }

  const daily = (files ?? []).filter((f) => f.kind === "daily").sort((a, b) => b.name.localeCompare(a.name));
  const today = daily.filter((f) => f.name === todayStamp());
  const earlier = daily.filter((f) => f.name !== todayStamp());
  const projects = byName((files ?? []).filter((f) => f.kind === "project"));
  const learnings = byName((files ?? []).filter((f) => f.kind === "learning"));
  const agents = byName((files ?? []).filter((f) => f.kind === "agent"));
  const notes = daily.length + projects.length + learnings.length + agents.length;

  return (
    <>
      {header}
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
        {!installed && (
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5 text-[12px] text-muted">
            <span className="min-w-0 flex-1">Memory is off. context.md isn't injected into new sessions; the files below stay.</span>
            <Button size="sm" disabled={busy} onClick={() => void toggle(true)}>
              {busy ? <Spinner size={12} /> : "Turn on"}
            </Button>
          </div>
        )}

        {error && <div className="mx-3 mt-2 rounded-lg border border-line px-3 py-2 text-[12px] text-muted">Couldn't read the memory folder: {error}</div>}

        <ContextEditor initial={context} />

        {notes === 0 ? (
          <div className="mx-3 mb-4 rounded-xl border border-dashed border-line px-5 py-7 text-center">
            <div className="text-[13px] font-medium text-ink">No notes yet</div>
            <p className="mx-auto mt-1 max-w-[290px] text-[12px] text-muted">Tell a teammate “remember that…”</p>
          </div>
        ) : (
          <div className="px-3 pt-1 pb-4">
            <Section title="Today" hint="one line per event">
              {today.length ? today.map((f) => <Row key={f.path} file={f} />) : <div className="px-2 py-2 text-[12px] text-faint">Nothing yet today.</div>}
            </Section>
            {earlier.length > 0 && (
              <Section title="Earlier days">
                {earlier.map((f) => (
                  <Row key={f.path} file={f} />
                ))}
              </Section>
            )}
            <Section title="Projects">{projects.length ? projects.map((f) => <Row key={f.path} file={f} />) : <EmptyRow text="No project notes yet." />}</Section>
            <Section title="Learnings">{learnings.length ? learnings.map((f) => <Row key={f.path} file={f} />) : <EmptyRow text="Nothing durable learned yet." />}</Section>
            <Section title="Agents">{agents.length ? agents.map((f) => <Row key={f.path} file={f} />) : <EmptyRow text="No private notes yet." />}</Section>
          </div>
        )}

        <div className="flex items-center gap-1.5 px-4 pt-1 pb-5 text-[11px] text-faint">
          <span className="truncate font-mono">~/.config/opencode/memory</span>
          <Hint>Kept in OpenCode's config folder on this machine. Notes older versions saved in each project's .opencode/memory are untouched and not shown.</Hint>
        </div>
      </div>
    </>
  );
}

const byName = (list: MemoryFile[]) => list.sort((a, b) => a.name.localeCompare(b.name));

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 first:mt-2">
      <div className="flex items-baseline gap-2 px-2 pb-1.5">
        <h3 className="text-[11px] font-medium tracking-[0.06em] text-accent-ink uppercase">{title}</h3>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </div>
      <ul className="space-y-1">{children}</ul>
    </section>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <li className="px-2 py-1 text-[12px] text-faint">{text}</li>;
}

function Row({ file }: { file: MemoryFile }) {
  return (
    <li>
      <button
        onClick={() => void useMemory.getState().read(file.path)}
        className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:border-line hover:bg-hover/60"
      >
        <FileText size={14} className="shrink-0 text-faint group-hover:text-muted" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2 group-hover:text-ink">
          {file.name}
          {file.kind !== "daily" && <span className="text-faint">.md</span>}
        </span>
        <span className="shrink-0 text-[11px] text-faint" title={new Date(file.modified).toLocaleString()}>
          {timeAgo(file.modified)}
        </span>
      </button>
    </li>
  );
}

function ContextEditor({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  // A reload (save, toggle, refresh) brings authoritative text back.
  useEffect(() => setText(initial), [initial]);
  const lines = lineCount(text);
  const long = lines > CONTEXT_LINE_LIMIT;
  const dirty = text !== initial;
  const save = async () => {
    setSaving(true);
    await useMemory.getState().saveContext(text);
    setSaving(false);
  };

  return (
    <section className="border-b border-line px-3 py-3">
      <div className="flex items-baseline gap-2">
        <h3 className="self-center text-[13px] font-medium text-ink">Current context</h3>
        <Hint className="self-center">{`Added to every new session. Rewrite it to say what matters now; keep it under ${CONTEXT_LINE_LIMIT} lines.`}</Hint>
        <span className={`ml-auto inline-flex items-center gap-1 text-[11px] tabular-nums ${long ? "text-danger" : "text-faint"}`}>
          {long && <AlertTriangle size={11} />}
          {lines} / {CONTEXT_LINE_LIMIT} lines
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        spellCheck={false}
        data-own-escape
        aria-label="context.md"
        placeholder="# Memory&#10;&#10;## About you&#10;…"
        className="field scroll-quiet mt-2 block w-full resize-y rounded-lg px-3 py-2 font-mono text-[12px] leading-relaxed outline-none placeholder:text-faint"
      />
      <div className="mt-2 flex items-center gap-2">
        {long && <span className="text-[11px] text-danger">Trim it: only the first {CONTEXT_LINE_LIMIT} lines are cheap to carry.</span>}
        <Button size="sm" variant="primary" className="ml-auto" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Spinner size={12} /> : "Save"}
        </Button>
      </div>
    </section>
  );
}

function FileEditor({ path, file, onBack }: { path: string; file: MemoryFile | undefined; onBack(): void }) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setText(null);
    setFailed(false);
    void useMemory.getState().read(path).then((t) => {
      if (!live) return;
      if (t === null) setFailed(true);
      else {
        setText(t);
        setSaved(t);
      }
    });
    return () => {
      live = false;
    };
  }, [path]);

  const lines = text === null ? 0 : lineCount(text);
  const dirty = text !== null && text !== saved;
  const save = async () => {
    if (text === null) return;
    setSaving(true);
    if (await useMemory.getState().saveFile(path, text)) setSaved(text);
    setSaving(false);
  };

  if (failed)
    return (
      <PanelEmpty icon={<FileText size={18} />} title="Couldn't open this file" body="It may have moved or been deleted since the list was loaded.">
        <Button size="sm" onClick={onBack}>
          Back
        </Button>
      </PanelEmpty>
    );

  if (text === null)
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        <Spinner size={16} />
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-2">
        <IconButton label="Back to memory" size={28} onClick={onBack}>
          <ArrowLeft size={14} />
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-ink">
            {file ? `${file.name}${file.kind === "daily" ? "" : ".md"}` : path.split("/").pop()}
            {file && <span className="ml-1.5 font-normal text-faint">{KIND_LABEL[file.kind as Exclude<MemoryKind, "context" | "other">]}</span>}
          </div>
          <div className="truncate font-mono text-[11px] text-faint" title={path}>
            {file ? relPath(file) : prettyPath(path)}
          </div>
        </div>
        <span className="shrink-0 pr-1 text-[11px] text-faint font-mono tabular-nums">{lines} lines</span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        data-own-escape
        aria-label={file?.name ?? "Memory file"}
        className="scroll-quiet min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[12px] leading-relaxed text-ink outline-none"
      />
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2">
        <span className="text-[11px] text-faint">{file ? `Changed ${timeAgo(file.modified)}` : ""}</span>
        <Button size="sm" variant="primary" className="ml-auto" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? <Spinner size={12} /> : "Save"}
        </Button>
      </div>
    </div>
  );
}
