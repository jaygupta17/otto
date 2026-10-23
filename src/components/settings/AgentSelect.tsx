import { useChat } from "../../state/chat";
import { useTeammates } from "../../state/teammates";
import { Select } from "../ui/Select";
import { AgentMark } from "../ui/Bird";

/** Agent chooser for forms. "" means `emptyLabel` (inherit / default). */
export function AgentSelect({ value, onChange, emptyLabel, primaryOnly = true }: { value: string; onChange: (v: string) => void; emptyLabel: string; primaryOnly?: boolean }) {
  const agents = useChat((s) => s.agents);
  const roster = useTeammates((s) => s.byId);
  return (
    <Select
      ariaLabel="Agent"
      value={value}
      onChange={onChange}
      options={[
        { value: "", label: emptyLabel, text: emptyLabel },
        ...agents
          .filter((a) => !a.hidden && (!primaryOnly || a.mode !== "subagent"))
          .map((a) => {
            const name = roster?.[a.id]?.name ?? a.name;
            return { value: a.id, label: name, text: name, icon: <AgentMark id={a.id} color={a.color} size={18} /> };
          }),
      ]}
    />
  );
}
