import { motion } from "motion/react";
import { Pin, PinOff, MoreHorizontal, Pencil, GitFork, Trash2, MessageCircle } from "lucide-react";
import { memo, useRef, useState } from "react";
import type { SessionInfo } from "@opencode/client";
import { asksFor, useChat } from "../../state/chat";
import { timeAgo, basename } from "../../lib/format";
import { deleteSession } from "../../lib/actions";
import { Popover, MenuItem } from "../ui/Popover";
import { AgentClock } from "../ui/AgentClock";
import { AgentMark } from "../ui/TeammateFace";
import { useAgentName, useTeammate } from "../../state/teammates";

/** The one mark a session shows: working, needs you, new result, or failed. */
export function StatusDot({ busy, asking, unread, failed }: { busy: boolean; asking: boolean; unread: boolean; failed: boolean }) {
  if (busy) return <AgentClock size={12} />;
  if (asking) return <span className="h-2 w-2 rounded-full bg-info" />;
  if (unread) return <span className="h-1.5 w-1.5 rounded-full bg-ink" />;
  if (failed) return <span className="h-1.5 w-1.5 rounded-full bg-danger" />;
  return null;
}

export const SessionRow = memo(function SessionRow({ s, now, onNavigate }: { s: SessionInfo; now: number; onNavigate?: () => void }) {
  const active = useChat((st) => st.activeId === s.id);
  const busy = useChat((st) => !!st.busy[s.id]);
  const unread = useChat((st) => !!st.unread[s.id]);
  const asking = useChat((st) => Object.values(st.permissions).some((p) => asksFor(st.parents, p.sessionID, s.id)) || Object.values(st.forms).some((f) => asksFor(st.parents, f.sessionID, s.id)));
  const open = useChat((st) => st.open);
  const rename = useChat((st) => st.rename);
  const isPinned = useChat((st) => st.pinned.includes(s.id));
  const togglePin = useChat((st) => st.togglePin);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const more = useRef<HTMLButtonElement>(null);
  const title = s.title || "New session";
  const failed = s.outcome === "failed";
  const agentName = useAgentName(s.agent);
  // Teammates show their face; plain agents get a neutral chat tile so the column of avatars stays even.
  const face = !!useTeammate(s.agent);

  return (
    <motion.div layout="position" aria-current={active ? "true" : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }}>
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
        className={`group relative flex items-center gap-2.5 rounded-lg py-2 pr-2 pl-2 transition-colors ${active ? "bg-active" : "hover:bg-hover"}`}
      >
        {face ? (
          <AgentMark id={s.agent} size={30} state={busy ? "working" : asking ? "needs" : unread ? "done" : "idle"} />
        ) : (
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-hover text-muted">
            <MessageCircle size={14} />
          </span>
        )}
        <span className="min-w-0 flex-1">
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
              className="field w-full rounded-md px-1.5 text-[13px] outline-none"
            />
          ) : (
            <span className="flex items-baseline gap-2">
              <span className={`min-w-0 flex-1 truncate text-[13px] text-ink ${active || unread || asking ? "font-semibold" : "font-medium"}`}>{title}</span>
              <span className="shrink-0 text-[11px] text-muted tabular-nums group-hover:invisible">{busy ? <AgentClock size={11} /> : timeAgo(s.time.updated, now)}</span>
            </span>
          )}
          <span className="flex items-center gap-2">
            <span className={`min-w-0 flex-1 truncate text-[12px] ${asking ? "text-info" : failed ? "text-danger" : "text-muted"}`}>{asking ? "Needs you" : failed ? "Didn't finish" : agentName || basename(s.location.directory)}</span>
            {!asking && unread && !busy && <span className="h-2 w-2 shrink-0 rounded-full bg-ink" aria-label="New result" />}
          </span>
        </span>
        <button
          ref={more}
          onClick={(e) => {
            e.stopPropagation();
            setMenu(true);
          }}
          className="absolute top-1.5 right-1.5 hidden h-6 w-6 place-items-center rounded-md text-muted hover:bg-active hover:text-ink group-hover:grid"
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

