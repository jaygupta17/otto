/**
 * The Browser panel. On a Boat workspace it has two views:
 *
 *   Preview  a small browser for what the agent builds. `localhost:3000`
 *            means port 3000 on the agent machine, reached through the
 *            provider's port forwarding (lib/preview.ts).
 *   Screen   the agent machine's desktop, live, with its Chrome (LiveScreen).
 *
 * Elsewhere it's just the preview.
 */
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Monitor, RefreshCw, Radio } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useUI } from "../../state/ui";
import { useChat } from "../../state/chat";
import { useComputer, useHandoff, type BrowserView } from "../../state/computer";
import { openExternal } from "../../lib/platform";
import { LISTEN_COMMAND, parseListening, previewUrl, resolveAddress } from "../../lib/preview";
import { IconButton } from "../ui/Button";
import { Spinner } from "../ui/AgentClock";
import { PanelEmpty, PanelHeader, useSurfaceVisible } from "./SidePanel";
import { LiveScreen, useLiveTarget } from "./LiveScreen";
import { Pip } from "../ui/Pip";

export function BrowserSurface() {
  const live = !!useLiveTarget();
  const view = useComputer((s) => s.view);
  const visible = useSurfaceVisible("browser");
  const v = live ? view : "preview";
  // A link from chat is a preview request: show it.
  const request = useUI((s) => s.browserRequest?.n);
  useEffect(() => {
    if (request) useComputer.getState().setView("preview");
  }, [request]);
  return (
    <>
      {live && (
        <PanelHeader>
          <ViewTabs view={v} />
        </PanelHeader>
      )}
      {/* The preview stays mounted so its page survives a look at the screen. */}
      <div className={v === "preview" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <PreviewView inHeader={!live} active={visible && v === "preview"} />
      </div>
      {v === "screen" && <LiveScreen active={visible} />}
    </>
  );
}

const VIEWS: { id: BrowserView; label: string; icon: ReactNode }[] = [
  { id: "preview", label: "Preview", icon: <Globe size={13} /> },
  { id: "screen", label: "Agent's screen", icon: <Monitor size={13} /> },
];

function ViewTabs({ view }: { view: BrowserView }) {
  const setView = useComputer((s) => s.setView);
  const waiting = !!useHandoff(null);
  return (
    <div role="tablist" aria-label="View" className="no-drag flex items-center gap-0.5 rounded-[10px] well p-[3px]">
      {VIEWS.map((t) => {
        const on = t.id === view;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => setView(t.id)}
            className={`relative flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors ${on ? "chip text-ink" : "text-muted hover:text-ink"}`}
          >
            {t.icon}
            {t.label}
            {t.id !== "preview" && waiting && !on && <Pip tone="needs" label="Waiting for you" />}
          </button>
        );
      })}
    </div>
  );
}

