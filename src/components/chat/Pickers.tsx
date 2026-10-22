import { Check, ChevronDown, Folder, FolderGit2, FolderPlus, FolderSearch, GitBranchPlus, History, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelInfo } from "@opencode/client";
import { useChat, wsKey } from "../../state/chat";
import { useConnection } from "../../state/connection";
import { AgentMark } from "../ui/TeammateFace";
import { useAgentName, useTeammates } from "../../state/teammates";
import { isOfferedAgent } from "../../lib/teammates";
import { Popover, MenuItem } from "../ui/Popover";
import { useTouch } from "../../hooks/useMedia";
import { kv } from "../../lib/kv";
import { Spinner } from "../ui/AgentClock";
import { basename, compactNumber, prettyPath } from "../../lib/format";
import type { ModelRef } from "../../lib/opencode/client";
import { toast, useUI } from "../../state/ui";
import { FolderBrowser } from "./FolderBrowser";

const PROVIDER_NAMES: Record<string, string> = {
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  google: "Google",
  deepseek: "DeepSeek",
  "github-copilot": "GitHub Copilot",
  "cloudflare-workers-ai": "Cloudflare",
  "zai-coding-plan": "Z.AI",
  xai: "xAI",
  mistral: "Mistral",
  groq: "Groq",
};

