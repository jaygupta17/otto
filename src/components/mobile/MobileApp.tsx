import { AnimatePresence, motion, useDragControls } from "motion/react";
import { ChevronDown, FolderTree, MoreHorizontal, Plus, Search, SquarePen, Trash2, Pencil, Check, Settings } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SessionInfo } from "@opencode/client";
import { useChat } from "../../state/chat";
import { useConnection } from "../../state/connection";
import { useActiveWorkspace, useWorkspaces } from "../../state/workspaces";
import { useUI, type PanelSurface } from "../../state/ui";
import { useComputer } from "../../state/computer";
import { basename, timeAgo } from "../../lib/format";
import { deleteSession, renameSession } from "../../lib/actions";
import { useNow } from "../../hooks/useNow";
import { Thread } from "../chat/Thread";
import { useBack } from "../../lib/back";
import { Composer, Perch, usePerched } from "../chat/Composer";
import { AgentPicker, ProjectPicker } from "../chat/Pickers";
import { BackButton, Sheet } from "../ui/Sheet";
import { InboxButton } from "../shell/Inbox";
import { UpdatePill } from "../shell/UpdateControls";
import { PanelChrome, SURFACES, SurfaceBody } from "../panel/SidePanel";
import { Popover, MenuItem } from "../ui/Popover";
import { AgentClock } from "../ui/AgentClock";
import { BackgroundStrip, InboxTray } from "../chat/SessionExtras";
import { AskDock } from "../chat/Asks";
import { PanelFade } from "../ui/ChatScrim";
import { AppGlyph } from "../ui/Mark";
import { ConnectionBanner } from "../shell/Home";
import { AgentMark, Bird } from "../ui/Bird";
import { Spot, spot } from "../ui/Spot";
import { useAgentName, useTeammate, useTeammates, useTeammateState } from "../../state/teammates";
import { EmptyState } from "../ui/EmptyState";
import { Sky } from "../ui/Hero";
import { useFace } from "../../state/face";
import { Pip, connectionTone } from "../ui/Pip";
import { FilesPanel } from "../files/FilesPanel";
import { EditorBody } from "../files/Editor";
import { SchedulesView } from "../schedules/SchedulesView";
import { WorkspaceIcon, statusText } from "../shell/Sidebar";
import { useBackgroundLine, useDoing, useOfferedAgents, useSessionTiers } from "../../state/tiers";
import { SessionHistory } from "../chat/SessionHistory";
import { SettingsScreen, TabBar, TABS, TeamScreen, type Tab } from "./Tabs";

/**
 * Phone layout: four tabs (sessions, team, schedules, settings), with a
 * session or a new one pushed over them and swipe-back to leave it.
 * Schedules is the same place as the desktop's schedules view, so anything
 * that opens it (a notification, the agent) lands on that tab.
 */
