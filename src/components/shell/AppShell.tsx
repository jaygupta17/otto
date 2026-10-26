import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { startingSession, useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { Sidebar } from "./Sidebar";
import { Home } from "./Home";
import { SessionView } from "./SessionView";
import { SidePanel } from "../panel/SidePanel";
import { Dock } from "../panel/Dock";
import { SchedulesView } from "../schedules/SchedulesView";
import { useShortcuts } from "../../hooks/useShortcuts";

const SIDEBAR_W = 268;
const ease = { type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * Desktop / tablet layout:
 *   sidebar · chat · [tools panel] · dock
 * Regions sit flush to the window edges, split by hairlines, each a flat
 * solid surface (styles.css → Materials). The dock is the rightmost column
 * and never moves; the panel opens and closes to its left.
 */
export function AppShell({ compact = false }: { compact?: boolean }) {
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const homeCompact = useUI((s) => s.homeCompact);
  const activeId = useChat((s) => s.activeId);
  const view = useUI((s) => s.view);
  const root = useChat((s) => (s.activeId ? s.sessions[s.activeId]?.location.directory : null) ?? s.projectDir ?? s.homeDir);
  // A session started from home takes home's place: same key, so it swaps in
  // without a fade (which would blank the screen between prompt and message).
  const starting = useChat(startingSession);
  const fresh = useRef<string | null>(null);
  if (starting && activeId) fresh.current = activeId;
  else if (activeId !== fresh.current) fresh.current = null;
  const page = view === "schedules" ? "schedules" : !activeId || activeId === fresh.current ? "home" : activeId;

  useShortcuts();

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-bg">
      <motion.aside initial={false} animate={{ width: sidebarOpen ? SIDEBAR_W : 0 }} transition={ease} className={`surface-sidebar relative z-[1] h-full shrink-0 overflow-hidden ${sidebarOpen ? "border-r border-line" : ""}`}>
        <div className="h-full" style={{ width: SIDEBAR_W }}>
          <Sidebar />
        </div>
      </motion.aside>

      <div className="relative z-[1] flex h-full min-w-0 flex-1">
        <main className="surface-panel relative h-full min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={page}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.06 } }}
              transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
              className="h-full"
            >
              {/* `compact` = the pane is narrow; `homeCompact` = the user's preference. */}
              {view === "schedules" ? <SchedulesView /> : activeId ? <SessionView sessionId={activeId} /> : <Home compact={compact || homeCompact} />}
            </motion.div>
          </AnimatePresence>
        </main>

        <SidePanel root={root} sessionId={activeId} />
        <Dock />
      </div>
    </div>
  );
}
