import { AnimatePresence } from "motion/react";
import { Check, ChevronsUpDown, PanelLeft, Plus, Search, Settings, SquarePen, Cloud, Server, AlarmClock, Bot, Laptop } from "lucide-react";
import { UpdatePill } from "./UpdateControls";
import { useMemo, useRef, useState } from "react";
import type { SessionInfo } from "@opencode/client";
import { useChat } from "../../state/chat";
import { useTeammates } from "../../state/teammates";
import { useOfferedAgents, useSessionTiers } from "../../state/tiers";
import { AgentRows } from "./AgentRows";
import { SessionRow } from "./SessionRow";
import { useConnection } from "../../state/connection";
import { useActiveWorkspace, useWorkspaces } from "../../state/workspaces";
import { useUI } from "../../state/ui";
import { useNow } from "../../hooks/useNow";
import { IconButton } from "../ui/Button";
import { Pip, connectionTone } from "../ui/Pip";
import { InboxButton } from "./Inbox";
import { Popover, MenuItem } from "../ui/Popover";
import { useTrafficLights } from "../../hooks/useChrome";
import { kbd } from "../../hooks/useShortcuts";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const toggle = useUI((s) => s.toggleSidebar);
  const open = useChat((s) => s.open);
  const mac = useTrafficLights();

  return (
    <div className="flex h-full w-full flex-col">
      <div className={`drag flex h-[52px] shrink-0 items-center gap-0.5 pr-2 ${mac ? "pl-[84px]" : "pl-3"}`} data-tauri-drag-region>
        <IconButton label="Hide sidebar" keys={kbd("⌘B")} className="no-drag" onClick={() => toggle(false)}>
          <PanelLeft size={17} />
        </IconButton>
        <div className="flex-1" data-tauri-drag-region />
        <InboxButton className="no-drag" />
        <IconButton
          label="New session" keys={kbd("⌘N")}
          className="no-drag"
          onClick={() => {
            open(null);
            onNavigate?.();
          }}
        >
          <SquarePen size={16} />
        </IconButton>
      </div>

      <button
        onClick={() => useUI.getState().setPalette(true)}
        className="field mx-3 flex h-8 shrink-0 items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-muted"
      >
        <Search size={14} className="shrink-0" />
        <span className="flex-1">Search</span>
        <kbd className="kbd">{kbd("⌘K")}</kbd>
      </button>
      <SessionList query="" onNavigate={onNavigate} />
      <UpdatePill />
      <SidebarFooter onNavigate={onNavigate} />
    </div>
  );
}

function WorkspaceSwitcher() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const ws = useActiveWorkspace();
  const all = useWorkspaces((s) => s.workspaces);
  const setActive = useWorkspaces((s) => s.setActive);
  const status = useConnection((s) => s.status);
  const openSettings = useUI((s) => s.openSettings);
  const addWs = useUI((s) => s.setAddWorkspace);

  return (
    <>
      <button ref={anchor} onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover">
        <WorkspaceAvatar provider={ws?.provider ?? "boat"} status={status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-ink">{ws?.name ?? "No workspace"}</div>
          <div className="flex items-center gap-1.5 truncate text-[12px] text-muted">
            <Pip tone={connectionTone(status)} />
            {statusText(status)}
          </div>
        </div>
        <ChevronsUpDown size={14} className="text-faint" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} width={264} placement="top-start">
        <div className="p-1.5">
          <div className="px-2 pt-1.5 pb-1 text-[12px] font-medium text-muted">Workspaces</div>
          {all.map((w) => (
            <MenuItem
              key={w.id}
              icon={<WorkspaceIcon provider={w.provider} size={14} />}
              label={w.name}
              hint={w.sandboxId ?? new URL(w.baseUrl).host}
              active={w.id === ws?.id}
              right={w.id === ws?.id ? <Check size={15} className="text-muted" /> : undefined}
              onClick={() => {
                void setActive(w.id);
                setOpen(false);
              }}
            />
          ))}
          <div className="my-1 h-px bg-line" />
          <MenuItem
            icon={<Plus size={14} />}
            label="Add workspace"
            onClick={() => {
              setOpen(false);
              addWs(true);
            }}
          />
          <MenuItem
            icon={<Settings size={14} />}
            label="Manage…"
            onClick={() => {
              setOpen(false);
              openSettings("workspaces");
            }}
          />
        </div>
      </Popover>
    </>
  );
}

/** Neutral provider tile; connection state is shown as text and a pip beside it. */
export function WorkspaceAvatar({ provider, size = 28 }: { provider: string; status?: string; size?: number }) {
  return (
    <div className="bezel grid shrink-0 place-items-center rounded-lg text-ink-2" style={{ width: size, height: size }}>
      <WorkspaceIcon provider={provider} size={Math.round(size * 0.5)} />
    </div>
  );
}

