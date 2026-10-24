import { PanelLeft, SquarePen } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { Thread } from "../chat/Thread";
import { Composer, Perch, usePerched } from "../chat/Composer";
import { SessionHistory } from "../chat/SessionHistory";
import { PanelToggle } from "../panel/SidePanel";
import { AgentPicker } from "../chat/Pickers";
import { IconButton } from "../ui/Button";
import { basename, money } from "../../lib/format";
import { useTrafficLights } from "../../hooks/useChrome";
import { ConnectionBanner } from "./Home";
import { PanelFade } from "../ui/ChatScrim";
import { BackgroundStrip, InboxTray } from "../chat/SessionExtras";
import { AskDock } from "../chat/Asks";
import { kbd } from "../../hooks/useShortcuts";

/** Height of the fade above the composer (`h-5`). */
const FADE = 20;
/** The bird standing on the composer. */
const PERCH = 56;

/** Desktop session pane: header, thread, floating composer. */
export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useChat((s) => s.sessions[sessionId]);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const open = useChat((s) => s.open);
  const composerRef = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(140);
  // The thread ends a little above a perched bird's head, not behind it.
  const rise = usePerched(sessionId) ? PERCH - FADE + 4 : 0;

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    // The fade overlaps the thread; only the solid part takes room.
    const ro = new ResizeObserver(() => setInset(el.offsetHeight - FADE));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mac = useTrafficLights();
  return (
    <div className="relative flex h-full min-w-0 flex-col">
      <header className={`drag relative z-10 flex h-[52px] shrink-0 items-center gap-2 pr-3 ${!sidebarOpen && mac ? "pl-[84px]" : "pl-3"}`} data-tauri-drag-region>
        {!sidebarOpen && (
          <>
            <IconButton label="Show sidebar" keys={kbd("⌘B")} className="no-drag" onClick={() => toggleSidebar(true)}>
              <PanelLeft size={17} />
            </IconButton>
            <IconButton label="New session" className="no-drag" onClick={() => open(null)}>
              <SquarePen size={17} />
            </IconButton>
          </>
        )}
        {/* Who you're talking to, like a messages app; the session's own title sits under the name. */}
        <AgentPicker
          sessionId={sessionId}
          header
          subtitle={
            <>
              {session?.title || "New session"}
              {session && <span className="text-faint"> · {basename(session.location.directory)}{session.cost > 0 && ` · ${money(session.cost)}`}</span>}
            </>
          }
        />
        <div className="h-full min-w-0 flex-1" data-tauri-drag-region />
        <SessionHistory sessionId={sessionId} />
        <PanelToggle />
      </header>

      <Thread sessionId={sessionId} bottomInset={inset + rise} />

      <div ref={composerRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <PanelFade className="h-5" />
        <div className="panel-fill pointer-events-auto px-5 pb-4 sm:px-8">
          <div className="relative mx-auto w-full max-w-[760px]">
            <Perch sessionId={sessionId} size={PERCH} />
            <ConnectionBanner />
            <AskDock sessionId={sessionId} />
            <BackgroundStrip sessionId={sessionId} />
            <InboxTray sessionId={sessionId} />
            <Composer sessionId={sessionId} autoFocus placeholder="Reply, or steer…" />
          </div>
        </div>
      </div>
    </div>
  );
}
