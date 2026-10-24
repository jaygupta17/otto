import { motion } from "motion/react";
import { Pin, PinOff, MoreHorizontal, Pencil, GitFork, Trash2 } from "lucide-react";
import { memo, useRef, useState } from "react";
import type { SessionInfo } from "@opencode/client";
import { asksFor, useChat } from "../../state/chat";
import { timeAgo, basename } from "../../lib/format";
import { deleteSession } from "../../lib/actions";
import { Popover, MenuItem } from "../ui/Popover";
import { AgentClock } from "../ui/AgentClock";
import { Pip } from "../ui/Pip";
import { useAgentName } from "../../state/teammates";
import { useFace } from "../../state/face";
import { useBackgroundLine, useDoing } from "../../state/tiers";
import { AgentMark } from "../ui/Bird";
import { Spot, spot } from "../ui/Spot";

/** The one mark a session shows where there's no bird: working, needs you, failed, or a new result. */
export function SessionPip({ busy, asking, unread, failed }: { busy: boolean; asking: boolean; unread: boolean; failed: boolean }) {
  if (busy) return <AgentClock size={12} />;
  if (asking) return <Pip tone="needs" label="Needs you" />;
  if (failed) return <Pip tone="error" label="Didn't finish" />;
  if (unread) return <Pip tone="new" label="New result" />;
  return null;
}

/**
 * A session in the sidebar. Past ones are a line of text, never a face: faces
 * belong to the agents, so the eye can tell the team from the history without
 * reading. One that wants you (`face`) is the same raised card as on phones:
 * the agent's face and what it's doing right now; the open one is held in ice.
 */
export const SessionRow = memo(function SessionRow({ s, now, face, onNavigate }: { s: SessionInfo; now: number; face?: boolean; onNavigate?: () => void }) {
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
  const where = [agentName, basename(s.location.directory)].filter(Boolean).join(" · ");
  const mood = useFace(s.id);
  const doing = useDoing(s.id, !!face && busy);
  // Its turn is over but work it started is still going: still working, as far as you're concerned.
  const away = useBackgroundLine(s.id);

  return (
    <motion.div layout="position" aria-current={active ? "true" : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.15 }}>
      <div
        {...(face ? spot : {})}
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
        data-tone={face && asking && !active ? "needs" : undefined}
        className={
          face
            ? `bezel group flex items-center gap-3 rounded-[18px] py-2.5 pr-3 pl-2.5 text-left ${active ? "chip" : ""}`
            : `group relative flex items-center rounded-[10px] py-[7px] pr-2.5 pl-3 transition-colors ${active ? "chip" : "hover:bg-hover"}`
        }
      >
        {face && <Spot />}
        {face && <AgentMark id={s.agent} size={48} state={away && (mood === "idle" || mood === "done") ? "working" : mood} />}
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
              <span className={`min-w-0 flex-1 truncate text-ink ${face ? "text-[15px] leading-snug font-semibold" : `text-[14px] ${active || unread || asking ? "font-semibold" : "font-medium"}`}`}>{title}</span>
              <span className={`shrink-0 tabular-nums group-hover:invisible ${face ? "text-[12px] text-faint" : "text-[11px] text-muted font-mono"}`}>{timeAgo(s.time.updated, now)}</span>
            </span>
          )}
          {face ? (
            <span className="mt-0.5 flex items-center gap-2 text-[13px]">
              {asking ? (
                <span className="text-info">Needs you</span>
              ) : busy ? (
                <span className="shimmer min-w-0 truncate">{doing || (agentName ? `${agentName} is working` : "Working")}</span>
              ) : away ? (
                <span className="shimmer min-w-0 truncate">{away}</span>
              ) : unread ? (
                <>
                  <Pip tone={failed ? "error" : "new"} label={failed ? "Didn't finish" : "New result"} />
                  <span className="min-w-0 truncate text-ink-2">
                    {failed ? "Didn't finish" : "New result"}
                    {agentName && <span className="text-muted"> · {agentName}</span>}
                  </span>
                </>
              ) : (
                <span className="min-w-0 truncate text-muted">{where}</span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <span className={`min-w-0 flex-1 truncate text-[12.5px] ${asking ? "text-info" : failed ? "text-danger" : "text-muted"}`}>{asking ? "Needs you" : failed ? "Didn't finish" : where}</span>
              <SessionPip busy={busy || !!away} asking={asking} unread={unread} failed={false} />
            </span>
          )}
        </span>
        <button
          ref={more}
          onClick={(e) => {
            e.stopPropagation();
            setMenu(true);
          }}
          className="absolute top-2 right-2 hidden h-6 w-6 place-items-center rounded-md text-muted hover:bg-active hover:text-ink group-hover:grid"
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