/** A cloud machine, this computer, or a server you run. */
export function WorkspaceIcon({ provider, size }: { provider: string; size: number }) {
  return provider === "local" ? <Laptop size={size} /> : provider === "custom" ? <Server size={size} /> : <Cloud size={size} />;
}


export function statusText(status: string) {
  switch (status) {
    case "ready":
      return "Connected";
    case "connecting":
      return "Connecting…";
    case "waking":
      return "Waking up…";
    case "repairing":
      return "Getting ready…";
    case "error":
      return "Offline";
    default:
      return "Idle";
  }
}

/**
 * The list in tiers, like the phone's: sessions that want you (raised, with
 * the agent's face and what it's doing), the agents to start something with
 * (a face and a name), then pinned and past sessions as lines of text.
 */
function SessionList({ query, onNavigate }: { query: string; onNavigate?: () => void }) {
  const loaded = useChat((s) => s.sessionsLoaded);
  const pinned = useChat((s) => s.pinned);
  const roster = useTeammates((s) => s.byId);
  const status = useConnection((s) => s.status);
  const now = useNow(true, 30_000);
  // Agents carry teammates' names and faces, so wait for the roster too: otherwise the list draws twice.
  const ready = loaded && roster !== null;
  const { active, recent } = useSessionTiers(query);
  const offered = useOfferedAgents();

  const { pins, rest, agents } = useMemo(() => {
    const pins = pinned.map((id) => recent.find((s) => s.id === id)).filter((s): s is SessionInfo => !!s);
    // Someone already on an active row isn't offered again under Agents.
    const on = new Set(active.map((s) => s.agent ?? ""));
    return { pins, rest: recent.filter((s) => !pinned.includes(s.id)), agents: query.trim() ? [] : offered.filter((a) => !on.has(a.id)) };
  }, [active, recent, pinned, offered, query]);

  return (
    <div className="scroll-quiet mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {!ready && status === "ready" && (
        <div className="space-y-1" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-3 py-2 pr-2.5 pl-2" style={{ opacity: 1 - i * 0.13 }}>
              <div className="h-10 w-10 shrink-0 rounded-full bg-hover" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 w-20 rounded-full bg-hover" />
                <div className="h-2.5 w-32 rounded-full bg-hover" />
              </div>
            </div>
          ))}
        </div>
      )}
      {ready && active.length + agents.length + recent.length === 0 && <div className="px-2 py-3 text-[13px] text-muted">{query ? `Nothing matches “${query}”.` : "Sessions you start appear here."}</div>}
      {ready && active.length > 0 && (
        <SessionGroup label="Active">
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {active.map((s) => (
                <SessionRow key={s.id} s={s} now={now} face onNavigate={onNavigate} />
              ))}
            </AnimatePresence>
          </div>
        </SessionGroup>
      )}
      {ready && agents.length > 0 && (
        <SessionGroup label="Agents">
          <AgentRows agents={agents} onNavigate={onNavigate} />
        </SessionGroup>
      )}
      {ready && pins.length > 0 && <SessionGroup label="Pinned" list={pins} now={now} onNavigate={onNavigate} />}
      {ready && rest.length > 0 && <SessionGroup label="Recent" list={rest} now={now} onNavigate={onNavigate} />}
    </div>
  );
}

function SessionGroup({ label, list, now, onNavigate, children }: { label: string; list?: SessionInfo[]; now?: number; onNavigate?: () => void; children?: React.ReactNode }) {
  return (
    <section className="mt-7 first:mt-1">
      <h2 className="list-label px-2 pb-2">{label}</h2>
      {children ?? (
        <div className="space-y-0.5">
          <AnimatePresence initial={false}>
            {list?.map((s) => (
              <SessionRow key={s.id} s={s} now={now ?? Date.now()} onNavigate={onNavigate} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function SidebarFooter({ onNavigate }: { onNavigate?: () => void }) {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const openSettings = useUI((s) => s.openSettings);
  const item = "flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-[13px] transition-colors";
  return (
    <div className="shrink-0 border-t border-line px-2 pt-2 pb-2">
      <button
        className={`${item} ${view === "schedules" ? "chip font-medium text-ink" : "text-ink-2 hover:bg-hover"}`}
        onClick={() => {
          setView("schedules");
          onNavigate?.();
        }}
      >
        <AlarmClock size={15} className="text-accent-ink" /> Schedules
      </button>
      <button className={`${item} text-ink-2 hover:bg-hover`} onClick={() => openSettings("agents")}>
        <Bot size={15} className="text-accent-ink" /> Agents & tools
      </button>
      <div className="mt-1 flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher />
        </div>
        <IconButton label="Settings" keys={kbd("⌘,")} onClick={() => openSettings()}>
          <Settings size={16} />
        </IconButton>
      </div>
    </div>
  );
}
