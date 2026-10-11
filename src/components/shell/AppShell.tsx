import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { useChat } from "../../state/chat";
import { useUI, backdropSettings } from "../../state/ui";
import { Sidebar } from "./Sidebar";
import { Home } from "./Home";
import { SessionView } from "./SessionView";
import { RightRail, SidePanel } from "../panel/SidePanel";
import { SchedulesView } from "../schedules/SchedulesView";
import { Backdrop } from "../ui/Backdrop";
import { useShortcuts } from "../../hooks/useShortcuts";

const SIDEBAR_W = 268;
const ease = { type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * Desktop / tablet layout:
 *   sidebar · chat · [tools panel] · rail
 * Regions sit flush to the window edges, split by hairlines. A background
 * photo (if any) spans the window; each region frosts over it with its own
 * material (styles.css → Materials).
 */
export function AppShell({ compact = false }: { compact?: boolean }) {
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const bd = backdropSettings(useUI((s) => s.backdrop));
  const homeCompact = useUI((s) => s.homeCompact);
  const activeId = useChat((s) => s.activeId);
  const view = useUI((s) => s.view);
  const root = useChat((s) => (s.activeId ? s.sessions[s.activeId]?.location.directory : null) ?? s.projectDir ?? s.homeDir);
  const isHome = view === "chat" && !activeId;
  const rowRef = useRef<HTMLDivElement>(null);

  useShortcuts();

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-bg">
      {bd.on && <Backdrop />}

      <motion.aside initial={false} animate={{ width: sidebarOpen ? SIDEBAR_W : 0 }} transition={ease} className={`surface-sidebar relative z-[1] h-full shrink-0 overflow-hidden ${sidebarOpen ? "border-r border-line" : ""}`}>
        <div className="h-full" style={{ width: SIDEBAR_W }}>
          <Sidebar />
        </div>
      </motion.aside>

      <div ref={rowRef} className="relative z-[1] flex h-full min-w-0 flex-1">
        <main className={`relative h-full min-w-0 flex-1 overflow-hidden ${(isHome || (view === "chat" && activeId)) && bd.on ? "" : "surface-panel"}`}>
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

      <RightRail />
    </div>
  );
}
