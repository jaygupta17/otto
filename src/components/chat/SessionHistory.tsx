import { Check, History, Search, SquarePen } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import type { SessionInfo } from "@opencode/client";
import { asksFor, sortedSessions, useChat } from "../../state/chat";
import { useAgentName } from "../../state/teammates";
import { useTouch } from "../../hooks/useMedia";
import { useNow } from "../../hooks/useNow";
import { timeAgo } from "../../lib/format";
import { isOfferedAgent } from "../../lib/teammates";
import { startDraft } from "../../lib/actions";
import { IconButton } from "../ui/Button";
import { MenuItem, Popover } from "../ui/Popover";
import { Sheet } from "../ui/Sheet";
import { AgentMark } from "../ui/Bird";
import { SessionPip } from "../shell/SessionRow";

/**
 * The sessions this chat's agent has had, to switch to without leaving the
 * thread. A popover on desktop, a page on phones. In a new session
 * (`sessionId` null) it lists the picked teammate's sessions.
 */
export function SessionHistory({ sessionId, phone = false }: { sessionId: string | null; phone?: boolean }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const agent = useChat((s) => (sessionId ? (s.sessions[sessionId]?.agent ?? null) : s.pickedAgent));
  const name = useAgentName(agent);
  const touch = useTouch();
  const sheet = phone && touch;
  const title = agent ? `Sessions with ${name}` : "Session history";
  const toggle = () => setOpen((v) => !v);

  const menu = <HistoryMenu sessionId={sessionId} agent={agent} phone={phone} touch={sheet} onDone={() => setOpen(false)} />;

  return (
    <>
      {phone ? (
        <button ref={anchor} type="button" onClick={toggle} aria-label={title} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink transition-colors active:bg-hover">
          <History size={21} />
        </button>
      ) : (
        <IconButton ref={anchor} label={title} className="no-drag" onClick={toggle} active={open}>
          <History size={16} />
        </IconButton>
      )}
      {sheet ? (
        <Sheet open={open} onClose={() => setOpen(false)} compact title="Sessions">
          {menu}
        </Sheet>
      ) : (
        <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="bottom-end" width={Math.min(320, window.innerWidth - 16)}>
          {menu}
        </Popover>
      )}
    </>
  );
}

function HistoryMenu({ sessionId, agent, phone, touch, onDone }: { sessionId: string | null; agent: string | null; phone: boolean; touch: boolean; onDone: () => void }) {
  const [q, setQ] = useState("");
  const sessions = useChat((s) => s.sessions);
  const name = useAgentName(agent);
  const now = useNow(true, 30_000);
  // Only an offered agent can start a new session; a legacy default one falls back to the picked agent.
  const startAgent = agent && isOfferedAgent(agent) ? agent : null;

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sortedSessions(sessions).filter((s) => (!agent || s.agent === agent) && (!term || (s.title ?? "").toLowerCase().includes(term)));
  }, [sessions, agent, q]);

  function newSession() {
    onDone();
    startDraft(startAgent, phone);
  }

  function pick(id: string) {
    useChat.getState().open(id);
    onDone();
  }

  return (
    <div className="flex max-h-[min(70vh,520px)] flex-col">
      {agent && (
        <div className="flex items-center gap-2 px-3 pt-2.5 text-[12px] text-muted">
          <AgentMark id={agent} size={20} />
          <span className="truncate">{name}</span>
          <span className="ml-auto tabular-nums text-faint">{list.length}</span>
        </div>
      )}
      <div className="px-2 pt-2 pb-1.5">
        <div className="field flex h-8 items-center gap-2 rounded-lg px-2.5">
          <Search size={13} className="shrink-0 text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            // No keyboard popping up over the list on phones; tap to search.
            data-autofocus={touch ? undefined : true}
            placeholder="Find a session"
            aria-label="Find a session"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
        </div>
      </div>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-1.5">
        <MenuItem icon={<SquarePen size={14} />} label={startAgent ? `New session with ${name}` : "New session"} onClick={newSession} />
        {list.length > 0 && <div className="my-1 h-px bg-line" />}
        {list.map((s) => (
          <HistoryRow key={s.id} s={s} active={s.id === sessionId} now={now} onPick={() => pick(s.id)} />
        ))}
        {list.length === 0 && <div className="px-2 py-3 text-[12px] text-muted">{q ? `Nothing matches “${q.trim()}”.` : "No sessions yet."}</div>}
      </div>
    </div>
  );
}

const HistoryRow = memo(function HistoryRow({ s, active, now, onPick }: { s: SessionInfo; active: boolean; now: number; onPick: () => void }) {
  const busy = useChat((st) => !!st.busy[s.id]);
  const unread = useChat((st) => !!st.unread[s.id]);
  const asking = useChat((st) => Object.values(st.permissions).some((p) => asksFor(st.parents, p.sessionID, s.id)) || Object.values(st.forms).some((f) => asksFor(st.parents, f.sessionID, s.id)));
  return (
    <button
      type="button"
      onClick={onPick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${active ? "chip text-ink" : "text-ink-2 hover:bg-hover"}`}
    >
      <span className="grid w-3.5 shrink-0 place-items-center">
        {active ? <Check size={13} className="text-ink-2" /> : <SessionPip busy={busy} asking={asking} unread={unread} failed={s.outcome === "failed"} />}
      </span>
      <span className={`min-w-0 flex-1 truncate ${unread || asking ? "font-medium text-ink" : ""}`}>{s.title || "New session"}</span>
      <span className="shrink-0 text-[12px] font-mono tabular-nums text-faint">{timeAgo(s.time.updated, now)}</span>
    </button>
  );
});
