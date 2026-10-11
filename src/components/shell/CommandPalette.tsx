import { AnimatePresence, motion } from "motion/react";
import { AlarmClock, Bot, Cloud, CornerDownLeft, FolderTree, Keyboard, MessageSquare, Moon, PanelLeft, Plus, Search, Settings, Square, SquarePen, Sun, Monitor, Gauge, Undo2, Redo2, GitFork, Layers } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { sortedSessions, useChat } from "../../state/chat";
import { useUI, type SettingsTab } from "../../state/ui";
import { useWorkspaces } from "../../state/workspaces";
import { cycleEffort, primaryAgents } from "../../lib/actions";
import { agentColor } from "../../lib/agentColor";
import { basename, timeAgo } from "../../lib/format";
import { SHORTCUTS } from "../../hooks/useShortcuts";
import { Sheet } from "../ui/Sheet";

interface Item {
  id: string;
  group: "Sessions" | "Actions" | "Agents" | "Settings" | "Workspaces";
  label: string;
  hint?: string;
  keys?: string;
  icon: ReactNode;
  run: () => void;
}

/** Subsequence match with a bonus for word starts; returns -1 for no match. */
function score(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let ti = 0;
  let s = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return -1;
    s += i === ti ? 3 : i > 0 && /[\s/_-]/.test(t[i - 1]) ? 2 : 1;
    ti = i + 1;
  }
  return s;
}

