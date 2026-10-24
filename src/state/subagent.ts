import { useMemo } from "react";
import { create } from "zustand";
import type { UIMessage } from "../lib/opencode/projection";
import { subagentOf, toolKind } from "../lib/opencode/tools";
import { useChat } from "./chat";
import { useAgentNamer } from "./teammates";

export type SubagentRef = { sessionID: string; agent?: string; title?: string };

/** The subagent session open in the viewer sheet, if any. */
export const useSubagentView = create<{ open: SubagentRef | null }>(() => ({ open: null }));

export const openSubagent = (sessionID: string, agent?: string, title?: string) => useSubagentView.setState({ open: { sessionID, agent, title } });
export const closeSubagent = () => useSubagentView.setState({ open: null });

/**
 * The subagents handed out in the same turn as `child`, in the order they were
 * called (itself included), so the viewer can step between them. Empty when
 * the call isn't in the loaded conversation.
 */
export function siblingsOf(messages: UIMessage[] | undefined, child: string): SubagentRef[] {
  let turn: SubagentRef[] = [];
  let found = false;
  for (const m of messages ?? []) {
    // A message waiting in the inbox doesn't start a turn yet.
    if (m.kind === "user" && !m.pending) {
      if (found) break;
      turn = [];
    }
    if (m.kind !== "assistant") continue;
    for (const b of m.blocks) {
      if (b.kind !== "tool" || toolKind(b.name) !== "subagent") continue;
      const s = subagentOf(b);
      if (!s.childID || turn.some((t) => t.sessionID === s.childID)) continue;
      turn.push({ sessionID: s.childID, agent: s.agent, title: s.description });
      if (s.childID === child) found = true;
    }
  }
  return found ? turn : [];
}

/**
 * What tells siblings apart: each one's task, or, for the same agent sent
 * twice without one, a letter ("Scout A", "Scout B"). `name` turns an agent
 * id into what the user calls them.
 */
export function siblingLabels(list: SubagentRef[], name: (agent?: string) => string): string[] {
  const untitled = (r: SubagentRef) => !r.title?.trim();
  const twins = (r: SubagentRef) => list.filter((o) => untitled(o) && o.agent === r.agent);
  return list.map((r) => {
    if (!untitled(r)) return r.title!.trim();
    const same = twins(r);
    return same.length > 1 ? `${name(r.agent)} ${String.fromCharCode(65 + same.indexOf(r))}` : name(r.agent);
  });
}

/** `child`'s siblings (see `siblingsOf`) with their labels and where it sits among them. */
export function useSiblings(child: string | undefined, parent?: string) {
  const owner = useChat((s) => parent ?? (child ? s.parents[child] : undefined));
  const messages = useChat((s) => (owner ? s.timelines[owner]?.messages : undefined));
  const name = useAgentNamer();
  return useMemo(() => {
    const list = child ? siblingsOf(messages, child) : [];
    return { list, labels: siblingLabels(list, name), at: list.findIndex((r) => r.sessionID === child) };
  }, [messages, child, name]);
}