export function providerName(id: string) {
  return PROVIDER_NAMES[id] ?? id.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isFree(m: ModelInfo) {
  return m.id.endsWith("-free") || m.id.endsWith(":free") || (m.cost?.[0]?.input === 0 && m.cost?.[0]?.output === 0);
}

function useCurrentModel(sessionId: string | null): { ref: ModelRef | null; info: ModelInfo | null } {
  const sessionModel = useChat((s) => (sessionId ? s.sessions[sessionId]?.model : undefined));
  const picked = useChat((s) => s.pickedModel);
  const def = useChat((s) => s.defaultModel);
  const models = useChat((s) => s.models);
  const ref = (sessionModel as ModelRef | undefined) ?? picked ?? def ?? null;
  const info = ref ? (models.find((m) => m.providerID === ref.providerID && m.id === ref.id) ?? null) : null;
  return { ref, info };
}

/** "Exo Free", "Big Pickle (free)", "foo-free" → the name without the free tag. */
function cleanName(m: ModelInfo) {
  return m.name.replace(/\s*[·(\-–:]?\s*free\)?$/i, "").trim() || m.name;
}

const RECENT_KEY = "models.recent";
const keyOf = (m: { providerID: string; id: string }) => `${m.providerID}/${m.id}`;

/**
 * The model menu: what's in use (with its effort levels) on top, then the
 * models used lately, then every provider's catalog. A dropdown by the
 * button everywhere; on touch screens its rows are sized for a finger.
 */
export function ModelPicker({ sessionId, compact = false }: { sessionId: string | null; compact?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { ref, info } = useCurrentModel(sessionId);
  const label = info ? cleanName(info) : (ref?.id ?? "Choose model");
  const variant = ref?.variant && ref.variant !== "default" ? ref.variant : null;
  const touch = useTouch();

  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 min-w-0 items-center gap-1 rounded-md px-2 text-[13px] text-ink-2 transition-colors hover:bg-hover hover:text-ink"
      >
        <span className={`truncate ${compact ? "max-w-[118px]" : "max-w-[220px]"}`}>{label}</span>
        {variant && <span className="shrink-0 text-muted">{cap(variant)}</span>}
        <ChevronDown size={13} className="shrink-0 text-faint" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="top-end" width={Math.min(360, window.innerWidth - 16)} label="Model">
        <ModelMenu sessionId={sessionId} touch={touch} onDone={() => setOpen(false)} />
      </Popover>
    </>
  );
}

function ModelMenu({ sessionId, touch = false, onDone }: { sessionId: string | null; touch?: boolean; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [recent, setRecent] = useState<string[]>([]);
  const models = useChat((s) => s.models);
  const broken = useChat((s) => s.brokenModels);
  const setModel = useChat((s) => s.setModel);
  const refreshCatalog = useChat((s) => s.refreshCatalog);
  const catalog = useConnection((s) => s.catalog);
  const catalogError = useChat((s) => s.catalogError);
  const { ref, info } = useCurrentModel(sessionId);

  useEffect(() => {
    if (models.length === 0) void refreshCatalog();
    void kv.get<string[]>(RECENT_KEY).then((r) => setRecent(r ?? []));
  }, [models.length, refreshCatalog]);

  const usable = useMemo(() => models.filter((m) => m.status !== "deprecated" && m.enabled !== false && !broken.includes(keyOf(m))), [models, broken]);
  const term = q.trim().toLowerCase();

  const groups = useMemo(() => {
    const list = usable.filter((m) => !term || `${m.name} ${m.id} ${m.providerID} ${providerName(m.providerID)}`.toLowerCase().includes(term));
    const by = new Map<string, ModelInfo[]>();
    for (const m of list) by.set(m.providerID, [...(by.get(m.providerID) ?? []), m]);
    const order = (p: string) => (p === "opencode" ? 0 : p === "anthropic" ? 1 : p === "openai" ? 2 : 3);
    return [...by.entries()].sort((a, b) => order(a[0]) - order(b[0]) || providerName(a[0]).localeCompare(providerName(b[0]))).map(([p, ms]) => [p, ms.sort((a, b) => b.time.released - a.time.released)] as const);
  }, [usable, term]);

  const recentModels = useMemo(() => {
    if (term) return [];
    const current = ref ? keyOf(ref) : null;
    return recent
      .filter((k) => k !== current)
      .map((k) => usable.find((m) => keyOf(m) === k))
      .filter((m): m is ModelInfo => !!m)
      .slice(0, 4);
  }, [recent, usable, ref, term]);

  const pick = (m: ModelInfo) => {
    void setModel({ providerID: m.providerID, id: m.id }, sessionId);
    const next = [keyOf(m), ...recent.filter((k) => k !== keyOf(m))].slice(0, 8);
    setRecent(next);
    void kv.set(RECENT_KEY, next);
    // Stay open when there's an effort level to choose next.
    if (!m.variants?.length) onDone();
  };

  const row = (m: ModelInfo, showProvider = false, freeTag = true) => {
    const active = ref?.providerID === m.providerID && ref?.id === m.id;
    return (
      <button
        key={keyOf(m)}
        onClick={() => pick(m)}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors hover:bg-hover ${touch ? "py-2" : "py-1.5"} ${active ? "bg-active" : ""}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate ${touch ? "text-[14.5px]" : "text-[13px]"} text-ink`}>{cleanName(m)}</span>
            {freeTag && isFree(m) && <span className="shrink-0 rounded-full bg-ok-soft px-1.5 py-px text-[10.5px] font-medium text-ok">Free</span>}
          </span>
          {showProvider && <span className="block truncate text-[12px] text-muted">{providerName(m.providerID)}</span>}
        </span>
        <span className="shrink-0 text-[11.5px] text-faint tabular-nums" title={`${m.limit.context.toLocaleString()} token context`}>
          {compactNumber(m.limit.context)}
        </span>
        <Check size={14} className={`shrink-0 text-ink-2 ${active ? "" : "invisible"}`} />
      </button>
    );
  };

  const LIMIT = 6;
  return (
    <div className="flex max-h-[var(--pop-max,100%)] flex-col">
      {info && info.variants?.length > 0 && !term && (
        <div className="border-b border-line px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[12px] text-muted">
            <span className="truncate">
              Effort for <span className="text-ink-2">{cleanName(info)}</span>
            </span>
          </div>
          <div className="flex gap-1 rounded-lg bg-hover p-0.5">
            {info.variants.map((v) => (
              <button
                key={v.id}
                onClick={() => void setModel({ providerID: info.providerID, id: info.id, variant: v.id }, sessionId)}
                className={`flex-1 rounded-md px-2 text-[12.5px] transition-colors ${touch ? "py-1.5" : "py-1"} ${(ref?.variant ?? "default") === v.id ? "bg-raised font-medium text-ink shadow-soft" : "text-muted hover:text-ink"}`}
              >
                {cap(v.id)}
              </button>
            ))}
          </div>
        </div>
      )}
      {(usable.length > 8 || term) && (
        <div className="border-b border-line p-2">
          <div className={`field flex items-center gap-2 rounded-lg px-2.5 ${touch ? "h-9" : "h-8"}`}>
            <Search size={14} className="text-faint" />
            <input
              // No keyboard popping up over the list on phones; tap to search.
              data-autofocus={touch ? undefined : true}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search models"
              className={`min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint ${touch ? "text-[16px]" : "text-[13px]"}`}
            />
          </div>
        </div>
      )}
      <div className="scroll-quiet max-h-[420px] min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {models.length === 0 && (
          <div className="p-6 text-center text-[13px] text-muted" title={catalog === "degraded" ? catalogError : undefined}>
            {catalog === "ready" ? "No models yet. Connect a provider in Settings." : catalog === "degraded" ? "Models didn't load. Reconnect to try again." : "Loading models…"}
          </div>
        )}
        {models.length > 0 && groups.length === 0 && <div className="p-6 text-center text-[13px] text-muted">No models match "{q}".</div>}
        {recentModels.length > 0 && (
          <div className="mb-1">
            <div className="px-2.5 pt-2 pb-1 text-[12px] font-medium text-muted">Recent</div>
            {recentModels.map((m) => row(m, true))}
          </div>
        )}
        {groups.map(([provider, ms]) => {
          const all = term || expanded[provider];
          const shown = all ? ms : ms.slice(0, LIMIT);
          // Keep the model in use visible even when its group is folded.
          const current = !all && ref ? ms.find((m) => m.providerID === ref.providerID && m.id === ref.id && !shown.includes(m)) : undefined;
          const allFree = ms.every(isFree);
          return (
            <div key={provider} className="mb-1">
              <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[12px] font-medium text-muted">
                {providerName(provider)}
                {allFree && <span className="font-normal text-ok">· all free</span>}
              </div>
              {shown.map((m) => row(m, false, !allFree))}
              {current && row(current, false, !allFree)}
              {!all && ms.length > LIMIT && (
                <button onClick={() => setExpanded((e) => ({ ...e, [provider]: true }))} className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-muted hover:bg-hover hover:text-ink">
                  Show {ms.length - shown.length - (current ? 1 : 0)} more
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AgentPicker({ sessionId }: { sessionId: string | null }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const agents = useChat((s) => s.agents);
  const picked = useChat((s) => s.pickedAgent);
  const sessionAgent = useChat((s) => (sessionId ? s.sessions[sessionId]?.agent : undefined));
  const setAgent = useChat((s) => s.setAgent);
  const current = sessionAgent ?? picked ?? "";
  const refreshCatalog = useChat((s) => s.refreshCatalog);
  const roster = useTeammates((s) => s.byId);
  const name = useAgentName(current);
  // Teammates first, in the order they joined; then the remaining agents.
  const primary = useMemo(() => {
    const list = agents.filter((a) => a.mode !== "subagent" && !a.hidden && isOfferedAgent(a.id));
    const joined = (id: string) => roster?.[id]?.created ?? Infinity;
    return list.map((a, i) => ({ a, i })).sort((x, y) => joined(x.a.id) - joined(y.a.id) || x.i - y.i).map((x) => x.a);
  }, [agents, roster]);
  const info = agents.find((a) => a.id === current);
  // Loaded but nothing to talk to yet: the chip becomes the way to add a teammate.
  const empty = !current && roster !== null;
  // The face on the chip shows what this session's agent is doing.
  const state = useChat((s) => {
    const id = s.activeId;
    if (!id) return "idle" as const;
    if (Object.values(s.permissions).some((p) => p.sessionID === id) || Object.values(s.forms).some((f) => f.sessionID === id)) return "needs" as const;
    return s.busy[id] ? ("working" as const) : ("idle" as const);
  });
  useEffect(() => {
    if (open && agents.length === 0) void refreshCatalog();
  }, [open, agents.length, refreshCatalog]);
  return (
    <>
      <button
        ref={anchor}
        onClick={() => (empty ? useUI.getState().openSettings("agents") : setOpen((v) => !v))}
        title={empty ? "Add a teammate" : "Switch agent (Tab)"}
        aria-label={empty ? "Add a teammate" : `Agent: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] hover:bg-hover hover:text-ink ${empty ? "text-ink" : "text-ink-2"}`}
      >
        <AgentMark id={current} color={info?.color} size={roster?.[current] ? 18 : 12} state={state} />
        {empty ? "Add a teammate" : name}
        <ChevronDown size={13} className="text-faint" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="top-start" width={280}>
        <div role="menu" className="scroll-quiet max-h-[min(50vh,var(--pop-max))] overflow-y-auto p-1.5">
          {primary.length === 0 && (
            <div className="flex justify-center py-4 text-muted">
              <Spinner />
            </div>
          )}
          {primary.map((a) => (
            <MenuItem
              key={a.id}
              active={a.id === current}
              icon={<AgentMark id={a.id} color={a.color} size={roster?.[a.id] ? 20 : 12} />}
              label={roster?.[a.id]?.name ?? a.name}
              hint={roster?.[a.id] ? roster[a.id].job || undefined : a.description}
              right={<Check size={14} className={`text-ink-2 ${a.id === current ? "" : "invisible"}`} />}
              onClick={() => {
                void setAgent(a.id, sessionId);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </Popover>
    </>
  );
}

/**
 * Project folder for new sessions: the server's home (~/projects on Boat),
 * folders used lately, the home's folders, or browse anywhere. Can also clone
 * a git repo or create a folder.
 */
/** Per workspace: paths from one machine mean nothing on another. */
const recentDirsKey = () => wsKey("projects.recent");

export function ProjectPicker({ disabled }: { disabled?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const client = useChat((s) => s.client);
  const home = useChat((s) => s.homeDir);
  const dir = useChat((s) => s.projectDir);
  const setProjectDir = useChat((s) => s.setProjectDir);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [mode, setMode] = useState<"list" | "clone" | "new">("list");
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);
  const touch = useTouch();
  const homeBase = home?.replace(/\/$/, "") ?? "";

  useEffect(() => {
    if (!open) return;
    void kv.get<string[]>(recentDirsKey()).then((r) => setRecent(r ?? []));
    if (!client || !home) return;
    setFolders(null);
    client
      .listFolders(home, home)
      .then((list) => setFolders(list.map((e) => e.name).filter((n) => !n.startsWith(".")).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))))
      .catch(() => setFolders([]));
  }, [open, client, home]);

  const current = dir ?? home;

  const setDir = (d: string | null) => {
    setProjectDir(d);
    if (!d || d === home) return;
    const key = recentDirsKey();
    void kv.get<string[]>(key).then((r) => {
      const next = [d, ...(r ?? []).filter((x) => x !== d)].slice(0, 8);
      setRecent(next);
      void kv.set(key, next);
    });
  };

  async function runInHome(cmd: string, target: string) {
    if (!client || !home) return;
    setWorking(true);
    try {
      const r = await client.runShell(cmd, home);
      const id = r.data.id;
      for (let i = 0; i < 240; i++) {
        const info = await client.shellInfo(id);
        if (info.status !== "running") {
          if (info.status !== "exited" || (info.exit ?? 0) !== 0) throw new Error("Command failed. Check the URL and access.");
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      setDir(`${homeBase}/${target}`);
      setOpen(false);
      setMode("list");
      setInput("");
      toast({ tone: "ok", title: `Ready: ${target}` });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't set up the folder", body: (e as Error).message });
    } finally {
      setWorking(false);
    }
  }

  // Recent folders that aren't already one of home's direct children.
  const recentOther = recent.filter((r) => r !== home && !(r.startsWith(homeBase + "/") && !r.slice(homeBase.length + 1).includes("/") && folders?.includes(r.slice(homeBase.length + 1))));

  return (
    <>
      <button
        ref={anchor}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Project folder: ${current ? prettyPath(current, home) : "projects"}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 max-w-[220px] items-center gap-1.5 rounded-full px-2.5 text-[13px] text-muted transition-colors hover:text-ink disabled:pointer-events-none"
      >
        <Folder size={13} className="shrink-0" />
        <span className="truncate">{current ? (current === home ? "projects" : basename(current)) : "projects"}</span>
        {!disabled && <ChevronDown size={12} className="shrink-0 opacity-60" />}
      </button>
      <Popover
        open={open}
        onClose={() => {
          setOpen(false);
          setMode("list");
        }}
        anchor={anchor.current}
        placement="bottom-start"
        width={320}
        label="Project folder"
      >
        {mode === "list" ? (
          <div className="flex max-h-[var(--pop-max)] flex-col p-1.5" role="menu">
            <div className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold text-faint">Work in</div>
            <MenuItem icon={<Folder size={14} />} label="projects" hint={prettyPath(home ?? "", home)} active={!dir || dir === home} onClick={() => (setDir(null), setOpen(false))} />
            {recentOther.length > 0 && (
              <>
                <div className="px-2.5 pt-2 pb-1 text-[12px] font-semibold text-faint">Recent</div>
                {recentOther.slice(0, 4).map((r) => (
                  <MenuItem key={r} icon={<History size={14} />} label={basename(r)} hint={prettyPath(r, home)} active={dir === r} onClick={() => (setDir(r), setOpen(false))} />
                ))}
              </>
            )}
            {(folders === null || folders.length > 0) && <div className="px-2.5 pt-2 pb-1 text-[12px] font-semibold text-faint">In {prettyPath(home ?? "", home)}</div>}
            <div className="scroll-quiet min-h-[60px] shrink overflow-y-auto">
              {folders === null ? (
                <div className="flex justify-center py-3 text-muted">
                  <Spinner />
                </div>
              ) : (
                folders.map((f) => {
                  const full = `${homeBase}/${f}`;
                  return <MenuItem key={f} icon={<FolderGit2 size={14} />} label={f} active={dir === full} onClick={() => (setDir(full), setOpen(false))} />;
                })
              )}
            </div>
            <div className="my-1 h-px shrink-0 bg-line" />
            <div className="shrink-0">
              <MenuItem
                icon={<FolderSearch size={14} />}
                label="Browse folders…"
                hint="Any folder on the server"
                onClick={() => {
                  setOpen(false);
                  setBrowsing(true);
                }}
              />
              <MenuItem icon={<GitBranchPlus size={14} />} label="Clone a repository…" onClick={() => setMode("clone")} />
              <MenuItem icon={<FolderPlus size={14} />} label="New folder…" onClick={() => setMode("new")} />
            </div>
          </div>
        ) : (
          <form
            className="p-3"
            onSubmit={(e) => {
              e.preventDefault();
              const v = input.trim();
              if (!v) return;
              if (mode === "clone") {
                const name = basename(v).replace(/\.git$/, "") || "repo";
                void runInHome(`git clone --depth 50 ${JSON.stringify(v)} ${JSON.stringify(name)}`, name);
              } else {
                const name = v.replace(/[^\w.-]+/g, "-");
                void runInHome(`mkdir -p ${JSON.stringify(name)} && cd ${JSON.stringify(name)} && git init -q`, name);
              }
            }}
          >
            <div className="mb-2 text-[13px] font-medium">{mode === "clone" ? "Clone a repository" : "New folder"}</div>
            <input
              data-autofocus
              autoFocus
              aria-label={mode === "clone" ? "Repository URL" : "Folder name"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === "clone" ? "https://github.com/user/repo" : "my-app"}
              className="field h-9 w-full rounded-lg px-3 text-[13px] outline-none"
            />
            {mode === "clone" && <p className="mt-1.5 text-[12px] text-muted">Private repos need git credentials on the sandbox.</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-2.5 py-1 text-[12.5px] text-muted hover:bg-hover" onClick={() => setMode("list")}>
                Back
              </button>
              <button type="submit" disabled={working || !input.trim()} className="flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1 text-[12.5px] font-medium text-bg disabled:opacity-50">
                {working && <Spinner size={12} />}
                {mode === "clone" ? "Clone" : "Create"}
              </button>
            </div>
          </form>
        )}
      </Popover>
      <FolderBrowser
        open={browsing}
        onClose={() => setBrowsing(false)}
        start={current}
        compact={touch && window.innerWidth < 640}
        onPick={(d) => {
          setDir(d === home ? null : d);
          setBrowsing(false);
        }}
      />
    </>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}