export function MobileApp() {
  const activeId = useChat((s) => s.activeId);
  const view = useUI((s) => s.view);
  const setView = useUI((s) => s.setView);
  const draftOpen = useUI((s) => s.draftOpen);
  const setDraftOpen = useUI((s) => s.setDraftOpen);
  const [own, setOwn] = useState<Exclude<Tab, "schedules">>("sessions");
  const tab: Tab = view === "schedules" ? "schedules" : own;
  // Tabs keep their place (scroll, search) once visited.
  const [seen, setSeen] = useState<Set<Tab>>(() => new Set([tab]));
  if (!seen.has(tab)) setSeen(new Set(seen).add(tab));
  const pushed = !!activeId || draftOpen;
  const select = (t: Tab) => {
    // The current tab again goes back to its top.
    if (t === tab) return document.querySelector(`[data-tab="${t}"] [data-scroll-root]`)?.scrollTo({ top: 0, behavior: "smooth" });
    if (t === "schedules") return setView("schedules");
    setOwn(t);
    if (view === "schedules") setView("chat");
  };
  const newSession = () => setDraftOpen(true);
  const message = (agent: string) => {
    void useChat.getState().setAgent(agent, null);
    newSession();
  };
  useBack(!!activeId, () => useChat.getState().open(null));
  useBack(draftOpen && !activeId, () => setDraftOpen(false));
  // At another tab's root, back goes to Sessions before it leaves the app.
  useBack(!pushed && tab !== "sessions", () => select("sessions"));
  // Opening a chat (from history, search, a notification) replaces the draft, or it keeps covering the chat.
  useLayoutEffect(() => {
    if (activeId) setDraftOpen(false);
  }, [activeId, setDraftOpen]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <motion.div animate={{ x: pushed ? "-28%" : 0, opacity: pushed ? 0 : 1 }} transition={{ type: "spring", stiffness: 380, damping: 40 }} className="absolute inset-0 flex flex-col" inert={pushed || undefined}>
        <div className="relative min-h-0 flex-1">
          {TABS.filter((t) => seen.has(t.id)).map((t) => (
            <div key={t.id} data-tab={t.id} className={`absolute inset-0 flex-col ${tab === t.id ? "flex" : "hidden"}`}>
              {t.id === "sessions" ? (
                <SessionsScreen onNew={newSession} onMessage={message} />
              ) : t.id === "team" ? (
                <TeamScreen onMessage={message} />
              ) : t.id === "schedules" ? (
                <SchedulesView compact />
              ) : (
                <SettingsScreen />
              )}
            </div>
          ))}
        </div>
        <TabBar tab={tab} onSelect={select} />
      </motion.div>
      <AnimatePresence>{draftOpen ? <DraftScreen key="draft" /> : activeId && <SessionScreen key={activeId} sessionId={activeId} />}</AnimatePresence>
    </div>
  );
}

/**
 * The Sessions tab, by what wants you: the machine you're on (tap to switch),
 * sessions waiting on you, working or with a result you haven't seen, then the
 * team to start something with, then everything else by when it last moved.
 */
