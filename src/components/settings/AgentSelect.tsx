import { useChat } from "../../state/chat";
import { agentColor } from "../../lib/agentColor";
import { Select } from "../ui/Select";
import { AgentDot } from "../shell/CommandPalette";

/** Agent chooser for forms. "" means `emptyLabel` (inherit / default). */
export function AgentSelect({ value, onChange, emptyLabel, primaryOnly = true }: { value: string; onChange: (v: string) => void; emptyLabel: string; primaryOnly?: boolean }) {
  const agents = useChat((s) => s.agents);
  return (
    <Select
      ariaLabel="Agent"
      value={value}
      onChange={onChange}
      options={[
        { value: "", label: emptyLabel, text: emptyLabel },
        ...agents
          .filter((a) => !a.hidden && (!primaryOnly || a.mode !== "subagent"))
          .map((a) => ({ value: a.id, label: a.name, text: a.name, icon: <AgentDot color={agentColor(a.id, a.color)} /> })),
      ]}
    />
  );
}
