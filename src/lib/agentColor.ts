/** Agent identity colors. An agent without its own color gets a stable one from this set. */
export const AGENT_COLORS = ["#6d5ef0", "#2d6cf6", "#20b4a6", "#1f9d6a", "#e2a33b", "#e2774f", "#d6455d", "#c04fd6"];

const BUILTIN: Record<string, string> = { build: "#2d6cf6", plan: "#20b4a6", general: "#e2a33b", explore: "#c04fd6" };

export function agentColor(id: string | undefined, own?: unknown): string {
  if (typeof own === "string" && /^#[0-9a-f]{6}$/i.test(own)) return own;
  if (!id) return "var(--border-strong)";
  if (BUILTIN[id]) return BUILTIN[id];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AGENT_COLORS[Math.abs(h) % AGENT_COLORS.length];
}
