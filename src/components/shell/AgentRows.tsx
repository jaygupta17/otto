import { SquarePen } from "lucide-react";
import { memo } from "react";
import type { SessionInfo } from "@opencode/client";
import { asksFor, useChat } from "../../state/chat";
import { timeAgo } from "../../lib/format";
import { AgentMark } from "../ui/TeammateFace";
import { useAgentName, useTeammate } from "../../state/teammates";
import { AgentClock } from "../ui/AgentClock";

export interface AgentGroup {
  id: string;
  name: string;
  /** Teammates have a job; plain agents don't. */
  job?: string;
  /** Newest first. Pinned sessions are listed under Pinned instead. */
  sessions: SessionInfo[];
}

/** One row per teammate, like a conversation list: who, what they last did, when. Older sessions live in the chat's history. */
export function AgentRows({ groups, now, onNavigate }: { groups: AgentGroup[]; now: number; onNavigate?: () => void }) {
  return (
    <div className="space-y-px">
      {groups.map((g) => (
        <AgentRow key={g.id} group={g} now={now} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

const AgentRow = memo(function AgentRow({ group: g, now, onNavigate }: { group: AgentGroup; now: number; onNavigate?: () => void }) {
  const busyCount = useChat((s) => g.sessions.reduce((n, x) => n + (s.busy[x.id] ? 1 : 0), 0));
  const asking = useChat((s) => g.sessions.some((x) => Object.values(s.permissions).some((p) => asksFor(s.parents, p.sessionID, x.id)) || Object.values(s.forms).some((f) => asksFor(s.parents, f.sessionID, x.id))));
  const unread = useChat((s) => g.sessions.some((x) => !!s.unread[x.id]));
  // Work handed over by a lead runs in the lead's thread, but it's still this teammate doing it.
  const helping = useChat((s) => Object.keys(s.delegated).filter((c) => s.delegated[c] === g.id && s.busy[c]).length);
  const helpAsks = useChat((s) => Object.values(s.permissions).some((p) => s.delegated[p.sessionID] === g.id) || Object.values(s.forms).some((f) => s.delegated[f.sessionID] === g.id));
  const lead = useChat((s) => {
    const c = Object.keys(s.delegated).find((k) => s.delegated[k] === g.id && s.busy[k]);
    return c ? s.sessions[s.parents[c]]?.agent : undefined;
  });
  const leadName = useAgentName(lead);
  // A teammate's face carries its state itself; plain agents keep the clock.
  const face = !!useTeammate(g.id);
  const working = busyCount + helping;
  const needs = asking || helpAsks;
  const state = needs ? "needs" : working ? "working" : unread ? "done" : "idle";
  const onActive = useChat((s) => g.sessions.some((x) => x.id === s.activeId));
  // A fresh draft with this teammate picked counts as being on its row too.
  const drafting = useChat((s) => s.activeId === null && s.pickedAgent === g.id);
  const active = onActive || drafting;

  const latest = g.sessions[0];
  const preview = needs ? "Needs you" : helping && !busyCount && leadName ? `On a task for ${leadName}` : latest ? latest.title || "New session" : g.job || "Start a session";

  // New work starts in the agent's current session; with none yet, a fresh draft.
  function openAgent() {
    const st = useChat.getState();
    if (latest) st.open(latest.id);
    else startNew();
    onNavigate?.();
  }

  function startNew() {
    const st = useChat.getState();
    void st.setAgent(g.id, null);
    st.open(null);
    onNavigate?.();
  }

  return (
    <div className={`group relative flex items-center rounded-lg transition-colors ${active ? "bg-active" : "hover:bg-hover"}`}>
      <button type="button" onClick={openAgent} aria-current={active ? "true" : undefined} className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-2 pl-2 text-left">
        <AgentMark id={g.id} size={30} state={state} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`min-w-0 flex-1 truncate text-[13px] ${active || unread || needs ? "font-semibold text-ink" : "font-medium text-ink"}`}>{g.name}</span>
            <span className="shrink-0 text-[11px] text-muted tabular-nums group-hover:invisible">{working > 0 && !face ? <AgentClock size={11} /> : latest ? timeAgo(latest.time.updated, now) : ""}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={`min-w-0 flex-1 truncate text-[12px] ${needs ? "text-info" : "text-muted"}`}>{preview}</span>
            {!needs && unread && !working && <span className="h-2 w-2 shrink-0 rounded-full bg-ink" aria-label="New result" />}
            {working > 1 && <span className="shrink-0 text-[11px] text-muted tabular-nums">{working}</span>}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={startNew}
        aria-label={`New session with ${g.name}`}
        title={`New session with ${g.name}`}
        className="absolute top-1.5 right-1.5 hidden h-6 w-6 place-items-center rounded-md text-muted hover:bg-active hover:text-ink group-hover:grid"
      >
        <SquarePen size={13} />
      </button>
    </div>
  );
});
