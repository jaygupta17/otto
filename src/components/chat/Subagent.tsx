import { ChevronLeft, ChevronRight, Square } from "lucide-react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useChat } from "../../state/chat";
import { closeSubagent, openSubagent, useSiblings, useSubagentView } from "../../state/subagent";
import { useHistoryEntry } from "../../lib/back";
import { axisOf, ofHint, resist, settle, type Axis } from "../../lib/pager";
import { Button, IconButton } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

import { AgentClock } from "../ui/AgentClock";
import { AgentMark } from "../ui/Bird";
import { useFace } from "../../state/face";
import { useAgentName, useHasFace } from "../../state/teammates";
import { Thread } from "./Thread";
import { AskDock } from "./Asks";

/**
 * A subagent's own conversation, read-only, over the chat that spawned it.
 * Its approvals show here and in the parent; answering either clears both.
 * Others handed a part in the same turn are a swipe (or ←/→) away; back
 * returns to the parent chat.
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
  useHistoryEntry(!!open, closeSubagent);

  const { list, labels, at } = useSiblings(id);
  const count = at >= 0 ? list.length : 0;
  // Which way the last step went, so the next conversation slides in from that side.
  const [dir, setDir] = useState(0);
  const go = (to: number) => {
    const r = list[to];
    if (!r || to === at) return;
    setDir(to > at ? 1 : -1);
    openSubagent(r.sessionID, r.agent, r.title);
  };
  const step = useRef(go);
  step.current = go;
  useEffect(() => {
    if (!open || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (t instanceof Element && t.closest("input, textarea, select, [contenteditable]"))) return;
      if (e.key === "ArrowLeft") step.current(at - 1);
      else if (e.key === "ArrowRight") step.current(at + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count, at]);

  const faced = useHasFace(open?.agent);
  const face = useFace(id);
  const name = useAgentName(open?.agent) || "Subagent";
  // Its task beside the name; a twin ("Scout B") takes the name's place.
  const label = count > 1 ? labels[at] : open?.title?.trim();
  const twin = !!label && label.startsWith(`${name} `) && !open?.title?.trim();
  const sub = twin || label === name ? "" : label;
  return (
    <Sheet
      open={!!open}
      onClose={closeSubagent}
      compact={compact}
      wide
      title={
        <div className="flex min-w-0 items-center gap-2 text-left">
          <AgentMark id={open?.agent} size={26} state={face} />
          <span className="shrink-0">{twin ? label : name}</span>
          {sub && <span className="min-w-0 truncate font-normal text-muted">{sub}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {busy && (
              <>
                {!faced && <AgentClock size={12} />}
                <Button size="sm" variant="ghost" icon={<Square size={12} />} onClick={() => id && void (parent ? stopSubagent(parent, id, open?.title) : interrupt(id))}>
                  Stop
                </Button>
              </>
            )}
            {count > 1 && (
              <>
                <IconButton label="Previous subagent" keys="←" size={compact ? 36 : 28} disabled={at === 0} onClick={() => go(at - 1)}>
                  <ChevronLeft size={16} />
                </IconButton>
                <span aria-live="polite" className="text-[13px] font-normal text-muted tabular-nums">
                  {ofHint(at, count)}
                </span>
                <IconButton label="Next subagent" keys="→" size={compact ? 36 : 28} disabled={at === count - 1} onClick={() => go(at + 1)}>
                  <ChevronRight size={16} />
                </IconButton>
              </>
            )}
          </span>
        </div>
      }
    >
      {id && (
        <Swipe at={at} count={count} onGo={go} className={`relative flex flex-col overflow-hidden ${compact ? "h-sheet" : "h-[min(72vh,760px)]"}`}>
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.div
              key={id}
              custom={dir}
              variants={slide}
              initial="enter"
              animate="center"
              exit="leave"
              transition={{ type: "spring", stiffness: 420, damping: 42 }}
              className="flex min-h-0 flex-1 flex-col"
            >
              <Thread sessionId={id} />
              <div className="px-3 pt-1">
                <AskDock sessionId={id} inLayer />
              </div>
            </motion.div>
          </AnimatePresence>
        </Swipe>
      )}
    </Sheet>
  );
}

const slide = {
  enter: (d: number) => ({ x: d ? `${d * 30}%` : 0, opacity: d ? 0 : 1 }),
  center: { x: 0, opacity: 1 },
  leave: (d: number) => ({ x: d ? `${d * -30}%` : 0, opacity: 0 }),
};

/**
 * A sideways drag over the conversation steps to the next or previous
 * sibling; up and down stay the thread's own scroll.
 */
function Swipe({ at, count, onGo, className, children }: { at: number; count: number; onGo: (to: number) => void; className: string; children: React.ReactNode }) {
  const x = useMotionValue(0);
  const axis = useRef<Axis | null>(null);
  const width = useRef(1);
  const still = useReducedMotion();
  const on = count > 1;
  return (
    <motion.div
      className={className}
      style={{ x, touchAction: on ? "pan-y" : undefined }}
      onPanStart={(e) => {
        axis.current = null;
        width.current = (e.currentTarget as HTMLElement | null)?.clientWidth || window.innerWidth;
      }}
      onPan={(_, i) => {
        if (!on) return;
        axis.current ??= axisOf(i.offset.x, i.offset.y);
        if (axis.current === "x") x.set(resist(i.offset.x, at, count) * 0.5);
      }}
      onPanEnd={(_, i) => {
        if (!on) return;
        const land = settle({ axis: axis.current === "x" ? "x" : "none", edge: false, dx: i.offset.x, dy: i.offset.y, vx: i.velocity.x, vy: i.velocity.y, width: width.current, at, count });
        axis.current = null;
        void animate(x, 0, still ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 42 });
        if (!land.close && land.to !== at) onGo(land.to);
      }}
    >
      {children}
    </motion.div>
  );
}
