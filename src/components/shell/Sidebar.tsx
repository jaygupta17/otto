import { AnimatePresence, motion } from "motion/react";
import { Pin, PinOff, Check, ChevronsUpDown, MoreHorizontal, PanelLeft, Pencil, Plus, Search, Settings, SquarePen, Keyboard, GitFork, Trash2, Cloud, Server, AlarmClock, Bot, Laptop } from "lucide-react";
import { UpdatePill } from "./UpdateControls";
import { memo, useMemo, useRef, useState } from "react";
import type { SessionInfo } from "@opencode/client";
import { sortedSessions, useChat } from "../../state/chat";
import { useConnection } from "../../state/connection";
import { useActiveWorkspace, useWorkspaces } from "../../state/workspaces";
import { useUI } from "../../state/ui";
import { timeAgo, basename } from "../../lib/format";
import { deleteSession } from "../../lib/actions";
import { useNow } from "../../hooks/useNow";
import { IconButton } from "../ui/Button";
import { InboxButton } from "./Inbox";
import { Popover, MenuItem } from "../ui/Popover";
import { AgentClock } from "../ui/AgentClock";
import { useTrafficLights } from "../../hooks/useChrome";

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const toggle = useUI((s) => s.toggleSidebar);
  const mac = useTrafficLights();

  return (
    <div className="flex h-full w-full flex-col">
      <div className={`drag flex h-[52px] shrink-0 items-center gap-1 pr-2 ${mac ? "pl-[84px]" : "pl-3"}`} data-tauri-drag-region>
        <IconButton label="Hide sidebar (⌘B)" className="no-drag" onClick={() => toggle(false)}>
          <PanelLeft size={17} />
        </IconButton>
        <div className="flex-1" data-tauri-drag-region />
        <InboxButton className="no-drag" />
      </div>

      <div className="px-2">
        <WorkspaceSwitcher />
      </div>

      <NavLinks onNavigate={onNavigate} />
      <button
        onClick={() => useUI.getState().setPalette(true)}
        className="mx-2 mt-3 flex h-8 items-center gap-2 rounded-md px-2 text-left text-[13px] text-muted transition-colors hover:bg-hover hover:text-ink"
      >
        <Search size={14} className="shrink-0" />
        <span className="flex-1">Search</span>
        <kbd className="font-sans text-[12px] text-faint">⌘K</kbd>
      </button>
      <SessionList query="" onNavigate={onNavigate} />
      <UpdatePill />
      <SidebarFooter />
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const openSettings = useUI((s) => s.openSettings);
  const open = useChat((s) => s.open);
  const onHome = useChat((s) => s.activeId === null);
  const item = "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors";
  return (
    <div className="mt-2 px-2">
      <button
        className={`${item} ${view === "chat" && onHome ? "bg-active text-ink" : "text-ink-2 hover:bg-hover"}`}
        onClick={() => {
          open(null);
          onNavigate?.();
        }}
      >
        <SquarePen size={15} className="text-muted" /> New session
        <kbd className="ml-auto font-sans text-[12px] text-faint">⌘N</kbd>
      </button>
      <button
        className={`${item} ${view === "schedules" ? "bg-active text-ink" : "text-ink-2 hover:bg-hover"}`}
        onClick={() => {
          setView("schedules");
          onNavigate?.();
        }}
      >
        <AlarmClock size={15} className="text-muted" /> Scheduled
      </button>
      <button className={`${item} text-ink-2 hover:bg-hover`} onClick={() => openSettings("agents")}>
        <Bot size={15} className="text-muted" /> Agents & tools
      </button>
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
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} width={264}>
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

function groupOf(ts: number, now: number) {
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
  const status = useConnection((s) => s.status);
  const now = useNow(true, 30_000);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = sortedSessions(sessions).filter((s) => !q || (s.title ?? "").toLowerCase().includes(q) || s.location.directory.toLowerCase().includes(q));
    const pins = pinned.map((id) => list.find((s) => s.id === id)).filter((s): s is SessionInfo => !!s);
    const working = list.filter((s) => busy[s.id] && !pinned.includes(s.id));
    const rest = list.filter((s) => !busy[s.id] && !pinned.includes(s.id));
    const out: [string, SessionInfo[]][] = [];
    if (pins.length) out.push(["Pinned", pins]);
    if (working.length) out.push(["Working", working]);
    for (const s of rest) {
      const g = groupOf(s.time.updated, now);
      const last = out[out.length - 1];
      if (last && last[0] === g) last[1].push(s);
      else out.push([g, [s]]);
    }
    return out;
  }, [sessions, busy, query, now, pinned]);

  return (
    <div className="scroll-quiet mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      {!loaded && status === "ready" && (
        <div className="space-y-1 px-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-7 animate-pulse rounded-md bg-hover" style={{ opacity: 1 - i * 0.13 }} />
          ))}
        </div>
      )}
      {loaded && groups.length === 0 && <div className="px-2 py-3 text-[13px] text-muted">{query ? `Nothing matches “${query}”.` : "Sessions you start appear here."}</div>}
      {groups.map(([label, list]) => (
        <div key={label} className="mt-3 first:mt-1">
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
      ))}
    </div>
  );
}

