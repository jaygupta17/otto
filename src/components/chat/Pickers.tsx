import { Check, ChevronDown, Folder, FolderGit2, FolderPlus, GitBranchPlus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelInfo } from "@opencode/client";
import { useChat } from "../../state/chat";
import { agentColor } from "../../lib/agentColor";
import { Popover, MenuItem } from "../ui/Popover";
import { Sheet } from "../ui/Sheet";
import { useTouch } from "../../hooks/useMedia";
import { kv } from "../../lib/kv";
import { Spinner } from "../ui/AgentClock";
import { basename, compactNumber, prettyPath } from "../../lib/format";
import type { ModelRef } from "../../lib/opencode/client";
import { toast } from "../../state/ui";

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
 * models used lately, then every provider's catalog. A popover on desktop,
 * a bottom sheet on phones.
 */
export function ModelPicker({ sessionId, compact = false }: { sessionId: string | null; compact?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { ref, info } = useCurrentModel(sessionId);
  const label = info ? cleanName(info) : (ref?.id ?? "Choose model");
  const variant = ref?.variant && ref.variant !== "default" ? ref.variant : null;
  // A narrow desktop window still gets the popover; the sheet is for phones.
  const touch = useTouch();
  const sheet = compact && touch;

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
      {sheet ? (
        <Sheet open={open} onClose={() => setOpen(false)} compact title="Model">
          <ModelMenu sessionId={sessionId} touch onDone={() => setOpen(false)} />
        </Sheet>
      ) : (
        <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="top-end" width={Math.min(360, window.innerWidth - 16)}>
          <ModelMenu sessionId={sessionId} onDone={() => setOpen(false)} />
        </Popover>
      )}
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
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors hover:bg-hover ${touch ? "py-2.5" : "py-1.5"} ${active ? "bg-active" : ""}`}
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`truncate ${touch ? "text-[15px]" : "text-[13px]"} text-ink`}>{cleanName(m)}</span>
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
    <div className="flex max-h-[inherit] flex-col">
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
                className={`flex-1 rounded-md px-2 text-[12.5px] transition-colors ${touch ? "py-2" : "py-1"} ${(ref?.variant ?? "default") === v.id ? "bg-raised font-medium text-ink shadow-soft" : "text-muted hover:text-ink"}`}
              >
                {cap(v.id)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="border-b border-line p-2">
        <div className={`field flex items-center gap-2 rounded-lg px-2.5 ${touch ? "h-10" : "h-8"}`}>
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
      <div className={`scroll-quiet overflow-y-auto p-1.5 ${touch ? "" : "max-h-[min(420px,55vh)]"}`}>
        {models.length === 0 && <div className="p-6 text-center text-[13px] text-muted">No models yet. Connect a provider in Settings.</div>}
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
  const current = sessionAgent ?? picked;
  const refreshCatalog = useChat((s) => s.refreshCatalog);
  const primary = agents.filter((a) => a.mode !== "subagent" && !a.hidden);
  const info = agents.find((a) => a.id === current);
  useEffect(() => {
    if (open && agents.length === 0) void refreshCatalog();
  }, [open, agents.length, refreshCatalog]);
  return (
    <>
      <button ref={anchor} onClick={() => setOpen((v) => !v)} title="Switch agent (Tab)" className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover hover:text-ink">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: agentColor(current, info?.color) }} />
        {info?.name ?? cap(current)}
        <ChevronDown size={13} className="text-faint" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="top-start" width={280}>
        <div className="scroll-quiet max-h-[50vh] overflow-y-auto p-1.5">
          {primary.length === 0 && (
            <div className="flex justify-center py-4 text-muted">
              <Spinner />
            </div>
          )}
          {primary.map((a) => (
            <MenuItem
              key={a.id}
              active={a.id === current}
              icon={<span className="h-2 w-2 rounded-full" style={{ background: agentColor(a.id, a.color) }} />}
              label={a.name}
              hint={a.description}
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
 * Project folder for new sessions. Lists folders in the server's home
 * (~/projects on Boat) and can clone a git repo or create a folder.
 */
export function ProjectPicker({ disabled }: { disabled?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const client = useChat((s) => s.client);
  const home = useChat((s) => s.homeDir);
  const dir = useChat((s) => s.projectDir);
  const setDir = useChat((s) => s.setProjectDir);
  const [folders, setFolders] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"list" | "clone" | "new">("list");
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open || !client || !home) return;
    setFolders(null);
    client
      .listDir(home, home)
      .then((list) => setFolders(list.filter((e) => e.type === "directory" && !e.path.startsWith(".")).map((e) => e.path.replace(/\/$/, ""))))
      .catch(() => setFolders([]));
  }, [open, client, home]);

  const current = dir ?? home;

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
      setDir(`${home.replace(/\/$/, "")}/${target}`);
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

  return (
    <>
      <button
        ref={anchor}
        disabled={disabled}
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
        width={300}
      >
        {mode === "list" ? (
          <div className="p-1.5">
            <div className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold text-faint ">Work in</div>
            <MenuItem icon={<Folder size={14} />} label="projects" hint={prettyPath(home ?? "", home)} active={!dir || dir === home} onClick={() => (setDir(null), setOpen(false))} />
            {folders === null ? (
              <div className="flex justify-center py-3 text-muted">
                <Spinner />
              </div>
            ) : (
              folders.map((f) => {
                const full = `${home?.replace(/\/$/, "")}/${f}`;
                return <MenuItem key={f} icon={<FolderGit2 size={14} />} label={f} active={dir === full} onClick={() => (setDir(full), setOpen(false))} />;
              })
            )}
            <div className="my-1 h-px bg-line" />
            <MenuItem icon={<GitBranchPlus size={14} />} label="Clone a repository…" onClick={() => setMode("clone")} />
            <MenuItem icon={<FolderPlus size={14} />} label="New folder…" onClick={() => setMode("new")} />
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
    </>
  );
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}


