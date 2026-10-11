import { AnimatePresence, motion } from "motion/react";
import { useCallback, useRef } from "react";
import { useChat } from "../../state/chat";
import { useUI, backdropSettings } from "../../state/ui";
import { Sidebar } from "./Sidebar";
import { Home } from "./Home";
import { SessionView } from "./SessionView";
import { FilesPanel } from "../files/FilesPanel";
import { Editor } from "../files/Editor";
import { SchedulesView } from "../schedules/SchedulesView";
import { Backdrop } from "../ui/Backdrop";
import { useShortcuts } from "../../hooks/useShortcuts";

const SIDEBAR_W = 268;
const TREE_W = 280;
const ease = { type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] } as const;

/**
 * Desktop / tablet layout:
 *   sidebar · chat · [editor] · [file tree]
 * Regions sit flush to the window edges, split by hairlines. A background
 * photo (if any) spans the window; each region frosts over it with its own
 * material (styles.css → Materials).
 */
export function AppShell({ compact = false }: { compact?: boolean }) {
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const filesOpen = useUI((s) => s.filesOpen);
  const toggleFiles = useUI((s) => s.toggleFiles);
  const activeFile = useUI((s) => s.activeFile);
  const chatWidth = useUI((s) => s.chatWidth);
  const bd = backdropSettings(useUI((s) => s.backdrop));
  const homeCompact = useUI((s) => s.homeCompact);
  const activeId = useChat((s) => s.activeId);
  const view = useUI((s) => s.view);
  const root = useChat((s) => (s.activeId ? s.sessions[s.activeId]?.location.directory : null) ?? s.projectDir ?? s.homeDir);
  const editorOpen = !!activeFile && !!root;
  const isHome = view === "chat" && !activeId;
  const rowRef = useRef<HTMLDivElement>(null);

  useShortcuts();

  const startResize = useResize(rowRef);

  return (
    <div
      className="relative flex h-full w-full overflow-hidden bg-bg"
    >
      {bd.on && <Backdrop />}

      <motion.aside initial={false} animate={{ width: sidebarOpen ? SIDEBAR_W : 0 }} transition={ease} className={`surface-sidebar relative z-[1] h-full shrink-0 overflow-hidden ${sidebarOpen ? "border-r border-line" : ""}`}>
        <div className="h-full" style={{ width: SIDEBAR_W }}>
          <Sidebar />
        </div>
      </motion.aside>

      <div ref={rowRef} className="relative z-[1] flex h-full min-w-0 flex-1">
        <main
          className={`relative h-full min-w-0 overflow-hidden ${isHome && bd.on ? "" : "surface-panel"}`}
          style={editorOpen ? { width: chatWidth, flex: "none" } : { flex: "1 1 0%" }}
        >
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

        {editorOpen && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize chat and editor"
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={(e) => {
                const ui = useUI.getState();
                if (e.key === "ArrowLeft") ui.setChatWidth(Math.max(340, ui.chatWidth - 24));
                if (e.key === "ArrowRight") ui.setChatWidth(ui.chatWidth + 24);
              }}
              className="group relative z-10 w-px shrink-0 cursor-col-resize bg-line outline-none"
            >
              <span className="absolute inset-y-0 -left-1.5 -right-1.5 transition-colors group-hover:bg-line group-focus-visible:bg-line-strong" />
            </div>
            <section aria-label="Editor" className="surface-panel relative h-full min-w-0 flex-1 overflow-hidden">
              <Editor root={root!} />
            </section>
          </>
        )}

        <motion.aside
          aria-label="Files"
          initial={false}
          animate={{ width: filesOpen && root ? TREE_W : 0 }}
          transition={ease}
          className="h-full shrink-0 overflow-hidden"
        >
          <div className="surface-panel relative h-full overflow-hidden border-l border-line" style={{ width: TREE_W }}>
            {root && <FilesPanel root={root} onClose={() => toggleFiles(false)} />}
          </div>
        </motion.aside>
      </div>
    </div>
  );
}

/** Drag the divider between chat and editor. */
function useResize(rowRef: React.RefObject<HTMLDivElement | null>) {
  return useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const row = rowRef.current;
      if (!row) return;
      const left = row.getBoundingClientRect().left;
      const max = row.getBoundingClientRect().width * 0.7;
      const move = (ev: PointerEvent) => useUI.getState().setChatWidth(Math.min(max, Math.max(340, ev.clientX - left)));
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        document.body.style.cursor = "";
      };
      document.body.style.cursor = "col-resize";
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [rowRef],
  );
}
