/**
 * The agent machine's screen, live: its desktop, with the agent's Chrome on it.
 * (Boat's Chrome-only stream never came up in testing, and showed the same
 * Chrome anyway, so there's one view.)
 *
 * Boat streams it (Moonlight) to a signed URL that must be opened within ten
 * minutes, so a fresh one is asked for every time the view mounts. The view
 * is watch-only until the person takes control; a glass pane over the stream
 * swallows input until then.
 */
import { AlertTriangle, AppWindow, Globe, Hand, Maximize, Minimize, MonitorPlay, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "../../state/chat";
import { useComputer, useHandoff } from "../../state/computer";
import { useUI } from "../../state/ui";
import { useWorkspaces, secretKeys } from "../../state/workspaces";
import { secrets } from "../../lib/secrets";
import { BoatClient, BoatError } from "../../lib/providers/boat";
import type { Handoff } from "../../lib/handoff";
import { Button, IconButton } from "../ui/Button";
import { AgentClock, Spinner } from "../ui/AgentClock";
import { browserSteps, shortUrl } from "../../lib/browserSteps";
import { PanelEmpty } from "./SidePanel";

type Load = { state: "loading"; detail?: string } | { state: "ready"; url: string } | { state: "error"; message: string };

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("Cancelled", "AbortError"))), { once: true });
  });

/** Ask Boat for a stream URL, waiting out "still preparing". */
async function streamUrl(boat: BoatClient, id: string, signal: AbortSignal, tries: number): Promise<string> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      const url = await boat.stream(id, signal);
      if (url) return url;
    } catch (e) {
      if (!(e instanceof BoatError) || !e.retryable) throw e;
      last = e;
    }
    await sleep(2000, signal);
  }
  throw last instanceof Error ? last : new Error("Boat didn't open the stream.");
}

/** Hide the viewer's own overlay and match the app's theme. The token stays in the fragment. */
function embed(raw: string, theme: "light" | "dark") {
  try {
    const u = new URL(raw);
    u.searchParams.set("overlay", "0");
    u.searchParams.set("theme", theme);
    return u.toString();
  } catch {
    return raw;
  }
}

/** Whether the active workspace can show its screen, and how to reach it. */
export function useLiveTarget() {
  return useWorkspaces((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeId);
    return ws?.provider === "boat" && ws.sandboxId ? ws.sandboxId : null;
  });
}

