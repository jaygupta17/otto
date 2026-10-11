import { motion } from "motion/react";
import { Cloud, PanelLeft, RotateCw, Server } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import { Composer } from "../chat/Composer";
import { ProjectPicker } from "../chat/Pickers";
import { AgentClock, Spinner } from "../ui/AgentClock";
import { Button, IconButton } from "../ui/Button";
import { useTrafficLights } from "../../hooks/useChrome";
import { sortedSessions, useChat } from "../../state/chat";
import { useConnection } from "../../state/connection";
import { useUI, backdropSettings } from "../../state/ui";
import { useActiveWorkspace } from "../../state/workspaces";
import { basename, timeAgo } from "../../lib/format";
import { openExternal } from "../../lib/platform";
import { BOAT_BILLING_URL } from "../../lib/providers/boat";
import { BOXD_BILLING_URL } from "../../lib/providers/boxd";
import { E2B_BILLING_URL } from "../../lib/providers/e2b";
import { DAYTONA_BILLING_URL } from "../../lib/providers/daytona";
import { useWorkspaces } from "../../state/workspaces";

/**
 * New-session screen. With a background photo there is no panel here at all:
 * the photo is the surface, and the prompt, its context and recent sessions
 * float over it as separate pieces of glass.
 */
export function Home({ compact = false }: { compact?: boolean }) {
  const ws = useActiveWorkspace();
  const sessions = useChat((s) => s.sessions);
  const busy = useChat((s) => s.busy);
  const open = useChat((s) => s.open);
  const photo = backdropSettings(useUI((s) => s.backdrop)).on;
  const recent = useMemo(() => sortedSessions(sessions).slice(0, photo ? 4 : 6), [sessions, photo]);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const mac = useTrafficLights();
  // Compact home drops its header — except while the sidebar is collapsed,
  // where that strip is the window's drag surface and the only visible way back
  // to the sidebar.
  const header = !compact || !sidebarOpen;

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {photo && <div aria-hidden className="home-scrim pointer-events-none absolute inset-0" style={compact ? ({ "--scrim-y": "50%" } as CSSProperties) : undefined} />}
      {header && (
        <header className={`drag relative z-10 flex h-[52px] shrink-0 items-center gap-2 pr-3 ${!sidebarOpen && mac ? "pl-[84px]" : "pl-3"}`} data-tauri-drag-region>
          {!sidebarOpen && (
            <IconButton label="Show sidebar (⌘B)" className="no-drag" onClick={() => toggleSidebar(true)}>
              <PanelLeft size={17} />
            </IconButton>
          )}
        </header>
      )}
      <div className="scroll-quiet relative min-h-0 flex-1 overflow-y-auto px-5">
        {/* Compact home has no header and no recent list, so the prompt block can
            sit in the middle of the pane; min-h-full keeps it centred only when
            there is room, and the pane still scrolls once it grows past it. */}
        <div className={`mx-auto w-full max-w-[660px] ${compact ? "flex min-h-full flex-col justify-center py-10" : "pt-[14vh] pb-16"}`}>
          <h1 className={`on-photo mb-5 font-semibold tracking-[-0.01em] text-ink ${compact ? "text-[20px]" : "text-[26px]"}`}>What should the agent work on?</h1>

          <ConnectionBanner />

          <Composer sessionId={null} autoFocus compact={compact} placeholder="Describe a task, ask a question, or paste an error" />

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="surface-thin inline-flex rounded-full">
              <ProjectPicker />
            </span>
            <span className="surface-thin inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-muted">
              {ws?.provider !== "custom" ? <Cloud size={13} /> : <Server size={13} />}
              {ws?.name}
            </span>
          </div>

          {recent.length > 0 && !compact && (
            <section className="mt-12">
              <h2 className="on-photo mb-2 px-1 text-[12px] font-medium text-muted">Recent</h2>
              <ul className="flex flex-col gap-1.5">
                {recent.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => open(s.id)} className="surface-thin flex h-11 w-full items-center gap-3 rounded-2xl px-4 text-left">
                      {busy[s.id] && <AgentClock size={12} />}
                      <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{s.title || "New session"}</span>
                      <span className="hidden shrink-0 truncate text-[12.5px] text-muted sm:block">{basename(s.location.directory)}</span>
                      <span className="w-9 shrink-0 text-right text-[12px] text-faint tabular-nums">{timeAgo(s.time.updated)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export function ConnectionBanner() {
  const status = useConnection((s) => s.status);
  const detail = useConnection((s) => s.detail);
  const error = useConnection((s) => s.error);
  const retry = useConnection((s) => s.retry);
  const billing = useConnection((s) => s.billing);
  if (status === "ready" || status === "idle") return null;
  const label = status === "waking" ? "Waking your sandbox" : status === "repairing" ? "Getting your agent ready" : status === "connecting" ? "Connecting" : "Can't reach your workspace";
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className={`mb-3 flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-[13px] ${status === "error" ? "border-danger/30 bg-danger-soft" : "border-line bg-raised"}`}
    >
      {status === "error" ? <span className="h-2 w-2 shrink-0 rounded-full bg-danger" /> : <Spinner size={15} className="shrink-0 text-muted" />}
      <div className="min-w-0 flex-1">
        <div className={`font-medium ${status === "error" ? "text-danger" : "text-ink"}`}>{label}</div>
        <div className={`selectable truncate ${status === "error" ? "text-ink-2" : "text-muted"}`}>{status === "error" ? error : (detail ?? "This usually takes a few seconds.")}</div>
      </div>
      {status === "error" && billing && (
        <Button size="sm" variant="secondary" onClick={() => openExternal(billingUrl())}>
          Billing
        </Button>
      )}
      {status === "error" && (
        <Button size="sm" variant="secondary" icon={<RotateCw size={13} />} onClick={retry}>
          Retry
        </Button>
      )}
    </motion.div>
  );
}

function billingUrl() {
  const st = useWorkspaces.getState();
  const p = st.workspaces.find((w) => w.id === st.activeId)?.provider;
  return p === "boxd" ? BOXD_BILLING_URL : p === "e2b" ? E2B_BILLING_URL : p === "daytona" ? DAYTONA_BILLING_URL : BOAT_BILLING_URL;
}
