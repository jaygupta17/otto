/**
 * The session list in three tiers, the same on the sidebar and the phone:
 * sessions that want you (asking, working, a result you haven't opened), the
 * agents you can start something with, and everything else, newest first.
 */
import { useEffect, useMemo, useRef } from "react";
import type { SessionInfo } from "@opencode/client";
import type { UIMessage } from "../lib/opencode/projection";
import { toolDoing, toolLabel } from "../lib/opencode/tools";
import { isOfferedAgent } from "../lib/teammates";
import { asksFor, sortedSessions, useChat } from "./chat";
import { inTree, useShells } from "./shells";
import { useAgentName, useTeammates } from "./teammates";

export function useSessionTiers(query: string): { active: SessionInfo[]; recent: SessionInfo[] } {
  const sessions = useChat((s) => s.sessions);
  const busy = useChat((s) => s.busy);
  const unread = useChat((s) => s.unread);
  const permissions = useChat((s) => s.permissions);
  const forms = useChat((s) => s.forms);
  const parents = useChat((s) => s.parents);
  const open = useChat((s) => s.activeId);
  const shells = useShells((s) => s.byId);
  const stopped = useShells((s) => s.stopped);
  // Opening a result marks it read; it stays up top while you're in it, so it doesn't jump away under you.
  const held = useRef(new Set<string>());
  return useMemo(() => {
    const term = query.trim().toLowerCase();
    const list = sortedSessions(sessions).filter((s) => !term || (s.title ?? "").toLowerCase().includes(term) || s.location.directory.toLowerCase().includes(term));
    const asks = [...Object.values(permissions), ...Object.values(forms)].map((a) => a.sessionID);
    // Anything still going counts as working: its own turn, a teammate on a part, a command left running.
    const going = [...Object.keys(busy).filter((k) => busy[k]), ...Object.values(shells).flatMap((sh) => (sh.status === "running" && !stopped[sh.id] && sh.sessionID ? [sh.sessionID] : []))];
    // Waiting on you, then working, then unseen results (failures included: they're news only until read).
    const rank = (s: SessionInfo) =>
      asks.some((a) => asksFor(parents, a, s.id)) ? 0 : going.some((g) => inTree(parents, g, s.id)) ? 1 : unread[s.id] || (s.id === open && held.current.has(s.id)) ? 2 : 3;
    const ranked = list.map((s) => ({ s, r: rank(s) }));
    const active = ranked.filter((x) => x.r < 3).sort((a, b) => a.r - b.r).map((x) => x.s);
    held.current = new Set(active.map((s) => s.id));
    return { active, recent: ranked.filter((x) => x.r === 3).map((x) => x.s) };
  }, [sessions, busy, unread, permissions, forms, parents, open, query, shells, stopped]);
}

export interface OfferedAgent {
  id: string;
  name: string;
  /** A teammate's job, else the agent's description. */
  job: string;
}

/** Everyone you can start a session with: leads first, then teammates in the order they joined, then other agents. */
export function useOfferedAgents(): OfferedAgent[] {
  const agents = useChat((s) => s.agents);
  const roster = useTeammates((s) => s.byId);
  return useMemo(() => {
    const list = agents.filter((a) => a.mode !== "subagent" && !a.hidden && isOfferedAgent(a.id));
    const joined = (id: string) => (roster?.[id]?.leads ? -1 : (roster?.[id]?.created ?? Infinity));
    return list
      .map((a, i) => ({ a, i }))
      .sort((x, y) => joined(x.a.id) - joined(y.a.id) || x.i - y.i)
      .map(({ a }) => ({ id: a.id, name: roster?.[a.id]?.name ?? a.name, job: roster?.[a.id]?.job || a.description || "" }));
  }, [agents, roster]);
}

/** What a turn is doing right now, in a few words: "Editing Thread.tsx", "Thinking", "Writing"; between steps, the last one it did. */
export function doingOf(msgs: UIMessage[] | undefined): string {
  if (!msgs) return "";
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.kind === "user") return "";
    if (m.kind !== "assistant") continue;
    for (let j = m.blocks.length - 1; j >= 0; j--) {
      const b = m.blocks[j];
      if (b.kind === "tool") {
        if (b.status === "running" || b.status === "streaming") return toolDoing(b);
        const step = toolLabel(b);
        return [step.verb, step.path ? step.path.split("/").pop() : step.target].filter(Boolean).join(" ");
      }
      if (b.kind === "reasoning") return b.streaming ? "Thinking" : "";
      if (b.kind === "text" && b.text.trim()) return b.streaming ? "Writing" : "";
    }
  }
  return "";
}

/** `doingOf` a live session, loading its conversation when it isn't yet (a row in a list, a teammate's part). */
export function useDoing(id: string | undefined, live: boolean): string {
  useEffect(() => {
    if (!id || !live) return;
    const t = useChat.getState().timelines[id];
    if (!t || (!t.loaded && !t.loading)) void useChat.getState().loadTimeline(id);
  }, [id, live]);
  return useChat((st) => (id && live ? doingOf(st.timelines[id]?.messages) : ""));
}

/**
 * What's still going under a session once its own turn is over, for its row:
 * "Scout working in the background", "bun dev running in the background", or
 * a count. Teammates on a part and commands left running count, anywhere down
 * its tree. "" when there's nothing.
 */
export function useBackgroundLine(id: string): string {
  const busy = useChat((s) => !!s.busy[id]);
  const parents = useChat((s) => s.parents);
  const kids = useChat((s) => Object.keys(s.busy).filter((k) => s.busy[k] && k !== id && inTree(s.parents, k, id)).join(" "));
  const agent = useChat((s) => (kids ? s.delegated[kids.split(" ")[0]] : undefined));
  const name = useAgentName(agent);
  const left = (s: ReturnType<typeof useShells.getState>) => Object.values(s.byId).filter((sh) => sh.status === "running" && !s.stopped[sh.id] && inTree(parents, sh.sessionID, id));
  const commands = useShells((s) => left(s).length);
  const command = useShells((s) => left(s)[0]?.command);
  const count = (kids ? kids.split(" ").length : 0) + commands;
  if (busy || !count) return "";
  if (count > 1) return `${count} running in the background`;
  if (kids) return `${name || "A teammate"} working in the background`;
  return `${command?.split("\n")[0].trim() || "A command"} running in the background`;
}
