import { AnimatePresence, motion, useDragControls } from "motion/react";
import { ChevronDown, ChevronLeft, FolderTree, MoreHorizontal, Plus, Search, Settings, Trash2, Pencil, Cloud, Check, AlarmClock, Bot } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SessionInfo } from "@opencode/client";
import { sortedSessions, useChat } from "../../state/chat";
import { useConnection } from "../../state/connection";
import { useActiveWorkspace, useWorkspaces } from "../../state/workspaces";
import { useUI, backdropSettings, type PanelSurface } from "../../state/ui";
import { useComputer } from "../../state/computer";
import { basename, timeAgo } from "../../lib/format";
import { deleteSession, renameSession } from "../../lib/actions";
import { useNow } from "../../hooks/useNow";
import { Thread } from "../chat/Thread";
import { useBack } from "../../lib/back";
import { Composer } from "../chat/Composer";
import { ProjectPicker } from "../chat/Pickers";
import { Sheet } from "../ui/Sheet";
import { InboxButton } from "../shell/Inbox";
import { UpdatePill } from "../shell/UpdateControls";
import { PanelChrome, SURFACES, SurfaceBody } from "../panel/SidePanel";
import { Popover, MenuItem } from "../ui/Popover";
import { AgentClock } from "../ui/AgentClock";
import { Backdrop } from "../ui/Backdrop";
import { BackgroundStrip, InboxTray } from "../chat/SessionExtras";
import { AskDock } from "../chat/Asks";
import { ChatScrim, PanelFade } from "../ui/ChatScrim";
import { AppGlyph } from "../ui/Mark";
import { ConnectionBanner } from "../shell/Home";
import { AgentMark, TeammateFace, type FaceState } from "../ui/TeammateFace";
import { useTeammate, useTeammates } from "../../state/teammates";
import { FilesPanel } from "../files/FilesPanel";
import { EditorBody } from "../files/Editor";
import { SchedulesView } from "../schedules/SchedulesView";
import { statusText } from "../shell/Sidebar";
import { SessionHistory } from "../chat/SessionHistory";

/** Phone layout: a two-level stack (sessions → session) with swipe-back. */
export function MobileApp() {
  const activeId = useChat((s) => s.activeId);
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const draftOpen = useUI((s) => s.draftOpen);
  const setDraftOpen = useUI((s) => s.setDraftOpen);
  const pushed = !!activeId || draftOpen || view === "schedules";
  const bd = backdropSettings(useUI((s) => s.backdrop));
  useBack(view === "schedules", () => setView("chat"));
  useBack(!!activeId && view !== "schedules", () => useChat.getState().open(null));
  useBack(draftOpen && view !== "schedules", () => setDraftOpen(false));
  // Opening a chat (from history, search, a notification) replaces the draft, or it keeps covering the chat.
  useLayoutEffect(() => {
    if (activeId) setDraftOpen(false);
  }, [activeId, setDraftOpen]);

  // Same materials as desktop (styles.css → Materials): the photo sits behind
  // every screen and each screen frosts over it instead of painting a solid fill.
  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      {bd.on && <Backdrop />}
      <SessionsScreen onNew={() => setDraftOpen(true)} dimmed={pushed} />
      <AnimatePresence>
        {view === "schedules" ? (
          <motion.div key="schedules" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 380, damping: 40 }} className="surface-panel absolute inset-0 z-10 shadow-pop">
            <SchedulesView compact onBack={() => setView("chat")} />
          </motion.div>
        ) : (
          draftOpen ? <DraftScreen key="draft" /> : activeId && <SessionScreen key={activeId} sessionId={activeId} />
        )}
      </AnimatePresence>
    </div>
  );
}

