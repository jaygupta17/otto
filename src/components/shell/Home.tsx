import { AnimatePresence, motion } from "motion/react";
import { PanelLeft, RotateCw } from "lucide-react";
import { useMemo } from "react";
import { Composer } from "../chat/Composer";
import { ProjectPicker } from "../chat/Pickers";
import { WorkspaceIcon } from "./Sidebar";
import { AgentClock, Spinner } from "../ui/AgentClock";
import { Button, IconButton } from "../ui/Button";
import { useTrafficLights } from "../../hooks/useChrome";
import { sortedSessions, useChat } from "../../state/chat";
import { useConnection } from "../../state/connection";
import { useUI } from "../../state/ui";
import { useActiveWorkspace } from "../../state/workspaces";
import { basename, timeAgo } from "../../lib/format";
import { openExternal } from "../../lib/platform";
import { BOAT_BILLING_URL } from "../../lib/providers/boat";
import { BOXD_BILLING_URL } from "../../lib/providers/boxd";
import { E2B_BILLING_URL } from "../../lib/providers/e2b";
import { DAYTONA_BILLING_URL } from "../../lib/providers/daytona";
import { useWorkspaces } from "../../state/workspaces";
import { kbd } from "../../hooks/useShortcuts";
import { SessionHistory } from "../chat/SessionHistory";
import { PanelToggle } from "../panel/SidePanel";
import { Bird } from "../ui/Bird";
import { useTeammate } from "../../state/teammates";
import type { Teammate } from "../../lib/teammates";
import { Sky } from "../ui/Hero";
import { Pip } from "../ui/Pip";

/**
 * New-session screen: the prompt, its context and recent sessions, centred on the panel.
 */
export function Home({ compact = false }: { compact?: boolean }) {
  const ws = useActiveWorkspace();
  const sessions = useChat((s) => s.sessions);
  const busy = useChat((s) => s.busy);
  const open = useChat((s) => s.open);
  const recent = useMemo(() => sortedSessions(sessions).slice(0, 6), [sessions]);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const toggleSidebar = useUI((s) => s.toggleSidebar);
  const mac = useTrafficLights();
  // Starting a conversation with a teammate is meeting them: their face and their words.
  const mate = useTeammate(useChat((s) => s.pickedAgent));

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Weather along both edges; the middle, where you write, stays clear. */}
      <Sky height={compact ? 180 : 260} />
      <header className={`drag relative z-10 flex h-[52px] shrink-0 items-center gap-2 pr-3 ${!sidebarOpen && mac ? "pl-[84px]" : "pl-3"}`} data-tauri-drag-region>
        {!sidebarOpen && (
          <IconButton label="Show sidebar" keys={kbd("⌘B")} className="no-drag" onClick={() => toggleSidebar(true)}>
            <PanelLeft size={17} />
          </IconButton>
        )}
        <div className="flex-1" data-tauri-drag-region />
        <SessionHistory sessionId={null} />
        <PanelToggle />
      </header>
      <div className="scroll-quiet relative min-h-0 flex-1 overflow-y-auto px-5">
        {/* Compact home has no recent list, so the prompt block can
            sit in the middle of the pane; min-h-full keeps it centred only when
            there is room, and the pane still scrolls once it grows past it. */}
        <div className={`mx-auto w-full max-w-[660px] ${compact ? "flex min-h-full flex-col justify-center py-10" : "pt-[14vh] pb-16"}`}>
          {mate ? <Hello mate={mate} compact={compact} /> : <h1 className={`mb-5 font-semibold text-ink ${compact ? "text-[22px] tracking-[-0.015em]" : "text-[30px] tracking-[-0.022em]"}`}>What should the agent work on?</h1>}

          <ConnectionBanner />

          <Composer
            sessionId={null}
            autoFocus
            // Phone-sized tools are for phones; a narrow window still has a pointer.
            placeholder={mate ? "Ask anything, or hand over a task" : "Describe a task, ask a question, or paste an error"}
            tray={
              <>
                <span className="surface-thin inline-flex rounded-full">
                  <ProjectPicker />
                </span>
                <span className="ml-auto inline-flex h-7 min-w-0 items-center gap-1.5 px-2.5 text-muted">
                  <WorkspaceIcon provider={ws?.provider ?? "boat"} size={13} />
                  <span className="truncate">{ws?.name}</span>
                </span>
              </>
            }
          />

          {recent.length > 0 && !compact && (
            <section className="mt-12">
              <h2 className="mb-2 px-1 text-[12px] font-medium text-muted">Recent</h2>
              <ul className="flex flex-col gap-1.5">
                {recent.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => open(s.id)} className="surface-thin flex h-11 w-full items-center gap-3 rounded-2xl px-4 text-left">
                      {busy[s.id] && <AgentClock size={12} />}
                      <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{s.title || "New session"}</span>
                      <span className="hidden shrink-0 truncate text-[12px] text-muted sm:block">{basename(s.location.directory)}</span>
                      <span className="w-9 shrink-0 text-right text-[12px] text-faint font-mono tabular-nums">{timeAgo(s.time.updated)}</span>
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

/** The teammate, introducing themselves: face, name, then their greeting. */
function Hello({ mate, compact }: { mate: Teammate; compact: boolean }) {
  // It nods along with each word you type to it.
  const words = useChat((s) => (s.drafts.new ?? "").trim().split(/\s+/).filter(Boolean).length);
  const typing = words > 0;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={mate.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className={`flex items-center gap-4 ${compact ? "mb-4" : "mb-6"}`}
      >
        {/* Listening while you write: a little attentive, then back to itself. */}
        <Bird bird={mate.bird} seed={mate.face} size={compact ? 52 : 68} follow attentive={typing} interactive pulse={words} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-ink-2">{mate.name}</div>
          <h1 className={`mt-0.5 font-semibold tracking-[-0.01em] text-ink ${compact ? "text-[20px]" : "text-[26px]"}`}>{mate.greeting || `What should ${mate.name} work on?`}</h1>
        </div>
      </motion.div>
    </AnimatePresence>
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
      {status === "error" ? <Pip tone="error" /> : <Spinner size={15} className="shrink-0 text-muted" />}
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
