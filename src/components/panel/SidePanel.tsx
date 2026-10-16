/**
 * The right side of the window: a slim rail of tools at the edge, and the
 * panel it opens between the chat and the rail. Modeled on OpenChamber's
 * context panel: one surface at a time, its own remembered width, a resize
 * handle on the left edge, and an "expand" mode that covers the chat.
 */
import { BackButton, usePage } from "../ui/Sheet";
import { BookOpen, Bookmark, FolderTree, Gauge, Globe, Maximize2, Minimize2, SquareTerminal, X } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useUI, PANEL_DEFAULT_WIDTH, type PanelSurface } from "../../state/ui";
import { useTerminals } from "../../state/terminals";
import { useHandoff } from "../../state/computer";
import { IconButton } from "../ui/Button";
import { FilesSurface, ContextSurface } from "./Surfaces";
import { TerminalSurface } from "./TerminalSurface";
import { BrowserSurface } from "./BrowserSurface";
import { ProjectSurface } from "./ProjectSurface";
import { MemorySurface } from "./MemorySurface";
import { kbd } from "../../hooks/useShortcuts";

export const SURFACES: { id: PanelSurface; label: string; keys: string; icon: (size: number) => ReactNode }[] = [
  { id: "files", label: "Files", keys: "⌘⇧E", icon: (s) => <FolderTree size={s} /> },
  { id: "terminal", label: "Terminal", keys: "⌃`", icon: (s) => <SquareTerminal size={s} /> },
  { id: "browser", label: "Browser", keys: "⌘⇧B", icon: (s) => <Globe size={s} /> },
  { id: "context", label: "Context", keys: "⌘⇧I", icon: (s) => <Gauge size={s} /> },
  { id: "project", label: "Project", keys: "⌘⇧J", icon: (s) => <BookOpen size={s} /> },
  { id: "memory", label: "Memory", keys: "⌘⇧M", icon: (s) => <Bookmark size={s} /> },
];

const MIN_W = 300;
/** The chat keeps at least this much room next to a docked panel. */
const MIN_CHAT = 360;

// ---------------------------------------------------------------------------
// Chrome shared by every surface (desktop panel or phone page)
// ---------------------------------------------------------------------------

interface Chrome {
  /** Docked in the desktop panel (vs. a phone page). */
  docked: boolean;
  onClose(): void;
}
const ChromeCtx = createContext<Chrome>({ docked: false, onClose: () => {} });
export const PanelChrome = ChromeCtx.Provider;

/**
 * 52px header that lines up with the chat header. `children` sits on the
 * left (a title or tabs); `actions` sit before expand / close.
 */
export function PanelHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const { docked, onClose } = useContext(ChromeCtx);
  const expanded = useUI((s) => s.panelExpanded);
  const setExpanded = useUI((s) => s.setPanelExpanded);
  // On a phone page: back on the left, as on every page, and no close.
  const page = usePage();
  if (page)
    return (
      <div className="flex h-[60px] shrink-0 items-center gap-2 border-b border-line pr-3 pl-3">
        <BackButton onClick={page.back} />
        <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </div>
    );
  return (
    <div className={`${docked ? "drag h-[52px]" : "h-12"} flex shrink-0 items-center gap-1 border-b border-line pr-2 pl-3`} data-tauri-drag-region>
      <div className="flex min-w-0 flex-1 items-center gap-2" data-tauri-drag-region>
        {children}
      </div>
      <div className="no-drag flex shrink-0 items-center gap-0.5">
        {actions}
        {docked && (
          <IconButton label={expanded ? "Dock beside the chat" : "Expand over the chat"} size={28} onClick={() => setExpanded(!expanded)}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </IconButton>
        )}
        <IconButton label="Close panel" size={28} onClick={onClose}>
          <X size={15} />
        </IconButton>
      </div>
    </div>
  );
}

/** Icon + label for a surface's header. */
export function PanelTitle({ surface, detail }: { surface: PanelSurface; detail?: ReactNode }) {
  const s = SURFACES.find((x) => x.id === surface)!;
  return (
    <span className="flex min-w-0 items-center gap-2 text-[13px]" data-tauri-drag-region>
      <span className="text-muted">{s.icon(15)}</span>
      <span className="font-semibold text-ink">{s.label}</span>
      {detail && <span className="truncate text-faint">{detail}</span>}
    </span>
  );
}

