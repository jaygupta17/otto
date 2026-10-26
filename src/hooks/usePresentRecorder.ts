/**
 * Watches the loaded timelines for `present` tool calls and records them.
 *
 * The tool call is the transport: OpenCode streams it as a tool part of the
 * session, the app projects it into a `Block` (projection.ts), and this hook
 * copies the ones named `present` into the artifact store. Nothing else is
 * written or fetched, and a re-scan (every streaming event) is a set lookup per
 * call, so the cost is a walk over the loaded blocks.
 *
 * A call is recorded once its input has arrived and it hasn't failed: a
 * streaming call has half a source, and an error means nothing was shown.
 */
import { useEffect } from "react";
import { useChat } from "../state/chat";
import { isPresentTool, useArtifacts } from "../state/artifacts";
import { inputOf } from "../lib/opencode/tools";

export function usePresentRecorder() {
  useEffect(() => {
    const scan = () => {
      const chat = useChat.getState();
      const timelines = chat.timelines;
      for (const sessionId of Object.keys(timelines)) {
        const messages = timelines[sessionId]?.messages;
        if (!messages) continue;
        const root = chat.sessions[sessionId]?.location.directory ?? chat.sessions[chat.activeId ?? ""]?.location.directory ?? chat.homeDir ?? "";
        for (const m of messages) {
          if (m.kind !== "assistant") continue;
          for (const b of m.blocks) {
            if (b.kind !== "tool" || !isPresentTool(b.name)) continue;
            // A failed call showed nothing; one still streaming has half a source.
            if (b.status === "error" || b.status === "streaming") continue;
            const input = inputOf(b);
            if (typeof input.source !== "string" || !input.source.trim()) continue;
            void useArtifacts.getState().presented(b.id, input, sessionId, root, b.started);
          }
        }
      }
    };
    scan();
    return useChat.subscribe(scan);
  }, []);
}