const SETTINGS: { tab: SettingsTab; label: string }[] = [
  { tab: "agents", label: "Agents" },
  { tab: "providers", label: "Providers" },
  { tab: "mcp", label: "MCP servers" },
  { tab: "skills", label: "Skills" },
  { tab: "commands", label: "Commands" },
  { tab: "workspaces", label: "Workspaces" },
  { tab: "general", label: "General" },
];

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  const setOpen = useUI((s) => s.setPalette);
  const sessions = useChat((s) => s.sessions);
  const busyId = useChat((s) => (s.activeId && s.busy[s.activeId] ? s.activeId : null));
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeWs = useWorkspaces((s) => s.activeId);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const ui = useUI.getState();
    const chat = useChat.getState();
    const close = (fn: () => void) => () => {
      setOpen(false);
      fn();
    };
    const out: Item[] = [
      { id: "new", group: "Actions", label: "New session", keys: "⌘N", icon: <SquarePen size={15} />, run: close(() => chat.open(null)) },
      { id: "scheduled", group: "Actions", label: "Scheduled tasks", icon: <AlarmClock size={15} />, run: close(() => ui.setView("schedules")) },
      { id: "sidebar", group: "Actions", label: "Toggle sidebar", keys: "⌘B", icon: <PanelLeft size={15} />, run: close(() => ui.toggleSidebar()) },
      { id: "tree", group: "Actions", label: "Toggle file tree", keys: "⌘⇧E", icon: <FolderTree size={15} />, run: close(() => ui.toggleFiles()) },
      { id: "effort", group: "Actions", label: "Cycle thinking effort", keys: "⌃T", icon: <Gauge size={15} />, run: close(cycleEffort) },
      { id: "shortcuts", group: "Actions", label: "Keyboard shortcuts", keys: "⌘/", icon: <Keyboard size={15} />, run: close(() => ui.setShortcuts(true)) },
      { id: "theme-light", group: "Actions", label: "Theme: Light", icon: <Sun size={15} />, run: close(() => ui.setTheme("light")) },
      { id: "theme-dark", group: "Actions", label: "Theme: Dark", icon: <Moon size={15} />, run: close(() => ui.setTheme("dark")) },
      { id: "theme-system", group: "Actions", label: "Theme: System", icon: <Monitor size={15} />, run: close(() => ui.setTheme("system")) },
    ];
    const sid = chat.activeId;
    if (sid) {
      const rev = !!chat.sessions[sid]?.revert;
      out.splice(
        1,
        0,
        { id: "undo", group: "Actions", label: "Undo last message", hint: "Also restores files", icon: <Undo2 size={15} />, run: close(() => void chat.undo(sid)) },
        ...(rev ? [{ id: "redo", group: "Actions" as const, label: "Redo", icon: <Redo2 size={15} />, run: close(() => void chat.redo(sid)) }] : []),
        { id: "fork", group: "Actions", label: "Fork session", hint: "Continue in a new session", icon: <GitFork size={15} />, run: close(() => void chat.fork(sid, null)) },
        { id: "compact", group: "Actions", label: "Compact conversation", hint: "Summarize to free up context", icon: <Layers size={15} />, run: close(() => void chat.compact(sid)) },
      );
    }
    if (busyId) out.unshift({ id: "stop", group: "Actions", label: "Stop the agent", keys: "⌘.", icon: <Square size={14} />, run: close(() => void chat.interrupt(busyId)) });
    for (const a of primaryAgents()) {
      out.push({ id: `agent-${a.id}`, group: "Agents", label: `Agent: ${a.name}`, hint: a.description, icon: <AgentDot color={agentColor(a.id, a.color)} />, run: close(() => void chat.setAgent(a.id, chat.activeId)) });
    }
    for (const s of SETTINGS) out.push({ id: `set-${s.tab}`, group: "Settings", label: `Settings: ${s.label}`, icon: <Settings size={15} />, run: close(() => ui.openSettings(s.tab)) });
    for (const w of workspaces) {
      if (w.id === activeWs) continue;
      out.push({ id: `ws-${w.id}`, group: "Workspaces", label: `Switch to ${w.name}`, icon: <Cloud size={15} />, run: close(() => void useWorkspaces.getState().setActive(w.id)) });
    }
    out.push({ id: "ws-add", group: "Workspaces", label: "Add workspace", icon: <Plus size={15} />, run: close(() => ui.setAddWorkspace(true)) });
    for (const s of sortedSessions(sessions).slice(0, 200)) {
      out.push({ id: `s-${s.id}`, group: "Sessions", label: s.title || "New session", hint: `${basename(s.location.directory)} · ${timeAgo(s.time.updated)}`, icon: <MessageSquare size={15} />, run: close(() => chat.open(s.id)) });
    }
    return out;
  }, [sessions, workspaces, activeWs, busyId, setOpen]);

  const results = useMemo(() => {
    const t = q.trim();
    if (!t) {
      // Empty query: recent sessions first, then the main actions.
      return [...items.filter((i) => i.group === "Sessions").slice(0, 6), ...items.filter((i) => i.group === "Actions")];
    }
    return items
      .map((i) => ({ i, s: score(t, `${i.label} ${i.hint ?? ""}`) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.i);
  }, [items, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  let lastGroup = "";
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[55]" role="dialog" aria-modal="true" aria-label="Command palette">
          <motion.div className="absolute inset-0 bg-black/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} onClick={() => setOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.08 } }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute top-[12vh] left-1/2 flex max-h-[60vh] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden surface-overlay rounded-3xl border border-line bg-raised shadow-pop"
          >
            <div className="flex items-center gap-2.5 border-b border-line px-4">
              <Search size={16} className="shrink-0 text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search sessions, actions, settings"
                aria-label="Search commands"
                aria-activedescendant={results[sel] ? `cmd-${results[sel].id}` : undefined}
                aria-controls="cmd-list"
                role="combobox"
                aria-expanded
                className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSel((s) => Math.min(results.length - 1, s + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSel((s) => Math.max(0, s - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    results[sel]?.run();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setOpen(false);
                  }
                }}
              />
              <kbd className="rounded border border-line px-1.5 py-px font-sans text-[12px] text-muted">esc</kbd>
            </div>
            <div ref={listRef} id="cmd-list" role="listbox" className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-1.5">
              {results.length === 0 && <div className="px-3 py-6 text-[14px] text-muted">Nothing matches “{q}”.</div>}
              {results.map((it, i) => {
                const header = it.group !== lastGroup ? it.group : null;
                lastGroup = it.group;
                return (
                  <div key={it.id}>
                    {header && <div className="px-2.5 pt-2 pb-1 text-[12px] font-medium text-muted">{header}</div>}
                    <div
                      id={`cmd-${it.id}`}
                      role="option"
                      aria-selected={i === sel}
                      data-index={i}
                      onMouseMove={() => setSel(i)}
                      onClick={it.run}
                      className={`flex items-center gap-3 rounded-lg px-2.5 py-2 text-[14px] ${i === sel ? "bg-active text-ink" : "text-ink-2"}`}
                    >
                      <span className="grid w-4 shrink-0 place-items-center text-muted">{it.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.hint && <span className="max-w-[45%] shrink truncate text-[12px] text-faint">{it.hint}</span>}
                      {it.keys && <kbd className="shrink-0 font-sans text-[12px] text-faint">{it.keys}</kbd>}
                      {i === sel && <CornerDownLeft size={13} className="shrink-0 text-faint" />}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function AgentDot({ color, size = 8 }: { color?: unknown; size?: number }) {
  const c = typeof color === "string" && color.startsWith("#") ? color : "var(--border-strong)";
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: c }} />;
}

export function ShortcutsSheet({ compact }: { compact: boolean }) {
  const open = useUI((s) => s.shortcutsOpen);
  const setOpen = useUI((s) => s.setShortcuts);
  const groups = ["General", "Sessions", "Composer", "Panels"] as const;
  return (
    <Sheet open={open} onClose={() => setOpen(false)} compact={compact} title="Keyboard shortcuts">
      <div className="grid gap-x-8 gap-y-5 px-6 py-5 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g}>
            <h3 className="mb-1.5 text-[13px] font-medium text-muted">{g}</h3>
            <dl className="divide-y divide-[var(--border)]">
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <div key={s.label} className="flex items-center justify-between gap-4 py-1.5">
                  <dt className="text-[14px] text-ink">{s.label}</dt>
                  <dd>
                    <kbd className="rounded border border-line bg-sunken px-1.5 py-px font-sans text-[12px] text-ink-2">{s.keys}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="px-6 pb-5 text-[13px] text-muted">
        <Bot size={13} className="mr-1 inline" />
        On Windows and Linux, use Ctrl where you see ⌘.
      </p>
    </Sheet>
  );
}