function SessionsScreen({ onNew, onMessage }: { onNew: () => void; onMessage: (agent: string) => void }) {
  const loaded = useChat((s) => s.sessionsLoaded);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const now = useNow(true, 30_000);
  const { active, recent } = useSessionTiers(q);
  const empty = active.length + recent.length === 0;
  // Someone already on an active card isn't offered again under Agents.
  const activeAgents = useMemo(() => new Set(active.map((s) => s.agent ?? "")), [active]);

  const endSearch = () => {
    setSearching(false);
    setQ("");
  };

  return (
    <>
      {/* Where you are leads the bar: the machine, as the pill its menu opens from. The bar frosts once the list moves under it. */}
      <header className={`topbar safe-top absolute inset-x-0 top-0 z-10 px-2 ${scrolled || searching ? "topbar-on" : ""}`}>
        {searching ? (
          <div className="box-content flex h-[52px] items-center gap-1 pt-4 pb-2 pl-2">
            <label className="field flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5">
              <Search size={16} className="shrink-0 text-faint" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions" aria-label="Search sessions" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
            </label>
            <button onClick={endSearch} className="h-11 shrink-0 px-2.5 text-[16px] text-ink">
              Cancel
            </button>
          </div>
        ) : (
          <div className="box-content flex h-[52px] items-center pt-4 pb-2 pl-2">
            <div className="flex min-w-0 flex-1">
              <WorkspaceSwitcher />
            </div>
            <TopButton label="Search" onClick={() => setSearching(true)}>
              <Search size={21} />
            </TopButton>
            <InboxButton size={44} buttonClassName="rounded-full! text-ink!" />
            <TopButton label="New session" onClick={onNew}>
              <SquarePen size={21} />
            </TopButton>
          </div>
        )}
      </header>

      <div
        data-scroll-root
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
        className="scroll-quiet relative min-h-0 flex-1 overflow-y-auto pb-6"
        style={{ paddingTop: "calc(var(--safe-t) + 84px)" }}
      >
        <div className="px-4">
          <ConnectionBanner />
          <UpdatePill className="mt-2 text-[14px] [&>button]:h-11" />
        </div>
        {!loaded && <div className="mt-10 flex justify-center text-muted"><AgentClock /></div>}
        {active.length > 0 && (
          <Section label="Active">
            <div className="space-y-2.5 px-4">
              {active.map((s) => (
                <ActiveCard key={s.id} s={s} now={now} />
              ))}
            </div>
          </Section>
        )}
        {!q.trim() && <AgentList busy={activeAgents} onMessage={onMessage} />}
        {loaded && empty && (
          <div className="mt-16 flex flex-col items-center px-10 text-center">
            {q ? (
              <div className="text-[15px] text-muted">No sessions match “{q.trim()}”</div>
            ) : (
              <EmptyState mark={<EmptyBird />} title="No sessions yet" body="Agents keep working while your phone is locked." className="!py-0" />
            )}
          </div>
        )}
        {recent.length > 0 && (
          <Section label="Recent">
            <div className="px-2">
              {recent.map((s, i) => (
                <RecentRow key={s.id} s={s} now={now} first={i === 0} />
              ))}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}

function TopButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink transition-colors active:bg-hover">
      {children}
    </button>
  );
}

/** The machine you're on, as a pill like the menu it opens: its icon, its name, a chevron. A pip shows only when it isn't connected. */
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
  const ready = status === "ready";
  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen(true)}
        aria-label={`${ws?.name ?? "Workspace"}, ${statusText(status)}. Switch workspace`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="bezel flex h-11 min-w-0 items-center gap-2.5 rounded-full pr-3.5 pl-1.5 text-left transition-transform active:scale-[0.98]"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-hover text-ink-2">
          <WorkspaceIcon provider={ws?.provider ?? "boat"} size={16} />
        </span>
        <span className="min-w-0 truncate text-[17px] leading-tight font-semibold tracking-[-0.01em] text-ink">{ws?.name ?? "No workspace"}</span>
        {!ready && <Pip tone={connectionTone(status)} label={statusText(status)} />}
        <ChevronDown size={16} strokeWidth={2.25} className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="bottom-start" width={270}>
        <div role="menu" className="p-1.5">
          <div className="px-2.5 pt-1.5 pb-1 text-[12px] font-medium text-muted">Workspaces</div>
          {workspaces.map((w) => (
            <MenuItem
              key={w.id}
              icon={<WorkspaceIcon provider={w.provider} size={15} />}
              label={w.name}
              hint={w.id === activeId && !ready ? statusText(status) : undefined}
              active={w.id === activeId}
              right={w.id === activeId ? <Check size={15} className="text-muted" /> : undefined}
              onClick={() => (void setActive(w.id), setOpen(false))}
            />
          ))}
          <MenuItem icon={<Plus size={15} />} label="Add workspace" onClick={() => (setOpen(false), addWs(true))} />
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<Settings size={15} />} label="Manage workspaces" onClick={() => (setOpen(false), openSettings("workspaces"))} />
        </div>
      </Popover>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 first-of-type:mt-1">
      <h2 className="list-label px-4 pb-2">{label}</h2>
      {children}
    </section>
  );
}

/**
 * The three tiers read differently at a glance, so they never compete:
 * a session that wants you is a raised card with the agent's face; an agent
 * is a bare face and a name; a past session is a line of text.
 */

