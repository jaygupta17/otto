import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { Sidebar } from "./Sidebar";
import { Home } from "./Home";
import { SessionView } from "./SessionView";
import { SidePanel } from "../panel/SidePanel";
import { SchedulesView } from "../schedules/SchedulesView";
import { useShortcuts } from "../../hooks/useShortcuts";

const SIDEBAR_W = 268;
const ease = { type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * Desktop / tablet layout:
 *   sidebar · chat · [tools panel]
 * Regions sit flush to the window edges, split by hairlines, each a flat
 * solid surface (styles.css → Materials).
 */
export function AppShell({ compact = false }: { compact?: boolean }) {
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const homeCompact = useUI((s) => s.homeCompact);
  const activeId = useChat((s) => s.activeId);
  const view = useUI((s) => s.view);
  const root = useChat((s) => (s.activeId ? s.sessions[s.activeId]?.location.directory : null) ?? s.projectDir ?? s.homeDir);
  const rowRef = useRef<HTMLDivElement>(null);

  useShortcuts();

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-bg">
      <motion.aside initial={false} animate={{ width: sidebarOpen ? SIDEBAR_W : 0 }} transition={ease} className={`surface-sidebar relative z-[1] h-full shrink-0 overflow-hidden ${sidebarOpen ? "border-r border-line" : ""}`}>
        <div className="h-full" style={{ width: SIDEBAR_W }}>
          <Sidebar />
        </div>
      </motion.aside>

      <div ref={rowRef} className="relative z-[1] flex h-full min-w-0 flex-1">
        <main className="surface-panel relative h-full min-w-0 flex-1 overflow-hidden">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={view === "schedules" ? "schedules" : (activeId ?? "home")}
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

        <SidePanel root={root} sessionId={activeId} rowRef={rowRef} />
      </div>
    </div>
  );
}
