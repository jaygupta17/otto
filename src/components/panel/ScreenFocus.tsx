/**
 * The agent's screen, filling the window: for driving it (taking control
 * opens this) or just watching closely. While it's up it holds the one
 * stream; the panel and the chat show a note instead.
 *
 * Escape leaves it, unless the screen has the keyboard (you're in control):
 * then Escape belongs to the machine, and the title bar's button leaves.
 */
import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTrafficLights } from "../../hooks/useChrome";
import { useFocusTrap, useLayer } from "../../lib/layers";
import { useChat } from "../../state/chat";
import { useComputer, useHandoff } from "../../state/computer";
import { AgentTab, ControlBar, FitScreen, useLiveTarget, useScreenStream } from "./LiveScreen";

export function ScreenFocus() {
  const focus = useComputer((s) => s.focus);
  const target = useLiveTarget();
  const on = focus && !!target;
  // Another workspace, or one without a screen: nothing to fill the window with.
  useEffect(() => {
    if (focus && !target) useComputer.getState().setFocus(false);
  }, [focus, target]);
  useLayer(on, () => useComputer.getState().setFocus(false));
  return createPortal(<AnimatePresence>{on && <FocusView key="focus" />}</AnimatePresence>, document.body);
}

function FocusView() {
  const control = useComputer((s) => s.control);
  const sessionId = useChat((s) => s.activeId);
  const mine = useHandoff(sessionId);
  const any = useHandoff(null);
  const stream = useScreenStream(true);
  const mac = useTrafficLights();
  // The keyboard comes along (not left in the composer behind), and goes back on the way out.
  const root = useRef<HTMLDivElement>(null);
  useFocusTrap(root, true);

  return (
    <motion.div
      ref={root}
      role="dialog"
      aria-modal
      aria-label="The agent's screen"
      className="fixed inset-x-0 top-0 z-50 flex h-[var(--app-h,100dvh)] flex-col bg-bg"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
    >
      <div className={`shrink-0 pt-[var(--safe-t)] ${mac ? "pl-[72px]" : ""}`} data-tauri-drag-region>
        <ControlBar handoff={mine ?? any} sessionId={sessionId} onReload={stream.reload} loading={stream.load.state === "loading"} tall />
      </div>
      <AgentTab active />
      <div tabIndex={-1} data-autofocus className="flex min-h-0 flex-1 flex-col bg-black pb-[var(--safe-b)] outline-none">
        <FitScreen stream={stream} control={control} sessionId={sessionId} className="w-full flex-1" />
      </div>
    </motion.div>
  );
}