function SessionsScreen({ onNew, dimmed }: { onNew: () => void; dimmed: boolean }) {
  const sessions = useChat((s) => s.sessions);
  const busy = useChat((s) => s.busy);
  const loaded = useChat((s) => s.sessionsLoaded);
  const [q, setQ] = useState("");
  const now = useNow(true, 30_000);
  const working = Object.keys(busy).filter((id) => busy[id] && sessions[id]).length;

  const [active, recent] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = sortedSessions(sessions).filter((s) => !term || (s.title ?? "").toLowerCase().includes(term));
    return [list.filter((s) => busy[s.id]), list.filter((s) => !busy[s.id])];
  }, [sessions, busy, q]);

  return (
    <motion.div animate={{ x: dimmed ? "-28%" : 0, opacity: dimmed ? 0 : 1 }} transition={{ type: "spring", stiffness: 380, damping: 40 }} className="absolute inset-0 flex flex-col">
      {/* The list is the whole screen, like the desktop home: the photo stays crisp
          and a soft shade (stronger when the photo fights the theme) keeps text legible. */}
      <div aria-hidden className="list-scrim pointer-events-none absolute inset-0" />
      <div className="on-photo scroll-quiet relative min-h-0 flex-1 overflow-y-auto pb-36">
        <div className="safe-top px-5">
          <div className="flex h-14 items-center justify-end gap-2 pt-2">
            <RoundButton label="Scheduled" onClick={() => useUI.getState().setView("schedules")}>
              <AlarmClock size={19} />
            </RoundButton>
            <InboxButton size={44} buttonClassName="surface-float bg-raised rounded-full! border border-line text-ink!" />
            <RoundButton label="Settings" onClick={() => useUI.getState().openSettings()}>
              <Settings size={19} />
            </RoundButton>
          </div>
          <h1 className="mt-1 text-[34px] font-bold">Sessions</h1>
          <WorkspaceSwitcher />
          <div className="field mt-4 flex h-10 items-center gap-2 rounded-2xl px-3.5">
            <Search size={16} className="text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
          </div>
          <div className="mt-3">
            <ConnectionBanner />
          </div>
          <UpdatePill className="mt-2 text-[14px] [&>button]:h-11" />
        </div>
        {!q && <TeamStrip onNew={onNew} />}
        {!loaded && <div className="mt-10 flex justify-center text-muted"><AgentClock /></div>}
        {loaded && active.length + recent.length === 0 && (
          <div className="mt-16 flex flex-col items-center px-10 text-center">
            <AppGlyph size={52} />
            <div className="mt-5 text-[17px] font-semibold">No sessions yet</div>
            <div className="mt-1 text-[14px] text-muted">Agents keep working while your phone is locked.</div>
          </div>
        )}
        {active.length > 0 && <Group label="Working" count={active.length} list={active} now={now} />}
        {recent.length > 0 && <Group label="Recent" count={recent.length} list={recent} now={now} />}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pt-10 pb-[calc(var(--safe-b)+12px)]" style={{ background: "linear-gradient(to bottom, transparent, var(--bg) 45%)" }}>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onNew}
          className="surface-float bg-raised pointer-events-auto flex h-[60px] w-full items-center gap-3 rounded-full border border-line pr-5 pl-2 shadow-pop"
        >
          <span className="grid h-11 w-11 place-items-center rounded-full bg-ink text-bg shadow-soft">
            <Plus size={22} />
          </span>
          <span className="text-[17px] font-medium">New session</span>
          {working > 0 && (
            <span className="ml-auto flex items-center gap-2 text-[14px] text-muted">
              <AgentClock /> {working} working
            </span>
          )}
        </motion.button>
      </div>
    </motion.div>
  );
}

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="surface-float bg-raised grid h-11 w-11 place-items-center rounded-full border border-line">
      {children}
    </button>
  );
}

/** Which workspace this is and how it's doing; tap to switch or add one. */
function WorkspaceSwitcher() {
  const ws = useActiveWorkspace();
  const status = useConnection((s) => s.status);
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeId = useWorkspaces((s) => s.activeId);
  const setActive = useWorkspaces((s) => s.setActive);
  const addWs = useUI((s) => s.setAddWorkspace);
  const openSettings = useUI((s) => s.openSettings);
  return (
    <>
      <button ref={anchor} onClick={() => setOpen(true)} className="-mx-1 mt-1 flex max-w-full items-center gap-2 rounded-lg px-1 py-1 text-[13.5px] text-muted active:bg-hover">
        <span className={`h-2 w-2 shrink-0 rounded-full ${status === "ready" ? "bg-ok" : status === "error" ? "bg-danger" : "animate-pulse bg-warn"}`} />
        <span className="truncate">
          {ws?.name} · {statusText(status)}
        </span>
        <ChevronDown size={14} className="shrink-0 opacity-70" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="bottom-start" width={270}>
        <div className="p-1.5">
          <div className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold text-faint">Workspaces</div>
          {workspaces.map((w) => (
            <MenuItem key={w.id} icon={<Cloud size={15} />} label={w.name} active={w.id === activeId} right={w.id === activeId ? <Check size={15} className="text-muted" /> : undefined} onClick={() => (void setActive(w.id), setOpen(false))} />
          ))}
          <MenuItem icon={<Plus size={15} />} label="Add workspace" onClick={() => (setOpen(false), addWs(true))} />
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<Bot size={15} />} label="Agents & tools" onClick={() => (setOpen(false), openSettings("agents"))} />
        </div>
      </Popover>
    </>
  );
}

