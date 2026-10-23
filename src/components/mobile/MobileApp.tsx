import { AnimatePresence, motion, useDragControls } from "motion/react";
import { ChevronDown, FolderTree, MessageCircle, MoreHorizontal, Plus, Search, SquarePen, Trash2, Pencil, Cloud, Check, Settings } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SessionInfo } from "@opencode/client";
import { sortedSessions, useChat } from "../../state/chat";
import { useConnection } from "../../state/connection";
import { useActiveWorkspace, useWorkspaces } from "../../state/workspaces";
import { useUI, type PanelSurface } from "../../state/ui";
import { useComputer } from "../../state/computer";
import { basename, timeAgo } from "../../lib/format";
import { deleteSession, renameSession } from "../../lib/actions";
import { useNow } from "../../hooks/useNow";
import { Thread } from "../chat/Thread";
import { useBack } from "../../lib/back";
import { Composer } from "../chat/Composer";
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
import { AgentMark, TeammateFace } from "../ui/TeammateFace";
import { useTeammate } from "../../state/teammates";
import { FilesPanel } from "../files/FilesPanel";
import { EditorBody } from "../files/Editor";
import { SchedulesView } from "../schedules/SchedulesView";
import { groupOf, statusText } from "../shell/Sidebar";
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
                <SessionsScreen onNew={newSession} />
              ) : t.id === "team" ? (
                <TeamScreen
                  onMessage={(id) => {
                    void useChat.getState().setAgent(id, null);
                    newSession();
                  }}
                />
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

const GROUPS = ["Today", "Yesterday", "This week", "Earlier"] as const;

/** The Sessions tab: where you are, the team, then every session by when it last moved. */
function SessionsScreen({ onNew }: { onNew: () => void }) {
  const sessions = useChat((s) => s.sessions);
  const busy = useChat((s) => s.busy);
  const loaded = useChat((s) => s.sessionsLoaded);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const now = useNow(true, 30_000);

  const [active, groups] = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = sortedSessions(sessions).filter((s) => !term || (s.title ?? "").toLowerCase().includes(term));
    const by = new Map<string, SessionInfo[]>();
    for (const s of list) if (!busy[s.id]) by.set(groupOf(s.time.updated, now), [...(by.get(groupOf(s.time.updated, now)) ?? []), s]);
    return [list.filter((s) => busy[s.id]), GROUPS.filter((g) => by.has(g)).map((g) => [g, by.get(g)!] as const)];
  }, [sessions, busy, q, now]);
  const empty = active.length + groups.length === 0;

  const endSearch = () => {
    setSearching(false);
    setQ("");
  };

  return (
    <>
      <header className="safe-top shrink-0 px-2">
        {searching ? (
          <div className="flex h-[52px] items-center gap-1 pl-2">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-[10px] bg-active px-2.5">
              <Search size={16} className="shrink-0 text-faint" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions" aria-label="Search sessions" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
            </label>
            <button onClick={endSearch} className="h-11 shrink-0 px-2.5 text-[16px] text-ink">
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex h-[52px] items-center">
            <WorkspaceSwitcher />
            <div className="flex-1" />
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

      <div data-scroll-root className="scroll-quiet relative min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="px-4">
          <ConnectionBanner />
          <UpdatePill className="mt-2 text-[14px] [&>button]:h-11" />
        </div>
        {!loaded && <div className="mt-10 flex justify-center text-muted"><AgentClock /></div>}
        {loaded && empty && (
          <div className="mt-16 flex flex-col items-center px-10 text-center">
            {q ? (
              <div className="text-[15px] text-muted">No sessions match “{q.trim()}”</div>
            ) : (
              <>
                <AppGlyph size={52} />
                <div className="mt-5 text-[17px] font-semibold">No sessions yet</div>
                <div className="mt-1 text-[14px] text-muted">Agents keep working while your phone is locked.</div>
              </>
            )}
          </div>
        )}
        {active.length > 0 && <Group label="Working" list={active} now={now} />}
        {groups.map(([label, list]) => (
          <Group key={label} label={label} list={list} now={now} />
        ))}
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

/** Where you are, as the screen's title: tap to switch workspaces. */
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
        className="flex h-11 min-w-0 items-center gap-2 rounded-full pr-2.5 pl-2 transition-colors active:bg-hover"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${ready ? "bg-ok" : status === "error" ? "bg-danger" : "animate-pulse bg-warn"}`} />
        <span className="min-w-0 truncate text-[17px] font-semibold">{ws?.name}</span>
        {!ready && <span className="shrink-0 text-[13px] text-muted">{statusText(status)}</span>}
        <ChevronDown size={16} className="shrink-0 text-muted" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor.current} placement="bottom-start" width={270}>
        <div role="menu" className="p-1.5">
          <div className="px-2.5 pt-1.5 pb-1 text-[12px] font-medium text-muted">Workspaces</div>
          {workspaces.map((w) => (
            <MenuItem key={w.id} icon={<Cloud size={15} />} label={w.name} active={w.id === activeId} right={w.id === activeId ? <Check size={15} className="text-muted" /> : undefined} onClick={() => (void setActive(w.id), setOpen(false))} />
          ))}
          <MenuItem icon={<Plus size={15} />} label="Add workspace" onClick={() => (setOpen(false), addWs(true))} />
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<Settings size={15} />} label="Manage workspaces" onClick={() => (setOpen(false), openSettings("workspaces"))} />
        </div>
      </Popover>
    </>
  );
}

function Group({ label, list, now }: { label: string; list: SessionInfo[]; now: number }) {
  return (
    <section className="mt-5">
      <h2 className="px-4 pb-1 text-[13px] font-medium text-muted">{label}</h2>
      {list.map((s) => (
        <Row key={s.id} s={s} now={now} />
      ))}
    </section>
  );
}

/** A session like a conversation: whose face, what it's about, when, and who it's with. */
const Row = memo(function Row({ s, now }: { s: SessionInfo; now: number }) {
  const busy = useChat((st) => !!st.busy[s.id]);
  const unread = useChat((st) => !!st.unread[s.id]);
  const asking = useChat((st) => Object.values(st.permissions).some((p) => p.sessionID === s.id) || Object.values(st.forms).some((f) => f.sessionID === s.id));
  const open = useChat((st) => st.open);
  // A teammate's session wears their face, which carries the state itself.
  const mate = useTeammate(s.agent);
  const where = [mate?.name, basename(s.location.directory)].filter(Boolean).join(" · ");
  return (
    <motion.button whileTap={{ backgroundColor: "var(--hover)" }} onClick={() => open(s.id)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left">
      {mate ? (
        <AgentMark id={s.agent} size={44} state={asking ? "needs" : busy ? "working" : unread ? "done" : "idle"} />
      ) : (
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-active text-muted">{busy ? <AgentClock size={15} /> : <MessageCircle size={19} />}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={`min-w-0 flex-1 truncate text-[16px] text-ink ${unread || asking ? "font-semibold" : "font-medium"}`}>{s.title || "New session"}</span>
          <span className="shrink-0 text-[13px] text-faint tabular-nums">{busy ? "Working" : timeAgo(s.time.updated, now)}</span>
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={`min-w-0 flex-1 truncate text-[14px] ${asking ? "text-info" : s.outcome === "failed" ? "text-danger" : "text-muted"}`}>{asking ? "Needs you" : s.outcome === "failed" ? "Didn't finish" : where}</span>
          {unread && !busy && !asking && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-ink" aria-label="New result" />}
        </span>
      </span>
    </motion.button>
  );
});

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

      <Thread sessionId={sessionId} bottomInset={inset} />

      <div
        ref={composerRef}
        className="safe-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10 px-3"
      >
        <PanelFade className="h-4" />
        <div className="panel-fill pointer-events-auto pb-2">
          <AskDock sessionId={sessionId} />
          <BackgroundStrip sessionId={sessionId} />
          <InboxTray sessionId={sessionId} />
          <Composer sessionId={sessionId} compact placeholder="Message" />
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