/** A session that wants you, is working or has a result you haven't seen. The face carries the state, the line what it's doing right now; a ring of ice means it needs you. */
const ActiveCard = memo(function ActiveCard({ s, now }: { s: SessionInfo; now: number }) {
  const busy = useChat((st) => !!st.busy[s.id]);
  const asking = useChat((st) => Object.values(st.permissions).some((p) => p.sessionID === s.id) || Object.values(st.forms).some((f) => f.sessionID === s.id));
  const open = useChat((st) => st.open);
  const mood = useFace(s.id);
  const who = useAgentName(s.agent);
  const doing = useDoing(s.id, busy);
  // Its turn is over but work it started is still going: still working, as far as you're concerned.
  const away = useBackgroundLine(s.id);
  const failed = s.outcome === "failed";
  return (
    <button {...spot} onClick={() => open(s.id)} data-tone={asking ? "needs" : undefined} className="bezel flex w-full items-center gap-3.5 rounded-[20px] py-3 pr-4 pl-3 text-left">
      <Spot />
      <AgentMark id={s.agent} size={56} state={away && (mood === "idle" || mood === "done") ? "working" : mood} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[17px] leading-snug font-semibold text-ink">{s.title || "New session"}</span>
          <span className="shrink-0 text-[13px] text-faint tabular-nums">{timeAgo(s.time.updated, now)}</span>
        </span>
        <span className="mt-1 flex items-center gap-2 text-[14px]">
          {asking ? (
            <span className="text-info">Needs you</span>
          ) : busy ? (
            <span className="shimmer min-w-0 truncate">{doing || (who ? `${who} is working` : "Working")}</span>
          ) : away ? (
            <span className="shimmer min-w-0 truncate">{away}</span>
          ) : (
            <>
              <Pip tone={failed ? "error" : "new"} label={failed ? "Didn't finish" : "New result"} />
              <span className="min-w-0 truncate text-ink-2">{failed ? "Didn't finish" : "New result"}{who && <span className="text-muted"> · {who}</span>}</span>
            </>
          )}
        </span>
      </span>
    </button>
  );
});

/**
 * Everyone you can start a session with, down the page: their face (asleep
 * until there's work), their name and job, no card. Tap one to start. Anyone
 * already on an active card is left out.
 */
function AgentList({ busy, onMessage }: { busy: Set<string>; onMessage: (agent: string) => void }) {
  const offered = useOfferedAgents();
  const people = useMemo(() => offered.filter((a) => !busy.has(a.id)), [offered, busy]);
  if (!people.length) return null;
  return (
    <Section label="Agents">
      <div className="space-y-0.5 px-2">
        {people.map((p) => (
          <AgentItem key={p.id} {...p} onClick={() => onMessage(p.id)} />
        ))}
      </div>
    </Section>
  );
}

function AgentItem({ id, name, job, onClick }: { id: string; name: string; job: string; onClick: () => void }) {
  const state = useTeammateState(id);
  return (
    <button {...spot} onClick={onClick} aria-label={`New session with ${name}`} className="relative isolate flex w-full items-center gap-4 rounded-[18px] px-2 py-2.5 text-left">
      <Spot />
      <AgentMark id={id} size={60} state={state} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] leading-snug font-semibold text-ink">{name}</span>
        {job && <span className="mt-0.5 block truncate text-[15px] text-muted">{job}</span>}
      </span>
      <SquarePen size={19} className="shrink-0 text-faint" />
    </button>
  );
}

