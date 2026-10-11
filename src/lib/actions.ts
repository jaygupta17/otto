/** Small app-level actions shared by keyboard shortcuts and the command palette. */
import { useChat } from "../state/chat";
import { toast } from "../state/ui";
import { confirmDialog, promptDialog } from "../components/ui/Dialogs";

/** The directory the user is working in: the open session's, else the picked project, else home. */
export function currentDir(): string | null {
  const st = useChat.getState();
  return (st.activeId ? st.sessions[st.activeId]?.location.directory : undefined) ?? st.projectDir ?? st.homeDir;
}

/** Delete a session after the user confirms. Resolves true if it was deleted. */
export async function deleteSession(id: string) {
  const st = useChat.getState();
  const title = st.sessions[id]?.title || "this session";
  const ok = await confirmDialog({
    title: "Delete session?",
    body: `"${title}" and its history will be removed from the server. Files the agent changed stay as they are.`,
    confirm: "Delete",
    danger: true,
  });
  if (ok) await useChat.getState().remove(id);
  return ok;
}

/** Ask for a new session title. */
export async function renameSession(id: string) {
  const current = useChat.getState().sessions[id]?.title ?? "";
  const t = await promptDialog({ title: "Rename session", value: current, placeholder: "Session title" });
  if (t && t !== current) await useChat.getState().rename(id, t);
}

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
