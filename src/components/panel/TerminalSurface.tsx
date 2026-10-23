/**
 * Terminals on the agent machine. Tabs in the header, one xterm per tab.
 * Shells keep running on the server when the panel (or the app) closes.
 */
import { Plus, SquareTerminal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { terminalSession, useTerminals } from "../../state/terminals";
import type { TermStatus } from "../../lib/terminal";
import { IconButton, Button } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { PanelEmpty, PanelHeader, PanelTitle, useSurfaceVisible } from "./SidePanel";

export function TerminalSurface({ root }: { root: string | null }) {
  const tabs = useTerminals((s) => s.tabs);
  const activeId = useTerminals((s) => s.activeId);
  const loaded = useTerminals((s) => s.loaded);
  const creating = useTerminals((s) => s.creating);
  const { load, create, close, setActive } = useTerminals.getState();
  const visible = useSurfaceVisible("terminal");
  const autoMade = useRef(false);

  useEffect(() => {
    if (visible && !loaded) void load();
  }, [visible, loaded, load]);

  // Opening the panel with no shells starts one, like an editor's terminal.
  useEffect(() => {
    if (visible && loaded && tabs.length === 0 && !creating && !autoMade.current) {
      autoMade.current = true;
      void create(root ?? undefined);
    }
  }, [visible, loaded, tabs.length, creating, create, root]);

  return (
    <>
      <PanelHeader
        actions={
          <IconButton label="New terminal" size={28} disabled={creating} onClick={() => void create(root ?? undefined)}>
            {creating ? <Spinner size={13} /> : <Plus size={15} />}
          </IconButton>
        }
      >
        <div className="no-drag scroll-quiet flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label="Terminals">
          {tabs.length === 0 && (
            <PanelTitle surface="terminal" />
          )}
          {tabs.map((t) => {
            const on = t.id === activeId;
            return (
              <div
                key={t.id}
                role="tab"
                aria-selected={on}
                tabIndex={0}
                onClick={() => setActive(t.id)}
                onAuxClick={(e) => e.button === 1 && void close(t.id)}
                className={`group flex h-7 max-w-[180px] shrink-0 cursor-default items-center gap-1.5 rounded-lg pr-1 pl-2.5 text-[13px] transition-colors ${on ? "bg-active text-ink" : "text-muted hover:bg-hover hover:text-ink"}`}
              >
                <span className="truncate">{t.title}</span>
                <button
                  aria-label={`Close ${t.title}`}
                  title="Close (ends the shell)"
                  onClick={(e) => {
                    e.stopPropagation();
                    void close(t.id);
                  }}
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded text-faint hover:bg-active hover:text-ink ${on ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </PanelHeader>
      {activeId ? (
        <TermView key={activeId} id={activeId} visible={visible} />
      ) : !loaded || creating ? (
        <div className="flex flex-1 items-center justify-center text-muted">
          <Spinner size={16} />
        </div>
      ) : (
        <PanelEmpty icon={<SquareTerminal size={18} />} title="No terminals" body="Shells run on the agent machine and keep running when you close Otto.">
          <Button size="sm" icon={<Plus size={13} />} onClick={() => void create(root ?? undefined)}>
            New terminal
          </Button>
        </PanelEmpty>
      )}
    </>
  );
}

const KEYS: { label: string; data: string }[] = [
  { label: "esc", data: "\x1b" },
  { label: "tab", data: "\t" },
  { label: "^C", data: "\x03" },
  { label: "^D", data: "\x04" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "←", data: "\x1b[D" },
  { label: "→", data: "\x1b[C" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "/", data: "/" },
];

const coarse = typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

function TermView({ id, visible }: { id: string; visible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<TermStatus>("connecting");

  useLayoutEffect(() => {
    const el = ref.current;
    const s = terminalSession(id);
    if (!el || !s) return;
    s.mount(el);
    setStatus(s.status);
    const off = s.onStatus(setStatus);
    const ro = new ResizeObserver(() => s.refit());
    ro.observe(el);
    return () => {
      off();
      ro.disconnect();
    };
  }, [id]);

  useEffect(() => {
    if (!visible) return;
    const s = terminalSession(id);
    requestAnimationFrame(() => {
      s?.refit();
      if (!coarse) s?.focus();
    });
  }, [visible, id]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={ref} className="min-h-0 flex-1 py-2 pl-3 pr-1" onClick={() => terminalSession(id)?.focus()} />
      {status !== "live" && (
        <div className="pointer-events-none absolute top-2 right-3 flex items-center gap-1.5 rounded-full border border-line bg-surface-solid px-2.5 py-1 text-[11px] text-muted shadow-sm">
          {status === "exited" ? (
            "Exited"
          ) : (
            <>
              <Spinner size={11} /> {status === "connecting" ? "Connecting" : "Reconnecting"}
            </>
          )}
        </div>
      )}
      {coarse && (
        <div className="scroll-quiet flex shrink-0 gap-1 overflow-x-auto border-t border-line px-2 py-1.5">
          {KEYS.map((k) => (
            <button
              key={k.label}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => terminalSession(id)?.send(k.data)}
              className="h-8 min-w-10 shrink-0 rounded-md bg-hover px-2 font-mono text-[13px] text-ink-2 active:bg-active"
            >
              {k.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
