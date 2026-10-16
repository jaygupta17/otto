import { motion } from "motion/react";
import { Pin, PinOff, MoreHorizontal, Pencil, GitFork, Trash2 } from "lucide-react";
import { memo, useRef, useState } from "react";
import type { SessionInfo } from "@opencode/client";
import { asksFor, useChat } from "../../state/chat";
import { timeAgo, basename } from "../../lib/format";
import { deleteSession } from "../../lib/actions";
import { Popover, MenuItem } from "../ui/Popover";
import { AgentClock } from "../ui/AgentClock";

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
          <StatusDot busy={busy} asking={asking} unread={unread} failed={s.outcome === "failed"} />
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