const SessionRow = memo(function SessionRow({ s, now, onNavigate }: { s: SessionInfo; now: number; onNavigate?: () => void }) {
  const active = useChat((st) => st.activeId === s.id);
  const busy = useChat((st) => !!st.busy[s.id]);
  const unread = useChat((st) => !!st.unread[s.id]);
  const asking = useChat((st) => Object.values(st.permissions).some((p) => p.sessionID === s.id) || Object.values(st.forms).some((f) => f.sessionID === s.id));
  const open = useChat((st) => st.open);
  const rename = useChat((st) => st.rename);
  const isPinned = useChat((st) => st.pinned.includes(s.id));
  const togglePin = useChat((st) => st.togglePin);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const title = s.title || "New session";

  return (
    <motion.div layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          open(s.id);
          onNavigate?.();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
        className={`group relative flex h-8 items-center gap-2 rounded-md px-2 text-[13px] transition-colors ${active ? "bg-active text-ink" : "text-ink-2 hover:bg-hover"}`}
      >
        <span className="grid w-3.5 shrink-0 place-items-center" title={busy ? "Working" : asking ? "Needs you" : unread ? "New result" : s.outcome === "failed" ? "Failed" : undefined}>
          {busy ? <AgentClock size={12} /> : asking ? <span className="h-2 w-2 rounded-full bg-info" /> : unread ? <span className="h-1.5 w-1.5 rounded-full bg-ink" /> : s.outcome === "failed" ? <span className="h-1.5 w-1.5 rounded-full bg-danger" /> : null}
        </span>
        {editing ? (
          <input
            autoFocus
            defaultValue={title}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              setEditing(false);
              const v = e.target.value.trim();
              if (v && v !== title) void rename(s.id, v);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="field min-w-0 flex-1 rounded-md px-1.5 text-[13px] outline-none"
          />
        ) : (
          <span className={`min-w-0 flex-1 truncate ${unread || asking ? "font-medium text-ink" : ""}`}>{title}</span>
        )}
        <span className={`shrink-0 text-[12px] tabular-nums group-hover:hidden ${asking ? "text-info" : "text-faint"}`}>{busy ? "" : asking ? "Needs you" : timeAgo(s.time.updated, now)}</span>
        <button
          ref={more}
          onClick={(e) => {
            e.stopPropagation();
            setMenu(true);
          }}
          className="hidden h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-active hover:text-ink group-hover:grid"
          aria-label="Session actions"
        >
          <MoreHorizontal size={15} />
        </button>
      </div>
      <Popover open={menu} onClose={() => setMenu(false)} anchor={more.current} placement="bottom-end" width={200}>
        <div className="p-1.5">
          <div className="truncate px-2 pt-1 pb-1.5 text-[12px] text-muted">{basename(s.location.directory)}</div>
          <MenuItem
            icon={isPinned ? <PinOff size={14} /> : <Pin size={14} />}
            label={isPinned ? "Unpin" : "Pin"}
            onClick={() => {
              setMenu(false);
              togglePin(s.id);
            }}
          />
          <MenuItem
            icon={<Pencil size={14} />}
            label="Rename"
            onClick={() => {
              setMenu(false);
              setEditing(true);
            }}
          />
          <MenuItem
            icon={<GitFork size={14} />}
            label="Fork"
            onClick={() => {
              setMenu(false);
              void useChat.getState().fork(s.id, null);
            }}
          />
          <MenuItem
            icon={<Trash2 size={14} />}
            label="Delete"
            danger
            onClick={() => {
              setMenu(false);
              void deleteSession(s.id);
            }}
          />
        </div>
      </Popover>
    </motion.div>
  );
});

function SidebarFooter() {
  const openSettings = useUI((s) => s.openSettings);
  const busyCount = useChat((s) => Object.keys(s.busy).filter((id) => s.busy[id] && s.sessions[id]).length);
  const stream = useConnection((s) => s.stream);
  const status = useConnection((s) => s.status);
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 px-2">
      <IconButton label="Settings (⌘,)" onClick={() => openSettings()}>
        <Settings size={16} />
      </IconButton>
      <IconButton label="Keyboard shortcuts (⌘/)" onClick={() => useUI.getState().setShortcuts(true)}>
        <Keyboard size={16} />
      </IconButton>
      <div className="ml-auto flex items-center gap-1.5 px-2 text-[12px] text-muted tabular-nums">
        {busyCount > 0 ? (
          <>
            <AgentClock size={12} /> {busyCount} working
          </>
        ) : status === "ready" && stream !== "live" ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Reconnecting
          </>
        ) : null}
      </div>
    </div>
  );
}
