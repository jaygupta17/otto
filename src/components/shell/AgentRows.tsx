import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, SquarePen } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { SessionInfo } from "@opencode/client";
import { asksFor, useChat } from "../../state/chat";
import { timeAgo } from "../../lib/format";
import { AgentMark } from "../ui/TeammateFace";
import { useTeammate } from "../../state/teammates";
import { AgentClock } from "../ui/AgentClock";
import { SessionRow } from "./SessionRow";

/** Sessions shown under a row before "Show all". */
const SHOWN = 6;

export interface AgentGroup {
  id: string;
  name: string;
  /** Teammates have a job; plain agents don't. */
  job?: string;
  /** Newest first. Pinned sessions are listed under Pinned instead. */
  sessions: SessionInfo[];
}

/** One row per agent: who it is, what it's doing, and its sessions on expand. */
export function AgentRows({ groups, now, onNavigate }: { groups: AgentGroup[]; now: number; onNavigate?: () => void }) {
  return (
    <div className="space-y-0.5">
      {groups.map((g) => (
        <AgentRow key={g.id} group={g} now={now} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

const AgentRow = memo(function AgentRow({ group: g, now, onNavigate }: { group: AgentGroup; now: number; onNavigate?: () => void }) {
  const open = useChat((s) => s.agentRowsOpen.includes(g.id));
  const toggle = useChat((s) => s.toggleAgentRow);
  const busyCount = useChat((s) => g.sessions.reduce((n, x) => n + (s.busy[x.id] ? 1 : 0), 0));
  const asking = useChat((s) => g.sessions.some((x) => Object.values(s.permissions).some((p) => asksFor(s.parents, p.sessionID, x.id)) || Object.values(s.forms).some((f) => asksFor(s.parents, f.sessionID, x.id))));
  const unread = useChat((s) => g.sessions.some((x) => !!s.unread[x.id]));
  // A teammate's face carries its state itself; plain agents keep the clock.
  const face = !!useTeammate(g.id);
  const state = asking ? "needs" : busyCount ? "working" : unread ? "done" : "idle";
  const onActive = useChat((s) => g.sessions.some((x) => x.id === s.activeId));
  const [all, setAll] = useState(false);

  // Opening a session opens its agent's row, so the session is never hidden.
  useEffect(() => {
    if (onActive) toggle(g.id, true);
  }, [onActive, g.id, toggle]);

  const latest = g.sessions[0];
  const shown = all ? g.sessions : g.sessions.slice(0, SHOWN);
  const preview = latest ? latest.title || "New session" : g.job || "No sessions yet";

  // New work starts in the agent's current session; with none yet, a fresh draft.
  function openAgent() {
    const st = useChat.getState();
    if (latest) st.open(latest.id);
    else {
      void st.setAgent(g.id, null);
      st.open(null);
    }
    onNavigate?.();
  }

  function startNew() {
    const st = useChat.getState();
    void st.setAgent(g.id, null);
    st.open(null);
    onNavigate?.();
  }

  return (
    <div>
      <div className="group flex items-center gap-0.5 rounded-md pr-1 hover:bg-hover">
        <button
          type="button"
          onClick={() => toggle(g.id)}
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} ${g.name}'s sessions`}
          className="grid h-9 w-6 shrink-0 place-items-center text-muted hover:text-ink"
        >
          <ChevronRight size={13} className={`transition-transform duration-150 ${open ? "rotate-90" : ""}`} />
        </button>
        <button
          type="button"
          onClick={openAgent}
          className={`flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left ${onActive ? "text-ink" : "text-ink-2"}`}
        >
          <AgentMark id={g.id} size={22} state={state} />
          <span className="min-w-0 flex-1">
            <span className={`block truncate text-[13px] ${onActive || unread || asking ? "font-medium text-ink" : ""}`}>{g.name}</span>
            <span className="block truncate text-[12px] text-faint">{preview}</span>
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-1.5 text-[12px] tabular-nums group-hover:hidden" title={busyCount ? "Working" : asking ? "Needs you" : undefined}>
          {busyCount > 0 && (
            <span className="flex items-center gap-1 text-muted">
              {!face && <AgentClock size={12} />}
              {busyCount > 1 && busyCount}
            </span>
          )}
          {asking && <span className="flex items-center gap-1 text-info">Needs you</span>}
          {!busyCount && !asking && unread && !face && <span className="h-1.5 w-1.5 rounded-full bg-ink" />}
          {!busyCount && !asking && latest && <span className="text-faint">{timeAgo(latest.time.updated, now)}</span>}
        </span>
        <button
          type="button"
          onClick={startNew}
          aria-label={`New session with ${g.name}`}
          title={`New session with ${g.name}`}
          className="hidden h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-active hover:text-ink group-hover:grid"
        >
          <SquarePen size={13} />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="sessions"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden pl-4"
          >
            {shown.map((s) => (
              <SessionRow key={s.id} s={s} now={now} onNavigate={onNavigate} />
            ))}
            {g.sessions.length === 0 && <div className="px-2 py-1.5 text-[12.5px] text-faint">No sessions yet.</div>}
            {!all && g.sessions.length > SHOWN && (
              <button type="button" onClick={() => setAll(true)} className="block px-2 py-1 text-[12.5px] text-muted hover:text-ink">
                Show {g.sessions.length - SHOWN} more
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