function PreviewView({ inHeader, active }: { inHeader: boolean; active: boolean }) {
  const request = useUI((s) => s.browserRequest);
  const client = useChat((s) => s.client);
  const visible = active;
  const [stack, setStack] = useState<string[]>([]);
  const [index, setIndex] = useState(-1);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [ports, setPorts] = useState<number[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = stack[index] ?? null;

  const go = useCallback(async (raw: string) => {
    if (!raw.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const url = await resolveAddress(raw);
      setStack((s) => {
        const next = [...s.slice(0, indexRef.current + 1), url];
        indexRef.current = next.length - 1;
        setIndex(next.length - 1);
        return next;
      });
      setInput(url);
      setLoading(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  const indexRef = useRef(index);
  indexRef.current = index;

  // Links from chat or the terminal land here.
  const lastN = useRef(0);
  useEffect(() => {
    if (request && request.n !== lastN.current) {
      lastN.current = request.n;
      void go(request.url);
    }
  }, [request, go]);

  const scan = useCallback(async () => {
    if (!client) return;
    try {
      const r = await client.exec(LISTEN_COMMAND, { timeoutMs: 8000 });
      setPorts(parseListening(r.output));
    } catch {
      setPorts([]);
    }
  }, [client]);

  // Rescan while open, so a server the agent just started shows up.
  useEffect(() => {
    if (!visible) return;
    void scan();
    const t = setInterval(() => void scan(), 10_000);
    return () => clearInterval(t);
  }, [visible, scan]);

  const step = (d: -1 | 1) => {
    const i = index + d;
    if (i < 0 || i >= stack.length) return;
    setIndex(i);
    setInput(stack[i]);
    setLoading(true);
  };

  const actions = current && (
    <IconButton label="Open in your browser" size={28} onClick={() => void openExternal(current)}>
      <ExternalLink size={14} />
    </IconButton>
  );
  const nav = (
    <div className="no-drag flex min-w-0 flex-1 items-center gap-0.5">
      <IconButton label="Back" size={28} disabled={index <= 0} onClick={() => step(-1)}>
        <ArrowLeft size={14} />
      </IconButton>
      <IconButton label="Forward" size={28} disabled={index >= stack.length - 1} onClick={() => step(1)}>
        <ArrowRight size={14} />
      </IconButton>
      <IconButton
        label="Reload"
        size={28}
        disabled={!current}
        onClick={() => {
          setLoading(true);
          setNonce((n) => n + 1);
        }}
      >
        {loading ? <Spinner size={12} /> : <RefreshCw size={13} />}
      </IconButton>
      <form
        className="field ml-1 flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          void go(input);
          inputRef.current?.blur();
        }}
      >
        {busy ? <Spinner size={11} /> : <Globe size={12} className="shrink-0 text-faint" />}
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={(e) => e.target.select()}
          placeholder="localhost:3000 or a URL"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
          enterKeyHint="go"
          className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-faint"
        />
      </form>
    </div>
  );

  return (
    <>
      {inHeader ? (
        <PanelHeader actions={actions}>{nav}</PanelHeader>
      ) : (
        <div className="flex h-10 shrink-0 items-center gap-0.5 border-b border-line pr-2 pl-1.5">
          {nav}
          {actions}
        </div>
      )}

      {current && ports && ports.length > 0 && (
        <div className="scroll-quiet flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line px-3 py-1.5">
          <span className="shrink-0 text-[11px] text-faint">Listening</span>
          {ports.map((p) => (
            <button
              key={p}
              onClick={() => void go(String(p))}
              className="flex h-6 shrink-0 items-center gap-1 rounded-full px-2 font-mono text-[11px] text-ink-2 hairline transition-colors hover:bg-hover"
            >
              <Radio size={10} className="text-ok" />
              {p}
            </button>
          ))}
        </div>
      )}

      {error && <div className="shrink-0 border-b border-line bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</div>}

      {current ? (
        <div className="relative min-h-0 flex-1 bg-white">
          <iframe
            key={`${index}:${nonce}`}
            src={current}
            title="Preview"
            onLoad={() => setLoading(false)}
            className="absolute inset-0 h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            allow="clipboard-read; clipboard-write"
          />
        </div>
      ) : (
        <PanelEmpty
          icon={<Globe size={18} />}
          title="Preview what the agent builds"
          body={
            <>
              Type a port like <span className="font-mono text-ink-2">3000</span> or a URL.
            </>
          }
        >
          {ports === null ? (
            <Spinner size={14} />
          ) : ports.length === 0 ? (
            <button onClick={() => void scan()} className="text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">
              No dev servers found · Scan again
            </button>
          ) : (
            ports.slice(0, 6).map((p) => (
              <button key={p} onClick={() => void go(String(p))} className="flex h-8 items-center gap-1.5 rounded-lg px-3 font-mono text-[12px] text-ink hairline hover:bg-hover">
                <Radio size={12} className="text-ok" /> localhost:{p}
              </button>
            ))
          )}
        </PanelEmpty>
      )}
    </>
  );
}

/** Open a port on the agent machine in the panel. */
export async function openPort(port: number) {
  useUI.getState().openInBrowser(await previewUrl(port));
}
