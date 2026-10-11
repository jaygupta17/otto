/** Small app-level actions shared by keyboard shortcuts and the command palette. */
import { useChat } from "../state/chat";
import { toast } from "../state/ui";

/** Primary agents the user can pick, in menu order. */
export function primaryAgents() {
  return useChat.getState().agents.filter((a) => a.mode !== "subagent" && !a.hidden);
}

/** Move to the next (or previous) primary agent for the current session or draft. */
export function cycleAgent(dir: 1 | -1 = 1) {
  const st = useChat.getState();
  const list = primaryAgents();
  if (list.length < 2) return;
  const current = (st.activeId ? st.sessions[st.activeId]?.agent : undefined) ?? st.pickedAgent;
  const i = Math.max(0, list.findIndex((a) => a.id === current));
  const next = list[(i + dir + list.length) % list.length];
  // The agent chip in the composer updates in place; no toast needed.
  void st.setAgent(next.id, st.activeId);
}

/** Step through the current model's thinking-effort variants. */
export function cycleEffort() {
  const st = useChat.getState();
  const ref = (st.activeId ? st.sessions[st.activeId]?.model : undefined) ?? st.pickedModel ?? st.defaultModel;
  if (!ref) return;
  const info = st.models.find((m) => m.providerID === ref.providerID && m.id === ref.id);
  const variants = info?.variants?.map((v) => v.id) ?? [];
  if (!variants.length) {
    toast({ tone: "info", title: "This model has one effort level" });
    return;
  }
  const cur = ref.variant ?? "default";
  const order = variants.includes("default") ? variants : ["default", ...variants];
  const next = order[(order.indexOf(cur) + 1) % order.length];
  void st.setModel({ providerID: ref.providerID, id: ref.id, variant: next }, st.activeId);
}
