import { Square } from "lucide-react";
import { useEffect } from "react";
import { useChat } from "../../state/chat";
import { closeSubagent, useSubagentView } from "../../state/subagent";
import { agentColor } from "../../lib/agentColor";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import { AgentClock } from "../ui/AgentClock";
import { TeammateFace } from "../ui/TeammateFace";
import { useAgentName, useTeammate } from "../../state/teammates";
import { Thread } from "./Thread";
import { AskDock } from "./Asks";

/**
 * A subagent's own conversation, read-only, over the chat that spawned it.
 * Its approvals show here and in the parent; answering either clears both.
 */
export function SubagentHost({ compact }: { compact: boolean }) {
  const open = useSubagentView((s) => s.open);
  const id = open?.sessionID;
  const busy = useChat((s) => (id ? !!s.busy[id] : false));
  const parent = useChat((s) => (id ? s.parents[id] : undefined));
  const stopSubagent = useChat((s) => s.stopSubagent);
  const interrupt = useChat((s) => s.interrupt);

  useEffect(() => {
    if (id) void useChat.getState().loadTimeline(id, true);
  }, [id]);

  const teammate = useTeammate(open?.agent);
  const name = useAgentName(open?.agent) || "Subagent";
  return (
    <Sheet
      open={!!open}
      onClose={closeSubagent}
      compact={compact}
      wide
      title={
        <div className="flex min-w-0 items-center gap-2 text-left">
          {teammate ? <TeammateFace seed={teammate.face} color={teammate.color} accessory={teammate.accessory} size={26} state={busy ? "working" : "idle"} /> : <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: agentColor(open?.agent) }} />}
          <span className="shrink-0">{name}</span>
          {open?.title && <span className="min-w-0 truncate font-normal text-muted">{open.title}</span>}
          {busy && (
            <span className="ml-auto flex shrink-0 items-center gap-2">
              {!teammate && <AgentClock size={12} />}
              <Button size="sm" variant="ghost" icon={<Square size={12} />} onClick={() => id && void (parent ? stopSubagent(parent, id, open?.title) : interrupt(id))}>
                Stop
              </Button>
            </span>
          )}
        </div>
      }
    >
      {id && (
        <div className={`flex flex-col ${compact ? "h-sheet" : "h-[min(72vh,760px)]"}`}>
          <Thread sessionId={id} />
          <div className="px-3 pt-1">
            <AskDock sessionId={id} inLayer />
          </div>
        </div>
      )}
    </Sheet>
  );
}
