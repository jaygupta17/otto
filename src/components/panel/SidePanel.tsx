/**
 * The right-hand side of the window: a vertical dock at the window's edge and
 * the panel that opens to its left.
 *
 * The dock is the only way in and out. It never moves — opening the panel
 * narrows the chat, which slides everything in the chat left, while the dock
 * stays where it was — so the control under the pointer keeps its meaning:
 * click a surface's icon and it opens, click the same icon again and the panel
 * closes. There is no second control for either direction: the panel's own
 * header holds a title and whatever that surface needs, nothing that navigates.
 *
 * One surface at a time, one width for all of them, remembered.
 */
import { BackButton, usePage } from "../ui/Sheet";
import { Bookmark, Gauge, Globe, Image, SquareTerminal } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useUI, PANEL_DEFAULT_WIDTH, type PanelSurface } from "../../state/ui";
import { TerminalSurface } from "./TerminalSurface";
import { BrowserSurface } from "./BrowserSurface";
import { ContextSurface } from "./ContextSurface";
import { MemorySurface } from "./MemorySurface";
import { ArtifactSurface } from "./ArtifactSurface";

export interface SurfaceDef {
  id: PanelSurface;
  label: string;
  keys: string;
  icon: (size: number) => ReactNode;
}

/**
 * The dock, in order. Five surfaces, one idea each; `project` is deliberately
 * absent (see `ProjectSurface.tsx`), and nothing else may be added without a
 * rethink of the dock's five.
 */
export const SURFACES: SurfaceDef[] = [
  { id: "artifact", label: "Artifact", keys: "⌘⇧A", icon: (s) => <Image size={s} /> },
  { id: "browser", label: "Screen", keys: "⌘⇧B", icon: (s) => <Globe size={s} /> },
  { id: "terminal", label: "Terminal", keys: "⌃`", icon: (s) => <SquareTerminal size={s} /> },
  { id: "context", label: "Context", keys: "⌘⇧I", icon: (s) => <Gauge size={s} /> },
  { id: "memory", label: "Memory", keys: "⌘⇧M", icon: (s) => <Bookmark size={s} /> },
];

const MIN_W = 320;
/** The chat keeps at least this much room beside the panel, so it never turns into a ribbon. */
const MIN_CHAT = 420;
/** The dock's width: a column at the window's edge, whatever the panel is doing. */
export const DOCK_W = 44;

// ---------------------------------------------------------------------------
// Chrome shared by every surface (desktop panel or phone page)
// ---------------------------------------------------------------------------

interface Chrome {
  /** Docked in the desktop panel (vs. a phone page). */
  docked: boolean;
}
const ChromeCtx = createContext<Chrome>({ docked: false });
export const PanelChrome = ChromeCtx.Provider;

/**
 * The space above a surface: 52px on the desktop to line up with the chat
 * header, the page bar on a phone. A title and the surface's own controls
 * only — no expand, no close, no surface menu. The dock owns all of that.
 */
export function PanelHeader({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const { docked } = useContext(ChromeCtx);
  // On a phone page: back on the left, as on every page.
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
      {actions && <div className="no-drag flex shrink-0 items-center gap-0.5">{actions}</div>}
    </div>
  );
}

/** A surface's name for its header: one quiet line, the icon carried by the dock. */
export function PanelTitle({ label, detail }: { label: string; detail?: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-[13px]" data-tauri-drag-region>
      <span className="font-semibold text-ink">{label}</span>
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
      {body && <div className="max-w-[300px] text-[12px] leading-relaxed text-muted">{body}</div>}
      {children && <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>}
    </div>
  );
}

/** One surface's body, for both the panel and phone pages. */
export function SurfaceBody({ surface, root, sessionId }: { surface: PanelSurface; root: string | null; sessionId: string | null }) {
  switch (surface) {
    case "artifact":
      return <ArtifactSurface root={root} sessionId={sessionId} />;
    case "terminal":
      return <TerminalSurface root={root} />;
    case "browser":
      return <BrowserSurface />;
    case "context":
      return <ContextSurface sessionId={sessionId} />;
    case "memory":
      return <MemorySurface root={root} />;
  }
}

// ---------------------------------------------------------------------------
// Desktop panel
// ---------------------------------------------------------------------------

export function SidePanel({ root, sessionId }: { root: string | null; sessionId: string | null }) {
  const panel = useUI((s) => s.panel);
  const stored = useUI((s) => s.panelWidth);
  const [dragging, setDragging] = useState(false);
  const [rowW, setRowW] = useState(0);
  const boxRef = useRef<HTMLElement>(null);
  // Surfaces stay mounted once opened, so a terminal or page survives a switch.
  const [visited, setVisited] = useState<PanelSurface[]>(panel ? [panel] : []);
  useEffect(() => {
    if (panel && !visited.includes(panel)) setVisited((v) => [...v, panel]);
  }, [panel, visited]);

  // The chat's room is what the row leaves beside the dock; a window resize can
  // only take width away from the panel, never from the chat.
  useEffect(() => {
    const row = boxRef.current?.parentElement;
    if (!row) return;
    const ro = new ResizeObserver(() => setRowW(row.clientWidth));
    ro.observe(row);
    return () => ro.disconnect();
  }, []);
  const max = Math.max(MIN_W, (rowW || window.innerWidth) - DOCK_W - MIN_CHAT);
  const width = Math.min(max, Math.max(MIN_W, stored ?? PANEL_DEFAULT_WIDTH));

  const startResize = (e: React.PointerEvent) => {
    if (!panel) return;
    e.preventDefault();
    // The panel's right edge is fixed (the dock holds it), so a drag measures from there.
    const right = boxRef.current?.getBoundingClientRect().right ?? window.innerWidth - DOCK_W;
    setDragging(true);
    const move = (ev: PointerEvent) => useUI.getState().setPanelWidth(Math.min(max, Math.max(MIN_W, right - ev.clientX)));
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
      ref={boxRef}
      aria-label="Tools panel"
      aria-hidden={!panel}
      // Closed, the surfaces stay mounted (a terminal keeps running) but must
      // not be reachable: no tab stops, no border, nothing to click.
      inert={!panel || undefined}
      className="relative h-full shrink-0 overflow-hidden"
      style={{
        width: panel ? width : 0,
        transition: dragging ? "none" : "width 200ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      {panel && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          tabIndex={0}
          onPointerDown={startResize}
          onDoubleClick={() => useUI.getState().setPanelWidth(PANEL_DEFAULT_WIDTH)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") useUI.getState().setPanelWidth(Math.min(max, width + 24));
            if (e.key === "ArrowRight") useUI.getState().setPanelWidth(Math.max(MIN_W, width - 24));
          }}
          className="group absolute inset-y-0 left-0 z-30 w-[3px] cursor-col-resize outline-none"
        >
          <span className={`absolute inset-y-0 left-0 w-px transition-colors ${dragging ? "bg-line-strong" : "bg-line group-hover:bg-line-strong group-focus-visible:bg-line-strong"}`} />
        </div>
      )}
      <div className={`surface-panel relative h-full border-l border-line ${panel ? "" : "invisible"}`} style={{ width: width, minWidth: MIN_W }}>
        <PanelChrome value={{ docked: true }}>
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

/** For surfaces that need to know when they're the one on screen. */
export function useSurfaceVisible(surface: string) {
  const { docked } = useContext(ChromeCtx);
  const panel = useUI((s) => s.panel);
  return !docked || panel === surface;
}

export function useDocked() {
  return useContext(ChromeCtx).docked;
}
