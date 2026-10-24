import { SquarePen } from "lucide-react";
import { memo } from "react";
import { useChat } from "../../state/chat";
import { useAgentName, useTeammateState } from "../../state/teammates";
import { useDoing, type OfferedAgent } from "../../state/tiers";
import { AgentMark } from "../ui/Bird";

/**
 * Everyone you can start a session with: a face, a name and a job, no card.
 * Click one to start. Anyone already on an active row above is left out.
 */
export function AgentRows({ agents, onNavigate }: { agents: OfferedAgent[]; onNavigate?: () => void }) {
  return (
    <div className="space-y-0.5">
      {agents.map((a) => (
        <AgentRow key={a.id} agent={a} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

const AgentRow = memo(function AgentRow({ agent: a, onNavigate }: { agent: OfferedAgent; onNavigate?: () => void }) {
  const state = useTeammateState(a.id);
  // Work handed over by a lead runs in the lead's thread, but it's still this teammate doing it.
  const task = useChat((s) => Object.keys(s.delegated).find((c) => s.delegated[c] === a.id && s.busy[c]));
  const lead = useChat((s) => (task ? s.sessions[s.parents[task]]?.agent : undefined));
  const leadName = useAgentName(lead);
  const needs = useChat((s) => Object.values(s.permissions).some((p) => s.delegated[p.sessionID] === a.id) || Object.values(s.forms).some((f) => s.delegated[f.sessionID] === a.id));
  const doing = useDoing(task, !!task);
  // A fresh draft with them picked is their row being open.
  const drafting = useChat((s) => s.activeId === null && s.pickedAgent === a.id);

  function start() {
    const st = useChat.getState();
    void st.setAgent(a.id, null);
    st.open(null);
    onNavigate?.();
  }

  return (
    <button
      type="button"
      onClick={start}
      aria-current={drafting ? "true" : undefined}
      aria-label={`New session with ${a.name}`}
      className={`group flex w-full items-center gap-3 rounded-[12px] py-1.5 pr-2.5 pl-1.5 text-left transition-colors ${drafting ? "chip" : "hover:bg-hover"}`}
    >
      <AgentMark id={a.id} size={42} state={state} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-ink">{a.name}</span>
        {needs ? (
          <span className="block truncate text-[12.5px] text-info">Needs you</span>
        ) : task ? (
          <span className="shimmer block truncate text-[12.5px]">{doing || (leadName ? `On a task for ${leadName}` : "Working")}</span>
        ) : (
          a.job && <span className="block truncate text-[12.5px] text-muted">{a.job}</span>
        )}
      </span>
      <SquarePen size={14} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
});