/** A past session, as a line of text: what it was about, who and where, when. No face: faces are for agents. */
const RecentRow = memo(function RecentRow({ s, now, first }: { s: SessionInfo; now: number; first: boolean }) {
  const open = useChat((st) => st.open);
  const who = useAgentName(s.agent);
  const where = [who, basename(s.location.directory)].filter(Boolean).join(" · ");
  return (
    <button {...spot} onClick={() => open(s.id)} className="relative isolate block w-full rounded-[14px] px-2 py-3 text-left">
      <Spot />
      {!first && <span aria-hidden className="absolute inset-x-2 -top-px h-px bg-line" />}
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[16px] leading-snug text-ink">{s.title || "New session"}</span>
        <span className="shrink-0 text-[13px] text-faint tabular-nums">{timeAgo(s.time.updated, now)}</span>
      </span>
      <span className="mt-0.5 block truncate text-[14px] text-muted">
        {s.outcome === "failed" && <span className="text-danger">Didn't finish · </span>}
        {where}
      </span>
    </button>
  );
});

/** The bird standing on a session's reply box. */
const PERCH = 52;

function SessionScreen({ sessionId }: { sessionId: string }) {
  const session = useChat((s) => s.sessions[sessionId]);
  const open = useChat((s) => s.open);
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
    // The fade (`h-4`) overlaps the thread; only the solid part takes room.
    const ro = new ResizeObserver(() => setInset(el.offsetHeight - 16));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The thread ends a little above a perched bird's head (44px, over the 16px fade), not behind it.
  const rise = usePerched(sessionId) ? PERCH - 16 : 0;

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
      className="chat-surface absolute inset-0 z-10 flex flex-col shadow-pop"
    >
      <div className="absolute inset-y-0 left-0 z-30 w-5 touch-none" onPointerDown={(e) => drag.start(e)} />
      {/* Like a messages app: back, who you're talking to (tap to switch), then history and the rest. */}
      <header className="safe-top relative z-20 shrink-0">
        <div className="flex h-[52px] items-center pr-1.5 pl-0.5">
          <BackButton onClick={() => open(null)} />
          <div className="flex min-w-0 flex-1 [&>button]:max-w-full">
            <AgentPicker
              sessionId={sessionId}
              header
              subtitle={
                <>
                  {session?.title || "New session"}
                  {status !== "ready" && <span className="text-faint"> · {statusText(status).toLowerCase()}</span>}
                </>
              }
            />
          </div>
          <SessionHistory sessionId={sessionId} phone />
          <button ref={moreRef} onClick={() => setMenu(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink transition-colors active:bg-hover" aria-label="More">
            <MoreHorizontal size={22} />
          </button>
        </div>
      </header>
      <Popover open={menu} onClose={() => setMenu(false)} anchor={moreRef.current} placement="bottom-end" width={220}>
        <div role="menu" className="p-1.5">
          <MenuItem icon={<FolderTree size={15} />} label="Files" onClick={() => (setMenu(false), setFiles(true))} />
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

      <Thread sessionId={sessionId} bottomInset={inset + rise} />

      <div
        ref={composerRef}
        className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3"
      >
        <PanelFade className="h-4" />
        <div className="panel-fill pointer-events-auto relative pb-2">
          <Perch sessionId={sessionId} size={PERCH} />
          <AskDock sessionId={sessionId} />
          <BackgroundStrip sessionId={sessionId} />
          <InboxTray sessionId={sessionId} />
          <Composer sessionId={sessionId} compact autoFocus placeholder="Message" />
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

/** Meeting the teammate a new session is with: face, name and greeting. Their tagline waits on their profile. */
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
      <Bird bird={mate.bird} seed={mate.face} size={88} attentive={typing} interactive pulse={words} label={mate.name} />
      <div className="mt-4 text-[14px] font-medium text-ink-2">{mate.name}</div>
      <div className="mt-1 text-[22px] leading-tight font-semibold">{mate.greeting || `What should ${mate.name} work on?`}</div>
    </motion.div>
  );
}

/**
 * A new session on the phone: the same screen as a session, empty until the
 * first message. Sending closes the draft and opens the session it made.
 */
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
      className="chat-surface absolute inset-0 z-10 flex flex-col shadow-pop"
    >
      <div className="absolute inset-y-0 left-0 z-30 w-5 touch-none" onPointerDown={(e) => drag.start(e)} />
      <Sky />
      <header className="safe-top relative z-20 shrink-0">
        <div className="flex h-[52px] items-center pr-1.5 pl-0.5">
          <BackButton onClick={close} />
          <div className="min-w-0 flex-1 pl-1">
            <div className="truncate text-[15px] leading-tight font-semibold">New session</div>
            {/* The folder picker sits under the composer; say only where it runs. */}
            <div className="truncate text-[12px] leading-tight text-muted">{ws?.name}</div>
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
            autoFocus
            placeholder={mate ? `Ask ${mate.name}, or hand over a task` : "Describe the task"}
            tray={<ProjectPicker />}
            onSent={(id) => {
              setDraftOpen(false);
              open(id);
            }}
          />
        </div>
      </div>
    </motion.div>
  );
}

/** The lead (or else the first teammate), waiting for something to do. */
function EmptyBird() {
  const mate = useTeammates((s) => (s.byId ? (Object.values(s.byId).find((t) => t.leads) ?? Object.values(s.byId)[0]) : undefined));
  return mate ? <Bird bird={mate.bird} seed={mate.face} size={64} interactive /> : <AppGlyph size={52} />;
}
