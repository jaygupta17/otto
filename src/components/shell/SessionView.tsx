import { PanelLeft, SquarePen } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useChat } from "../../state/chat";
import { useUI } from "../../state/ui";
import { Thread } from "../chat/Thread";
import { Composer } from "../chat/Composer";
import { SessionHistory } from "../chat/SessionHistory";
import { IconButton } from "../ui/Button";
import { basename, money } from "../../lib/format";
import { useTrafficLights } from "../../hooks/useChrome";
import { ConnectionBanner } from "./Home";
import { ChatScrim, PanelFade } from "../ui/ChatScrim";
import { BackgroundStrip, InboxTray } from "../chat/SessionExtras";
import { AskDock } from "../chat/Asks";
import { kbd } from "../../hooks/useShortcuts";

/** Desktop session pane: header, thread, floating composer. */
export function SessionView({ sessionId }: { sessionId: string }) {
  const session = useChat((s) => s.sessions[sessionId]);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const open = useChat((s) => s.open);
  const composerRef = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(140);

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setInset(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const mac = useTrafficLights();
  return (
    <div className="on-scrim relative flex h-full min-w-0 flex-col">
      <ChatScrim />
      <header className={`drag relative z-10 flex h-[52px] shrink-0 items-center gap-2 pr-3 ${!sidebarOpen && mac ? "pl-[84px]" : "pl-3"}`} data-tauri-drag-region>
        {!sidebarOpen && (
          <>
            <IconButton label={`Show sidebar (${kbd("⌘B")})`} className="no-drag" onClick={() => toggleSidebar(true)}>
              <PanelLeft size={17} />
            </IconButton>
            <IconButton label="New session" className="no-drag" onClick={() => open(null)}>
              <SquarePen size={17} />
            </IconButton>
          </>
        )}
        <div className="min-w-0 flex-1 px-1" data-tauri-drag-region>
          <div className="flex min-w-0 items-baseline gap-2" data-tauri-drag-region>
            <span className="truncate text-[14px] font-semibold text-ink" data-tauri-drag-region>
              {session?.title || "New session"}
            </span>
            {session && (
              <span className="hidden shrink-0 truncate text-[12.5px] text-faint sm:inline" data-tauri-drag-region>
                {basename(session.location.directory)}
                {session.cost > 0 && ` · ${money(session.cost)}`}
              </span>
            )}
          </div>
        </div>
        <SessionHistory sessionId={sessionId} />
      </header>

      <Thread sessionId={sessionId} bottomInset={inset} />

      <div ref={composerRef} className="pointer-events-none absolute inset-x-0 bottom-0 z-10">
        <PanelFade className="h-[88px]" />
        <div className="panel-fill pointer-events-auto px-5 pb-4 sm:px-8">
          <div className="mx-auto w-full max-w-[760px]">
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