/** Centered message for a surface with nothing to show yet. */
export function PanelEmpty({ icon, title, body, children }: { icon: ReactNode; title: string; body?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-10 text-center">
      <span className="mb-1 grid h-10 w-10 place-items-center rounded-xl bg-hover text-muted">{icon}</span>
      <div className="text-[14px] font-medium text-ink">{title}</div>
      {body && <div className="max-w-[300px] text-[12.5px] leading-relaxed text-muted">{body}</div>}
      {children && <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** One surface's body, for both the panel and phone pages. */
export function SurfaceBody({ surface, root, sessionId }: { surface: PanelSurface; root: string | null; sessionId: string | null }) {
  switch (surface) {
    case "files":
      return <FilesSurface root={root} />;
    case "terminal":
      return <TerminalSurface root={root} />;
    case "browser":
      return <BrowserSurface />;
    case "context":
      return <ContextSurface sessionId={sessionId} />;
    case "project":
      return <ProjectSurface root={root} />;
    case "memory":
      return <MemorySurface root={root} />;
  }
}

// ---------------------------------------------------------------------------
// Desktop panel
// ---------------------------------------------------------------------------

export function SidePanel({ root, sessionId, rowRef }: { root: string | null; sessionId: string | null; rowRef: React.RefObject<HTMLDivElement | null> }) {
  const panel = useUI((s) => s.panel);
  const expanded = useUI((s) => s.panelExpanded);
  const stored = useUI((s) => (s.panel ? s.panelWidths[s.panel] : undefined));
  const close = useUI((s) => s.closePanel);
  const [dragging, setDragging] = useState(false);
  const [rowW, setRowW] = useState(0);
  // Surfaces stay mounted once opened, so a terminal or page survives a switch.
  const [visited, setVisited] = useState<PanelSurface[]>(panel ? [panel] : []);
  useEffect(() => {
    if (panel && !visited.includes(panel)) setVisited((v) => [...v, panel]);
  }, [panel, visited]);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRowW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [rowRef]);

  // Esc leaves expanded mode.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && useUI.getState().setPanelExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const max = Math.max(MIN_W, rowW - MIN_CHAT);
  const width = panel ? Math.min(max, Math.max(MIN_W, stored ?? PANEL_DEFAULT_WIDTH[panel])) : 0;

  const startResize = (e: React.PointerEvent) => {
    if (!panel) return;
    e.preventDefault();
    const right = rowRef.current?.getBoundingClientRect().right ?? window.innerWidth;
    setDragging(true);
    const move = (ev: PointerEvent) => useUI.getState().setPanelWidth(panel, Math.min(max, Math.max(MIN_W, right - ev.clientX)));
    const up = () => {
      setDragging(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <aside
      aria-label="Tools panel"
      className={`h-full shrink-0 overflow-hidden ${expanded && panel ? "absolute inset-y-0 right-0 left-0 z-20" : "relative"}`}
      style={{
        width: expanded && panel ? undefined : width,
        transition: dragging ? "none" : "width 200ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {panel && !expanded && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={() => useUI.getState().setPanelWidth(panel, PANEL_DEFAULT_WIDTH[panel])}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") useUI.getState().setPanelWidth(panel, Math.min(max, width + 24));
            if (e.key === "ArrowRight") useUI.getState().setPanelWidth(panel, Math.max(MIN_W, width - 24));
          }}
          className="group absolute inset-y-0 left-0 z-30 w-[3px] cursor-col-resize outline-none"
        >
          <span className={`absolute inset-y-0 left-0 w-px transition-colors ${dragging ? "bg-line-strong" : "bg-line group-hover:bg-line-strong group-focus-visible:bg-line-strong"}`} />
        </div>
      )}
      <div className="surface-panel relative h-full" style={{ width: expanded && panel ? "100%" : width || undefined, minWidth: MIN_W }}>
        <PanelChrome value={{ docked: true, onClose: close }}>
          {visited.map((s) => (
            <section key={s} aria-label={s} className={`absolute inset-0 flex flex-col ${s === panel ? "" : "invisible pointer-events-none"}`}>
              <SurfaceBody surface={s} root={root} sessionId={sessionId} />
            </section>
          ))}
        </PanelChrome>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

export function RightRail() {
  const panel = useUI((s) => s.panel);
  const toggle = useUI((s) => s.togglePanel);
  const terms = useTerminals((s) => s.tabs.length);
  const browsing = useUI((s) => !!s.browserRequest);
  // The agent is waiting for the person to take over its screen.
  const waiting = !!useHandoff(null);
  return (
    <nav aria-label="Tools" className="surface-sidebar relative z-[1] flex h-full w-11 shrink-0 flex-col items-center gap-1 border-l border-line pt-2">
      {SURFACES.map((s) => {
        const on = panel === s.id;
        const badge = s.id === "terminal" && terms > 0 ? String(terms) : null;
        const dot = s.id === "browser" && (waiting || browsing) && !on;
        return (
          <div key={s.id} className="group relative">
            <button
              aria-label={s.label}
              aria-pressed={on}
              onClick={() => toggle(s.id)}
              className={`relative grid h-9 w-9 place-items-center rounded-lg transition-colors ${on ? "bg-active text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
            >
              {s.icon(18)}
              {badge && (
                <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[10px] font-semibold text-bg tabular-nums">{badge}</span>
              )}
              {dot && <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-info" />}
            </button>
            {/* Tooltip on the left, like OpenChamber's rail. */}
            <span className="pointer-events-none absolute top-1/2 right-full z-50 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-surface-solid px-2 py-1 text-[12px] text-ink opacity-0 shadow-md transition-opacity delay-300 group-hover:opacity-100">
              {s.label} <span className="ml-1 text-faint">{kbd(s.keys)}</span>
            </span>
          </div>
        );
      })}
    </nav>
  );
}

/** For surfaces that need to know when they're the one on screen. */
export function useSurfaceVisible(surface: PanelSurface) {
  const { docked } = useContext(ChromeCtx);
  const panel = useUI((s) => s.panel);
  return !docked || panel === surface;
}

export function useDocked() {
  return useContext(ChromeCtx).docked;
}