/** The stream URL for the agent's screen, fetched fresh each time `active` turns on. */
export function useScreenStream(active: boolean) {
  const sandboxId = useLiveTarget();
  const theme = useUI((s) => s.resolvedTheme);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [nonce, setNonce] = useState(0);

  // A fresh URL whenever the view comes on screen (they expire unopened after 10 minutes).
  useEffect(() => {
    if (!active || !sandboxId) return;
    const ctrl = new AbortController();
    setLoad({ state: "loading" });
    void (async () => {
      try {
        const key = await secrets.get(secretKeys.boat);
        if (!key) throw new Error("Add your Boat API key in Settings → Workspaces to see this machine's screen.");
        const boat = new BoatClient(key);
        setLoad({ state: "loading", detail: "Starting the stream" });
        const url = await streamUrl(boat, sandboxId, ctrl.signal, 30);
        setLoad({ state: "ready", url: embed(url, theme) });
      } catch (e) {
        if (!ctrl.signal.aborted) setLoad({ state: "error", message: (e as Error).message });
      }
    })();
    return () => ctrl.abort();
    // The theme is read once per stream; switching it mid-stream would restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sandboxId, nonce]);

  return { sandboxId, load, nonce, reload: () => setNonce((n) => n + 1) };
}

/**
 * The stream itself, at the screen's 16:9 so there are no black bars. Watch
 * only (a glass pane takes the input) unless `control`; double-click takes
 * control.
 */
export function ScreenFrame({
  stream,
  control,
  sessionId,
  className = "",
  maxHeight,
}: {
  stream: ReturnType<typeof useScreenStream>;
  control: boolean;
  sessionId: string | null;
  className?: string;
  /** Cap on the height (CSS length); the width follows at 16:9. */
  maxHeight?: string;
}) {
  const { load, nonce, reload } = stream;
  const frame = useRef<HTMLIFrameElement>(null);
  // Taking control puts the keyboard in the stream (once the stream is there).
  const ready = load.state === "ready" ? load.url : null;
  useEffect(() => {
    if (control) frame.current?.focus();
  }, [control, ready, nonce]);
  return (
    <div
      className={`relative mx-auto aspect-video w-full overflow-hidden bg-black ${control ? "ring-2 ring-info ring-inset" : ""} ${className}`}
      style={maxHeight ? { maxWidth: `calc(${maxHeight} * 16 / 9)` } : undefined}
    >
      {load.state === "ready" && (
        <iframe
          ref={frame}
          key={`${load.url}:${nonce}`}
          src={load.url}
          title="The agent's screen"
          className="absolute inset-0 h-full w-full border-0"
          allow="autoplay; fullscreen; clipboard-read; clipboard-write"
          tabIndex={control ? 0 : -1}
        />
      )}
      {load.state === "loading" && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="flex items-center gap-2 text-[12px] text-white/70">
            <Spinner size={12} /> {load.detail ?? "Connecting to the screen"}
          </div>
        </div>
      )}
      {load.state === "error" && (
        <div className="absolute inset-0 grid place-items-center px-6 text-center">
          <div className="space-y-3">
            <div className="text-[13px] text-white/80">{load.message}</div>
            <Button size="sm" variant="glass" onClick={reload}>
              Try again
            </Button>
          </div>
        </div>
      )}
      {/* Watch-only: the stream sees no input until the person takes control. */}
      {!control && load.state === "ready" && (
        <div className="absolute inset-0 cursor-default" title="Double-click to take control" onDoubleClick={() => void useComputer.getState().takeControl(sessionId)} />
      )}
    </div>
  );
}

export function LiveScreen({ active }: { active: boolean }) {
  const control = useComputer((s) => s.control);
  const sessionId = useChat((s) => s.activeId);
  const mine = useHandoff(sessionId);
  const any = useHandoff(null);
  const handoff = mine ?? any;
  // One stream at a time: full screen holds it while it's up.
  const focus = useComputer((s) => s.focus);
  const playing = active && !focus;
  const stream = useScreenStream(playing);

  // ...and while this one is up, the chat's inline view steps aside.
  useEffect(() => {
    if (!playing || !stream.sandboxId) return;
    useComputer.getState().setPanelScreen(true);
    return () => useComputer.getState().setPanelScreen(false);
  }, [playing, stream.sandboxId]);

  if (!stream.sandboxId) {
    return (
      <PanelEmpty
        icon={<MonitorPlay size={18} />}
        title="No screen to show"
        body="Only Boat machines have a desktop to watch."
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ControlBar handoff={handoff} sessionId={sessionId} onReload={stream.reload} loading={stream.load.state === "loading"} />
      <AgentTab active={playing} />
      {active && (
        <div className="shrink-0 bg-black">
          {focus ? (
            <OnScreenNote />
          ) : (
            <ScreenFrame stream={stream} control={control} sessionId={sessionId} maxHeight="70vh" />
          )}
        </div>
      )}
      <StepLog sessionId={sessionId} />
    </div>
  );
}

/** Where the screen is when full screen has it: in the panel or the chat. */
export function OnScreenNote() {
  return (
    <div className="grid aspect-video w-full place-items-center bg-black/90">
      <div className="flex flex-col items-center gap-3">
        <div className="flex items-center gap-2 text-[12px] text-white/60">
          <Maximize size={13} /> Showing full screen
        </div>
        <Button size="sm" variant="glass" onClick={() => useComputer.getState().setFocus(false)}>
          Exit full screen
        </Button>
      </div>
    </div>
  );
}

/** Enter or leave full screen. */
export function FocusButton({ size = 28 }: { size?: number }) {
  const focus = useComputer((s) => s.focus);
  return (
    <IconButton label={focus ? "Exit full screen" : "Full screen"} size={size} onClick={() => useComputer.getState().setFocus(!focus)}>
      {focus ? <Minimize size={13} /> : <Maximize size={13} />}
    </IconButton>
  );
}

/**
 * Who's driving, and the one button that changes it. A handoff turns it blue
 * and says what the agent is waiting for.
 */
export function ControlBar({
  handoff,
  sessionId,
  onReload,
  loading,
  tall = false,
}: {
  handoff: Handoff | null;
  sessionId: string | null;
  onReload(): void;
  loading: boolean;
  /** Full screen's title bar: as tall as the window's, and it drags the window. */
  tall?: boolean;
}) {
  const control = useComputer((s) => s.control);
  const paused = useComputer((s) => s.paused);
  const busy = useChat((s) => (sessionId ? !!s.busy[sessionId] : false));
  const [sending, setSending] = useState(false);
  const run = (fn: () => Promise<void>) => {
    setSending(true);
    void fn().finally(() => setSending(false));
  };
  const take = () => run(() => useComputer.getState().takeControl(sessionId));
  const back = () => run(() => useComputer.getState().handBack(sessionId));

  if (handoff) {
    return (
      <div className="shrink-0 border-b border-info/30 bg-info-soft px-3 py-2.5" role="status">
        <div className="flex items-start gap-2">
          <Hand size={14} className="mt-0.5 shrink-0 text-info" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-info">The agent needs you</div>
            <div className="selectable mt-0.5 text-[13px] leading-snug break-words text-ink">{handoff.reason}</div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
          <FocusButton />
          <Button size="sm" variant="ghost" disabled={sending} onClick={() => run(() => useComputer.getState().cancelHandoff(handoff))}>
            Cancel
          </Button>
          {control ? (
            <Button size="sm" variant="primary" disabled={sending} onClick={back}>
              I'm done, hand back
            </Button>
          ) : (
            <Button size="sm" variant="primary" disabled={sending} onClick={take}>
              Take control
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex shrink-0 items-center gap-2 pr-2 pl-3 ${tall ? "h-[52px]" : "h-10 border-b border-line"}`} data-tauri-drag-region={tall || undefined}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${control ? "bg-info" : busy ? "bg-accent" : "bg-line-strong"}`} />
      <span className="min-w-0 flex-1 truncate text-[12px] text-muted" data-tauri-drag-region={tall || undefined}>
        {control ? (paused ? "You're in control · the agent is paused" : "You're in control") : busy ? "Watching the agent work" : "Watching"}
      </span>
      <IconButton label="Reconnect the stream" size={28} onClick={onReload} disabled={loading}>
        <RefreshCw size={13} />
      </IconButton>
      <FocusButton />
      {control ? (
        <Button size="sm" variant="primary" disabled={sending} onClick={back} title={paused ? "Give the screen back and let the agent carry on" : "Give the screen back"}>
          Hand back
        </Button>
      ) : (
        <Button size="sm" variant="secondary" disabled={sending} onClick={take} title={busy ? "Pauses the agent while you drive" : undefined}>
          Take control
        </Button>
      )}
    </div>
  );
}

/** Shell that prints the agent browser's current tab, or nothing when Chrome isn't up. */
const AGENT_TAB = `curl -s -m 2 http://127.0.0.1:9222/json/version >/dev/null 2>&1 && cat "$HOME/.otto/browser.json" 2>/dev/null || true`;

/**
 * The page the agent's browser is on (from otto-browser's state), or a way
 * to open Chrome when it isn't running, e.g. to sign in before a task.
 */
export function AgentTab({ active }: { active: boolean }) {
  const client = useChat((s) => s.client);
  const [tab, setTab] = useState<{ title?: string; url?: string } | null | undefined>(undefined);
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    if (!active || !client) return;
    let gone = false;
    const read = async () => {
      try {
        const r = await client.exec(AGENT_TAB, { timeoutMs: 8000 });
        const st = r.output.trim() ? (JSON.parse(r.output) as { title?: string; url?: string }) : null;
        if (!gone) setTab(st && st.url ? st : null);
      } catch {
        if (!gone) setTab((t) => (t === undefined ? null : t));
      }
    };
    void read();
    const t = setInterval(() => void read(), 5000);
    return () => {
      gone = true;
      clearInterval(t);
    };
  }, [active, client]);

  const open = async () => {
    if (!client) return;
    setOpening(true);
    try {
      await client.exec("~/.local/bin/otto-browser open >/dev/null 2>&1", { timeoutMs: 45_000 });
      const r = await client.exec(AGENT_TAB, { timeoutMs: 8000 });
      setTab(r.output.trim() ? JSON.parse(r.output) : null);
    } catch {
      // The stream shows what happened.
    } finally {
      setOpening(false);
    }
  };

  if (tab === undefined) return null;
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line pr-2 pl-3 text-[12px]">
      <AppWindow size={12} className="shrink-0 text-faint" />
      {tab ? (
        <span className="min-w-0 flex-1 truncate" title={tab.url}>
          <span className="text-ink-2">{tab.title || "Untitled"}</span>
          <span className="ml-2 text-faint">{tab.url}</span>
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-muted">Chrome isn't open yet</span>
          <Button size="sm" variant="ghost" className="h-6" disabled={opening || !client} onClick={() => void open()}>
            {opening ? <Spinner size={11} /> : null}
            Open Chrome
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * What the agent has done in its browser this session, newest first: the
 * space under the screen, and the story of how it got there.
 */
function StepLog({ sessionId }: { sessionId: string | null }) {
  const timeline = useChat((s) => (sessionId ? s.timelines[sessionId] : undefined));
  const steps = useMemo(() => {
    const blocks = (timeline?.messages ?? []).flatMap((m) => (m.kind === "assistant" ? m.blocks : []));
    return browserSteps(blocks).slice(-60).reverse();
  }, [timeline]);
  return (
    <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
      <div className="flex h-8 items-center px-3 text-[12px] font-medium text-muted">Browser steps</div>
      {steps.length === 0 ? (
        <div className="px-3 pb-4 text-[12px] leading-relaxed text-muted">When the agent uses the browser in this session, each step shows here.</div>
      ) : (
        <ol className="px-1.5 pb-3">
          {steps.map(({ b, step }) => {
            const running = b.status === "running" || b.status === "streaming";
            return (
              <li key={b.key} className="flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1.5 text-[13px]">
                <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center ${step.failed ? "text-danger" : "text-faint"}`}>
                  {running ? <AgentClock size={11} /> : step.failed ? <AlertTriangle size={12} /> : <Globe size={12} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    <span className={step.failed ? "text-danger" : "text-ink-2"}>{step.verb}</span> <span className="text-ink">{step.target}</span>
                  </span>
                  {step.page && (
                    <span className="block truncate text-[11px] text-faint" title={step.page.url}>
                      {step.page.title ? `${step.page.title} · ` : ""}
                      {shortUrl(step.page.url)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
