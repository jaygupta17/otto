/**
 * A live turn's status, after DitherUI's dither loader: a breathing patch of
 * dots and what it's on now ("Thinking…", "Reading Thread.tsx…"), each new
 * step rolling up over the last. It heads the turn's live run of steps
 * (`ToolRun` in Activity.tsx), and stands on its own where there's no run to
 * head: before the first step, and between prose and the next step.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Block } from "../../lib/opencode/projection";
import { toolDoing, toolKind } from "../../lib/opencode/tools";
import { useNow } from "../../hooks/useNow";
import { DitherBreath } from "../ui/Dither";

export type Retry = { attempt: number; message: string; next: number };

/**
 * The step a live turn is on: the newest call still going, else the model
 * thinking it over. A handoff isn't a step here: its own line says who's on it.
 */
export function stepNow(blocks: Block[]): string {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "tool" && (b.status === "running" || b.status === "streaming") && toolKind(b.name) !== "subagent") return toolDoing(b);
  }
  return "Thinking";
}

/** Holds each value on screen at least `ms`, so quick steps don't flicker past unread. */
function useSteady(value: string, ms: number): string {
  const [shown, setShown] = useState(value);
  const since = useRef(0);
  useEffect(() => {
    if (value === shown) return;
    const id = window.setTimeout(() => {
      since.current = performance.now();
      setShown(value);
    }, Math.max(0, since.current + ms - performance.now()));
    return () => clearTimeout(id);
  }, [value, shown, ms]);
  return shown;
}

/**
 * The orb and the rolling phrase, as wide as the phrase so whatever follows
 * it (a chevron) sits right after the words. A retry says when it's trying
 * again, and why.
 */
export function Loader({ doing, retry }: { doing: string; retry?: Retry }) {
  const now = useNow(!!retry);
  const shown = useSteady(retry ? `Retrying${retry.attempt > 1 ? ` (attempt ${retry.attempt})` : ""}` : doing, 700);
  return (
    // No live region here: `TurnStatus` speaks the turn's state once, so the line can't repeat it.
    <span className="flex min-w-0 items-center gap-2">
      <DitherBreath size={28} className="-ml-1 text-accent" />
      {/* Old and new phrases share one cell, so the outgoing one rolls away without pushing anything. */}
      <span className="grid h-5 min-w-0 grid-cols-[minmax(0,max-content)] overflow-hidden">
        <AnimatePresence initial={false}>
          <motion.span
            key={shown}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
            className="col-start-1 row-start-1 flex min-w-0 items-center leading-5 text-muted"
          >
            <span className="truncate">{shown}</span>
            <span className="loader-dots shrink-0" aria-hidden>
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
            {retry && (
              <span className="ml-1.5 min-w-0 truncate text-faint">
                {retry.next > now ? `in ${Math.ceil((retry.next - now) / 1000)}s · ` : ""}
                {retry.message}
              </span>
            )}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  );
}

/** The status line on its own, where there's no run of steps to head. */
export function Working({ doing, retry }: { doing: string; retry?: Retry }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 flex h-7 items-center text-[13px]">
      <Loader doing={doing} retry={retry} />
    </motion.div>
  );
}