function Group({ label, count, list, now }: { label: string; count: number; list: SessionInfo[]; now: number }) {
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 px-5 pb-2 text-[15px] font-semibold text-muted">
        {label} <span className="text-faint">{count}</span>
      </div>
      <div>
        {list.map((s) => (
          <Row key={s.id} s={s} now={now} />
        ))}
      </div>
    </div>
  );
}

const Row = memo(function Row({ s, now }: { s: SessionInfo; now: number }) {
  const busy = useChat((st) => !!st.busy[s.id]);
  const unread = useChat((st) => !!st.unread[s.id]);
  const asking = useChat((st) => Object.values(st.permissions).some((p) => p.sessionID === s.id) || Object.values(st.forms).some((f) => f.sessionID === s.id));
  const open = useChat((st) => st.open);
  // A teammate's session wears their face, which carries the state itself.
  const mate = useTeammate(s.agent);
  return (
    <motion.button whileTap={{ backgroundColor: "var(--hover)" }} onClick={() => open(s.id)} className="flex w-full items-start gap-3 px-5 py-3 text-left">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center">
        {mate ? (
          <AgentMark id={s.agent} size={28} state={asking ? "needs" : busy ? "working" : unread ? "done" : "idle"} />
        ) : busy ? (
          <AgentClock size={13} />
        ) : asking ? (
          <span className="h-2.5 w-2.5 rounded-full bg-info" />
        ) : unread ? (
          <span className="h-2 w-2 rounded-full bg-ink" />
        ) : s.outcome === "failed" ? (
          <span className="h-2 w-2 rounded-full bg-danger" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate text-[17px] ${unread ? "font-semibold" : "font-medium"}`}>{s.title || "New session"}</span>
          <span className={`shrink-0 text-[14px] ${busy ? " font-medium" : "text-faint"}`}>{busy ? "Working" : timeAgo(s.time.updated, now)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[14px] text-muted">
          <span className="truncate">{basename(s.location.directory)}</span>
        </span>
      </span>
    </motion.button>
  );
});


function SessionScreen({ sessionId }: { sessionId: string }) {
  const session = useChat((s) => s.sessions[sessionId]);
  const open = useChat((s) => s.open);
  const ws = useActiveWorkspace();
  const status = useConnection((s) => s.status);
  const drag = useDragControls();
  const [menu, setMenu] = useState(false);
  const [files, setFiles] = useState(false);
  const [tool, setTool] = useState<PanelSurface | null>(null);
  const closeFiles = () => {
    const ui = useUI.getState();
    for (const f of ui.editorFiles) ui.closeEditorFile(f);
  };
  // Links tapped in chat or a terminal open in the Browser page.
  const browserN = useUI((s) => s.browserRequest?.n);
  const seenN = useRef(browserN);
  useEffect(() => {
    if (browserN !== seenN.current) {
      seenN.current = browserN;
      setTool("browser");
    }
  }, [browserN]);
  // So does taking control of the agent's screen (a handoff card's button).
  const takenN = useComputer((s) => s.opened);
  const seenTaken = useRef(takenN);
  useEffect(() => {
    if (takenN !== seenTaken.current) {
      seenTaken.current = takenN;
      setTool("browser");
    }
  }, [takenN]);
  const activeFile = useUI((s) => s.activeFile);
  const moreRef = useRef<HTMLButtonElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState(120);

  useLayoutEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setInset(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 380, damping: 40 }}
      drag="x"
      dragControls={drag}
      dragListener={false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.9 }}
      onDragEnd={(_, info) => {
        if (info.offset.x > 110 || info.velocity.x > 500) open(null);
      }}
      className="chat-surface on-scrim absolute inset-0 z-10 flex flex-col shadow-pop"
    >
      <ChatScrim />
      <div className="absolute inset-y-0 left-0 z-30 w-5 touch-none" onPointerDown={(e) => drag.start(e)} />
      <header className="safe-top relative z-20 shrink-0">
        <div className="flex h-[60px] items-center gap-2 border-b border-line px-3">
          <button onClick={() => open(null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-hover" aria-label="Back">
            <ChevronLeft size={22} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-[16px] font-semibold">{session?.title || "New session"}</div>
            <div className="truncate text-[12.5px] text-muted">
              {basename(session?.location.directory ?? "")} @ {ws?.name}
              {status !== "ready" && ` · ${statusText(status).toLowerCase()}`}
            </div>
          </div>
          <SessionHistory sessionId={sessionId} phone />
          <button onClick={() => setFiles(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-hover" aria-label="Files">
            <FolderTree size={19} />
          </button>
          <button ref={moreRef} onClick={() => setMenu(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-hover" aria-label="More">
            <MoreHorizontal size={20} />
          </button>
        </div>
      </header>
      <Popover open={menu} onClose={() => setMenu(false)} anchor={moreRef.current} placement="bottom-end" width={220}>
        <div className="p-1.5">
          {SURFACES.filter((x) => x.id !== "files").map((x) => (
            <MenuItem key={x.id} icon={x.icon(15)} label={x.label} onClick={() => (setMenu(false), setTool(x.id))} />
          ))}
          <div className="my-1 h-px bg-line" />
          <MenuItem
            icon={<Pencil size={15} />}
            label="Rename"
            onClick={() => {
              setMenu(false);
              void renameSession(sessionId);
            }}
          />
          <MenuItem icon={<Trash2 size={15} />} label="Delete" danger onClick={() => (setMenu(false), void deleteSession(sessionId))} />
        </div>
      </Popover>

      <Thread sessionId={sessionId} bottomInset={inset} />

      <div
        ref={composerRef}
        className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3"
      >
        <PanelFade className="h-16" />
        <div className="panel-fill pointer-events-auto pb-2">
          <AskDock sessionId={sessionId} />
          <BackgroundStrip sessionId={sessionId} />
          <InboxTray sessionId={sessionId} />
          <Composer sessionId={sessionId} compact placeholder="Message your agent" />
        </div>
      </div>

      {/* Pages stack: a file opened from Files goes back to Files. A phone has no tabs, so back closes them all. */}
      <Sheet open={files} onClose={() => setFiles(false)} compact title={basename(session?.location.directory ?? "") || "Files"}>
        <div className="h-sheet">{session && <FilesPanel root={session.location.directory} bare />}</div>
      </Sheet>
      <Sheet open={!!tool} onClose={() => setTool(null)} compact bare>
        <div className="flex h-sheet flex-col">
          <PanelChrome value={{ docked: false, onClose: () => setTool(null) }}>
            {tool && <SurfaceBody surface={tool} root={session?.location.directory ?? null} sessionId={sessionId} />}
          </PanelChrome>
        </div>
      </Sheet>
      <Sheet open={!!activeFile} onClose={closeFiles} compact title={activeFile ? basename(activeFile) : undefined}>
        <div className="flex h-sheet flex-col">{session && activeFile && <EditorBody root={session.location.directory} />}</div>
      </Sheet>
    </motion.div>
  );
}

/**
 * A new session on the phone: the same screen as a session, empty until the
 * first message. Sending closes the draft and opens the session it made.
 */
/**
 * The team, by face, above the sessions: who's working, who needs you, who
 * has news. Tapping one starts a conversation with them.
 */
function TeamStrip({ onNew }: { onNew: () => void }) {
  const roster = useTeammates((s) => s.byId);
  const team = useMemo(() => Object.values(roster ?? {}).sort((a, b) => Number(b.leads) - Number(a.leads) || a.created - b.created), [roster]);
  if (!team.length) return null;
  return (
    <div className="scroll-quiet mt-5 flex snap-x gap-1 overflow-x-auto px-3 pb-1" role="list" aria-label="Teammates">
      {team.map((t) => (
        <TeamFace key={t.id} id={t.id} onNew={onNew} />
      ))}
    </div>
  );
}

function TeamFace({ id, onNew }: { id: string; onNew: () => void }) {
  const t = useTeammate(id)!;
  const state = useChat((st): FaceState => {
    // Its own sessions, plus parts of a lead's job it's doing.
    const mine = [...Object.values(st.sessions).filter((x) => x.agent === id).map((x) => x.id), ...Object.keys(st.delegated).filter((c) => st.delegated[c] === id)];
    if (mine.some((x) => Object.values(st.permissions).some((p) => p.sessionID === x) || Object.values(st.forms).some((f) => f.sessionID === x))) return "needs";
    if (mine.some((x) => st.busy[x])) return "working";
    return mine.some((x) => st.unread[x]) ? "done" : "idle";
  });
  return (
    <motion.button
      role="listitem"
      whileTap={{ scale: 0.94 }}
      onClick={() => {
        void useChat.getState().setAgent(id, null);
        onNew();
      }}
      aria-label={`New session with ${t.name}${state === "needs" ? ", needs you" : state === "working" ? ", working" : ""}`}
      className="flex w-[76px] shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl py-2"
    >
      <TeammateFace seed={t.face} color={t.color} accessory={t.accessory} size={52} state={state} />
      <span className={`max-w-full truncate text-[13px] ${state === "needs" ? "font-medium text-info" : "text-ink-2"}`}>{t.name}</span>
    </motion.button>
  );
}

/** Meeting the teammate a new session is with: face, name, greeting, their starters. */
function DraftIntro() {
  const mate = useTeammate(useChat((s) => s.pickedAgent));
  const words = useChat((s) => (s.drafts.new ?? "").trim().split(/\s+/).filter(Boolean).length);
  const typing = words > 0;
  if (!mate)
    return (
      <>
        <AppGlyph size={36} />
        <div className="mt-5 text-[20px] font-semibold">What are we building?</div>
      </>
    );
  return (
    <motion.div key={mate.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex w-full flex-col items-center">
      <TeammateFace seed={mate.face} color={mate.color} accessory={mate.accessory} size={88} attentive={typing} interactive pulse={words} label={mate.name} />
      <div className="mt-4 text-[14px] font-medium text-ink-2">{mate.name}</div>
      <div className="mt-1 text-[22px] leading-tight font-semibold">{mate.greeting || `What should ${mate.name} work on?`}</div>
      {mate.tagline && <div className="mt-2 max-w-[300px] text-[14px] text-muted">{mate.tagline}</div>}
    </motion.div>
  );
}

function DraftScreen() {
  const open = useChat((s) => s.open);
  const ws = useActiveWorkspace();
  const drag = useDragControls();
  const setDraftOpen = useUI((s) => s.setDraftOpen);
  const close = () => setDraftOpen(false);
  const mate = useTeammate(useChat((s) => s.pickedAgent));
  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 380, damping: 40 }}
      drag="x"
      dragControls={drag}
      dragListener={false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.9 }}
      onDragEnd={(_, info) => {
        if (info.offset.x > 110 || info.velocity.x > 500) close();
      }}
      className="chat-surface on-scrim absolute inset-0 z-10 flex flex-col shadow-pop"
    >
      <ChatScrim />
      <div className="absolute inset-y-0 left-0 z-30 w-5 touch-none" onPointerDown={(e) => drag.start(e)} />
      <header className="safe-top relative z-20 shrink-0">
        <div className="flex h-[60px] items-center gap-2 border-b border-line px-3">
          <button onClick={close} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-hover" aria-label="Back">
            <ChevronLeft size={22} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="truncate text-[16px] font-semibold">New session</div>
            {/* The folder picker sits under the composer; say only where it runs. */}
            <div className="truncate text-[12.5px] text-muted">{ws?.name}</div>
          </div>
          <SessionHistory sessionId={null} phone />
        </div>
      </header>
      <div className="scroll-quiet flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-6 pb-6 text-center">
        <DraftIntro />
      </div>
      <div className="safe-bottom relative z-10 px-3">
        <div className="panel-fill pb-2">
          <Composer
            sessionId={null}
            compact
            placeholder={mate ? `Ask ${mate.name}, or hand over a task` : "Describe the task"}
            onSent={(id) => {
              setDraftOpen(false);
              open(id);
            }}
          />
          <div className="mt-2 flex items-center px-1">
            <ProjectPicker />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
