import { AnimatePresence } from "motion/react";
import { Check, ChevronsUpDown, PanelLeft, Plus, Search, Settings, SquarePen, Cloud, Server, AlarmClock, Bot, Laptop } from "lucide-react";
import { UpdatePill } from "./UpdateControls";
import { useMemo, useRef, useState } from "react";
import type { SessionInfo } from "@opencode/client";
import { sortedSessions, useChat } from "../../state/chat";
import { useTeammates } from "../../state/teammates";
import { isOfferedAgent } from "../../lib/teammates";
import { AgentRows, type AgentGroup } from "./AgentRows";
import { SessionRow } from "./SessionRow";
import { useConnection } from "../../state/connection";
import { useActiveWorkspace, useWorkspaces } from "../../state/workspaces";
import { useUI } from "../../state/ui";
import { useNow } from "../../hooks/useNow";
import { IconButton } from "../ui/Button";
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
        className="mx-3 flex h-8 shrink-0 items-center gap-2 rounded-lg bg-hover px-2.5 text-left text-[13px] text-muted transition-colors hover:bg-active"
      >
        <Search size={14} className="shrink-0" />
        <span className="flex-1">Search</span>
        <kbd className="font-sans text-[11px] text-muted">{kbd("⌘K")}</kbd>
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
            <StatusDot status={status} />
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

/** Neutral provider tile; connection state is shown as text + StatusDot beside it. */
export function WorkspaceAvatar({ provider, size = 28 }: { provider: string; status?: string; size?: number }) {
  return (
    <div className="grid shrink-0 place-items-center rounded-lg border border-line bg-raised text-ink-2" style={{ width: size, height: size }}>
      <WorkspaceIcon provider={provider} size={Math.round(size * 0.5)} />
    </div>
  );
}

/** A cloud machine, this computer, or a server you run. */
export function WorkspaceIcon({ provider, size }: { provider: string; size: number }) {
  return provider === "local" ? <Laptop size={size} /> : provider === "custom" ? <Server size={size} /> : <Cloud size={size} />;
}

/** Static connection dot: green connected, red offline, amber while working on it. */
function StatusDot({ status }: { status: string }) {
  const color = status === "ready" ? "bg-ok" : status === "error" ? "bg-danger" : "bg-accent";
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${color}`} />;
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

export function groupOf(ts: number, now: number) {
  const d = new Date(ts);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (d >= today) return "Today";
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (d >= y) return "Yesterday";
  const w = new Date(today);
  w.setDate(w.getDate() - 7);
  if (d >= w) return "This week";
  return "Earlier";
}

function SessionList({ query, onNavigate }: { query: string; onNavigate?: () => void }) {
  const sessions = useChat((s) => s.sessions);
  const loaded = useChat((s) => s.sessionsLoaded);
  const busy = useChat((s) => s.busy);
  const pinned = useChat((s) => s.pinned);
  const catalog = useChat((s) => s.agents);
  const roster = useTeammates((s) => s.byId);
  const status = useConnection((s) => s.status);
  const now = useNow(true, 30_000);
  // Sessions split by teammate, so wait for the roster too: otherwise every session lands under a date first and then jumps.
  const ready = loaded && roster !== null;

  const { pins, rows, groups } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = sortedSessions(sessions).filter((s) => !q || (s.title ?? "").toLowerCase().includes(q) || s.location.directory.toLowerCase().includes(q));
    const pins = pinned.map((id) => list.find((s) => s.id === id)).filter((s): s is SessionInfo => !!s);
    const loose = list.filter((s) => !pinned.includes(s.id));

    // Searching is a flat list. Otherwise each agent gets a row: teammates in the order they joined, then other agents that have sessions.
    const teammates = Object.values(roster ?? {}).sort((a, b) => Number(b.leads) - Number(a.leads) || a.created - b.created || a.name.localeCompare(b.name));
    const teamIds = new Set(teammates.map((t) => t.id));
    const byAgent = new Map<string, SessionInfo[]>();
    const rest: SessionInfo[] = [];
    for (const s of loose) {
      const a = s.agent ?? "";
      const offered = teamIds.has(a) || (!!a && isOfferedAgent(a) && catalog.some((c) => c.id === a));
      if (!q && offered) byAgent.set(a, [...(byAgent.get(a) ?? []), s]);
      else rest.push(s);
    }
    const rows: AgentGroup[] = q
      ? []
      : [
          ...teammates.map((t) => ({ id: t.id, name: t.name, job: t.job, sessions: byAgent.get(t.id) ?? [] })),
          ...[...byAgent.keys()].filter((id) => !teamIds.has(id)).map((id) => ({ id, name: catalog.find((c) => c.id === id)?.name ?? id, sessions: byAgent.get(id) ?? [] })),
        ];

    const working = rest.filter((s) => busy[s.id]);
    const idle = rest.filter((s) => !busy[s.id]);
    const out: [string, SessionInfo[]][] = [];
    if (working.length) out.push(["Working", working]);
    for (const s of idle) {
      const g = groupOf(s.time.updated, now);
      const last = out[out.length - 1];
      if (last && last[0] === g) last[1].push(s);
      else out.push([g, [s]]);
    }
    return { pins, rows, groups: out };
  }, [sessions, busy, query, now, pinned, roster, catalog]);

  return (
    <div className="scroll-quiet mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {!ready && status === "ready" && (
        <div className="space-y-px" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-2.5 p-2" style={{ opacity: 1 - i * 0.13 }}>
              <div className="h-[30px] w-[30px] shrink-0 rounded-full bg-hover" />
              <div className="flex-1 space-y-1.5">
                <div className="h-2.5 w-20 rounded-full bg-hover" />
                <div className="h-2.5 w-32 rounded-full bg-hover" />
              </div>
            </div>
          ))}
        </div>
      )}
      {ready && pins.length === 0 && rows.length === 0 && groups.length === 0 && <div className="px-2 py-3 text-[13px] text-muted">{query ? `Nothing matches “${query}”.` : "Sessions you start appear here."}</div>}
      {ready && pins.length > 0 && <SessionGroup label="Pinned" list={pins} now={now} onNavigate={onNavigate} />}
      {ready && rows.length > 0 && (
        <div className="mt-1">
          <AgentRows groups={rows} now={now} onNavigate={onNavigate} />
        </div>
      )}
      {ready && groups.map(([label, list]) => (
        <SessionGroup key={label} label={label} list={list} now={now} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function SessionGroup({ label, list, now, onNavigate }: { label: string; list: SessionInfo[]; now: number; onNavigate?: () => void }) {
  return (
    <div className="mt-4 first:mt-1">
      <div className="flex items-center gap-1.5 px-2 pb-1 text-[12px] font-medium text-muted">
        {label}
        {label === "Working" && <span className="tabular-nums">{list.length}</span>}
      </div>
      <AnimatePresence initial={false}>
        {list.map((s) => (
          <SessionRow key={s.id} s={s} now={now} onNavigate={onNavigate} />
        ))}
      </AnimatePresence>
    </div>
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
        className={`${item} ${view === "schedules" ? "bg-active text-ink" : "text-ink-2 hover:bg-hover"}`}
        onClick={() => {
          setView("schedules");
          onNavigate?.();
        }}
      >
        <AlarmClock size={15} className="text-muted" /> Schedules
      </button>
      <button className={`${item} text-ink-2 hover:bg-hover`} onClick={() => openSettings("agents")}>
        <Bot size={15} className="text-muted" /> Agents & tools
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
