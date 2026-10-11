import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Eye, EyeOff, ExternalLink, KeyRound, Server, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppGlyph } from "../ui/Mark";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { AgentClock, Spinner } from "../ui/AgentClock";
import { Backdrop } from "../ui/Backdrop";
import { SETUP_STEPS, newCheckpoint, provisionBoat, type ProvisionCheckpoint, type SetupStepId } from "../../lib/providers/provision";
import { BoatClient, BOAT_BILLING_URL, isBillingError } from "../../lib/providers/boat";
import { OpenCode } from "../../lib/opencode/client";
import { uid } from "../../lib/id";
import { kv } from "../../lib/kv";
import { secrets } from "../../lib/secrets";
import { openExternal } from "../../lib/platform";
import { clock, duration } from "../../lib/format";
import { useNow } from "../../hooks/useNow";
import { secretKeys, useWorkspaces } from "../../state/workspaces";

type Screen = "providers" | "boat" | "custom" | "setup" | "done";

interface ProviderCard {
  id: "boat" | "custom" | string;
  name: string;
  blurb: string;
  available: boolean;
  badge?: string;
  logo: ReactNode;
}

const PROVIDERS: ProviderCard[] = [
  {
    id: "boat",
    name: "Boat",
    blurb: "Linux VMs that sleep when idle and wake in seconds.",
    available: true,
    badge: "Recommended",
    logo: <BoatLogo />,
  },
  { id: "e2b", name: "E2B", blurb: "Firecracker sandboxes.", available: false, logo: <LetterLogo letter="E" /> },
  { id: "daytona", name: "Daytona", blurb: "Dev environments on demand.", available: false, logo: <LetterLogo letter="D" /> },
  { id: "custom", name: "Your own server", blurb: "Any reachable OpenCode v2 server.", available: true, logo: <div className="grid h-full w-full place-items-center rounded-lg border border-line bg-panel text-ink-2"><Server size={16} /></div> },
];

const SIZES = [
  { id: "small", label: "Small", spec: "2 vCPU · 4 GB" },
  { id: "default", label: "Standard", spec: "4 vCPU · 8 GB" },
  { id: "large", label: "Large", spec: "8 vCPU · 16 GB" },
];
const SLEEP = [
  { id: 3600, label: "1 hour" },
  { id: 7200, label: "2 hours" },
  { id: 43200, label: "12 hours" },
  { id: -1, label: "Never" },
];

/**
 * First-run flow (full screen) and "Add workspace" flow (embedded in a sheet).
 */
export function Onboarding({ embedded = false, onDone, onCancel }: { embedded?: boolean; onDone?: () => void; onCancel?: () => void }) {
  const [screen, setScreen] = useState<Screen>("providers");
  const [dir, setDir] = useState(1);
  const go = (s: Screen, d = 1) => {
    setDir(d);
    setScreen(s);
  };

  const [apiKey, setApiKey] = useState("");
  const [size, setSize] = useState("default");
  const [sleepAfter, setSleepAfter] = useState(3600);
  const [name, setName] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [checkingKey, setCheckingKey] = useState(false);
  const hasBoatKey = useWorkspaces((s) => s.hasBoatKey);

  useEffect(() => {
    if (hasBoatKey) void secrets.get(secretKeys.boat).then((k) => k && setApiKey(k));
  }, [hasBoatKey]);

  // ---- setup run ----
  const [steps, setSteps] = useState<Record<SetupStepId, { state: "idle" | "active" | "done" | "error"; detail?: string }>>(() => initialSteps());
  const [setupError, setSetupError] = useState<{ message: string; billing: boolean } | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [finishedAt, setFinishedAt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const checkpointRef = useRef<ProvisionCheckpoint | null>(null);
  const resultRef = useRef<{ wsId: string } | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function verifyKeyAndStart() {
    const key = apiKey.trim();
    if (!key) return setKeyError("Paste your Boat API key to continue.");
    setCheckingKey(true);
    setKeyError(null);
    try {
      await new BoatClient(key).me();
      await useWorkspaces.getState().setBoatKey(key);
      setCheckingKey(false);
      void runSetup(key);
    } catch (e) {
      setCheckingKey(false);
      setKeyError((e as Error).message);
    }
  }

  async function runSetup(key: string) {
    go("setup");
    setSetupError(null);
    setFinishedAt(0);
    setStartedAt(Date.now());
    setSteps((prev) => {
      const next = { ...prev };
      for (const s of SETUP_STEPS) if (next[s.id].state !== "done") next[s.id] = { state: "idle" };
      return next;
    });
    if (!checkpointRef.current) checkpointRef.current = (await kv.get<ProvisionCheckpoint>("setup.checkpoint")) ?? newCheckpoint();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const result = await provisionBoat(
        key,
        checkpointRef.current,
        { ttlSeconds: sleepAfter < 0 ? null : sleepAfter, type: size, name: name.trim() || "Otto" },
        (u) => setSteps((prev) => ({ ...prev, [u.step]: { state: u.state, detail: u.detail } })),
        ctrl.signal,
        (c) => void kv.set("setup.checkpoint", c),
      );
      const wsId = uid("ws_");
      await useWorkspaces.getState().add(
        {
          id: wsId,
          name: name.trim() || `Boat · ${result.sandboxId.slice(3)}`,
          provider: "boat",
          sandboxId: result.sandboxId,
          baseUrl: result.endpoint.baseUrl,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          version: result.version,
        },
        { password: result.endpoint.password, gateToken: result.endpoint.gateToken },
      );
      await kv.delete("setup.checkpoint");
      checkpointRef.current = null;
      resultRef.current = { wsId };
      setFinishedAt(Date.now());
      go("done");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setSetupError({ message: (e as Error).message || "Something went wrong.", billing: isBillingError(e) });
    }
  }

  function cancelSetup() {
    abortRef.current?.abort();
    go("boat", -1);
  }

  const content = (
    <AnimatePresence mode="wait" custom={dir} initial={false}>
      <motion.div
        key={screen}
        custom={dir}
        initial={{ opacity: 0, x: dir * 8 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: dir * -8, transition: { duration: 0.1 } }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="w-full"
      >
        {screen === "providers" && (
          <Providers
            embedded={embedded}
            onPick={(id) => go(id === "boat" ? "boat" : "custom")}
          />
        )}
        {screen === "boat" && (
          <BoatForm
            apiKey={apiKey}
            setApiKey={(v) => {
              setApiKey(v);
              setKeyError(null);
            }}
            keyError={keyError}
            checking={checkingKey}
            size={size}
            setSize={setSize}
            sleepAfter={sleepAfter}
            setSleepAfter={setSleepAfter}
            name={name}
            setName={setName}
            onBack={() => go("providers", -1)}
            onStart={verifyKeyAndStart}
          />
        )}
        {screen === "custom" && <CustomForm onBack={() => go("providers", -1)} onConnected={(wsId) => { resultRef.current = { wsId }; setStartedAt(0); go("done"); }} />}
        {screen === "setup" && (
          <SetupProgress steps={steps} error={setupError} startedAt={startedAt} onRetry={() => runSetup(apiKey.trim())} onCancel={cancelSetup} />
        )}
        {screen === "done" && <Done elapsed={startedAt ? finishedAt - startedAt : 0} onEnter={() => onDone?.()} />}
      </motion.div>
    </AnimatePresence>
  );

  if (embedded) {
    return (
      <div className="relative px-6 pt-5 pb-6">
        {onCancel && screen !== "setup" && (
          <button onClick={onCancel} className="absolute top-4 right-4 grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-hover hover:text-ink" aria-label="Close">
            <X size={17} />
          </button>
        )}
        {content}
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-panel">
      <Backdrop />
      <header className="drag relative flex h-14 shrink-0 items-center gap-2 px-6 pt-[env(safe-area-inset-top)] sm:pl-[96px]" data-tauri-drag-region>
        <AppGlyph size={22} />
        <span className="text-[14px] font-semibold text-ink">Otto</span>
      </header>
      <div className="scroll-quiet relative flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-12">
        <div className="mx-auto mt-[8vh] w-full max-w-[480px]">{content}</div>
      </div>
    </div>
  );
}

function initialSteps() {
  return Object.fromEntries(SETUP_STEPS.map((s) => [s.id, { state: "idle" as const }])) as Record<SetupStepId, { state: "idle" | "active" | "done" | "error"; detail?: string }>;
}

// ---------------------------------------------------------------------------

function Providers({ onPick, embedded }: { onPick: (id: string) => void; embedded: boolean }) {
  return (
    <div>
      <h1 className={`${embedded ? "text-[20px]" : "text-[28px] leading-tight"} font-semibold text-ink`}>{embedded ? "Add a workspace" : "Where should your agents run?"}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {embedded ? "Start another cloud machine or connect a server you already run." : "Otto starts a cloud machine, installs the OpenCode agent and keeps it running. You just bring an API key."}
      </p>
      <ul className="mt-7 divide-y divide-[var(--border)] overflow-hidden rounded-3xl border border-line bg-raised">
        {PROVIDERS.map((p) => (
          <li key={p.id}>
            <button disabled={!p.available} onClick={() => onPick(p.id)} className="group flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-hover disabled:hover:bg-transparent">
              <div className={`h-9 w-9 shrink-0 ${p.available ? "" : "opacity-50"}`}>{p.logo}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[14px] font-medium ${p.available ? "text-ink" : "text-muted"}`}>{p.name}</span>
                  {p.badge && <span className="text-[12px] text-muted">· {p.badge}</span>}
                </div>
                <div className="mt-0.5 truncate text-[13px] text-muted">{p.blurb}</div>
              </div>
              {p.available ? <ArrowRight size={16} className="text-faint transition-colors group-hover:text-ink" /> : <span className="text-[12px] text-faint">Coming soon</span>}
            </button>
          </li>
        ))}
      </ul>
      {!embedded && <p className="mt-4 text-[13px] text-muted">Keys stay on this device{navigator.userAgent.includes("Mac") ? ", in your Keychain" : ""}.</p>}
    </div>
  );
}

function BoatForm(props: {
  apiKey: string;
  setApiKey: (v: string) => void;
  keyError: string | null;
  checking: boolean;
  size: string;
  setSize: (v: string) => void;
  sleepAfter: number;
  setSleepAfter: (v: number) => void;
  name: string;
  setName: (v: string) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const [show, setShow] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onStart();
      }}
    >
      <BackLink onClick={props.onBack} />
      <h2 className="text-[24px] leading-tight font-semibold">Connect Boat</h2>
      <p className="mt-2 mb-6 text-[15px] leading-relaxed text-muted">Paste an API key. Otto starts the machine, installs OpenCode and connects to it.</p>

      <TextField
        label="API key"
        autoFocus
        placeholder="sandbox_…"
        type={show ? "text" : "password"}
        autoComplete="off"
        spellCheck={false}
        value={props.apiKey}
        onChange={(e) => props.setApiKey(e.target.value)}
        error={props.keyError}
        trailing={
          <button type="button" className="text-faint hover:text-ink" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide key" : "Show key"}>
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        }
        hint={
          <button type="button" className="inline-flex items-center gap-1 text-ink hover:underline" onClick={() => openExternal("https://docs.boat.dev/api-keys")}>
            Where do I get one? <ExternalLink size={12} />
          </button>
        }
      />

      <button type="button" onClick={() => setAdvanced((v) => !v)} className="mt-5 flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink">
        <ChevronDown size={15} className={`transition-transform ${advanced ? "rotate-180" : ""}`} /> Machine options
      </button>
      <AnimatePresence initial={false}>
        {advanced && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
            <div className="space-y-4 pt-4">
              <TextField label="Name" placeholder="Otto" value={props.name} onChange={(e) => props.setName(e.target.value)} />
              <div>
                <div className="mb-1.5 text-[13px] font-medium text-ink">Size</div>
                <Segmented options={SIZES.map((s) => ({ id: s.id, label: s.label, sub: s.spec }))} value={props.size} onChange={props.setSize} />
              </div>
              <div>
                <div className="mb-1.5 text-[13px] font-medium text-ink">Sleep after</div>
                <Segmented options={SLEEP.map((s) => ({ id: String(s.id), label: s.label }))} value={String(props.sleepAfter)} onChange={(v) => props.setSleepAfter(Number(v))} />
                <p className="mt-1.5 text-[12px] text-muted">Sleeping machines cost nothing and wake automatically when you open Otto.</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-7 flex items-center gap-4">
        <Button type="submit" variant="primary" size="lg" disabled={props.checking} trailing={props.checking ? <Spinner /> : undefined}>
          {props.checking ? "Checking key" : "Set up workspace"}
        </Button>
        <span className="flex items-center gap-1.5 text-[13px] text-muted">
          <KeyRound size={13} /> Stored only on this device
        </span>
      </div>
    </form>
  );
}

function CustomForm({ onBack, onConnected }: { onBack: () => void; onConnected: (wsId: string) => void }) {
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setError(null);
    let parsed: URL;
    try {
      parsed = new URL(url.trim().match(/^https?:\/\//) ? url.trim() : `https://${url.trim()}`);
    } catch {
      return setError("That doesn't look like a URL.");
    }
    setBusy(true);
    const gateToken = parsed.searchParams.get("_token") ?? undefined;
    const baseUrl = parsed.origin + parsed.pathname.replace(/\/+$/, "");
    try {
      const info = await new OpenCode({ baseUrl, password, gateToken }).info();
      const id = uid("ws_");
      await useWorkspaces.getState().add(
        { id, name: name.trim() || parsed.host, provider: "custom", baseUrl, createdAt: Date.now(), lastUsedAt: Date.now(), version: info.version },
        { password, gateToken },
      );
      onConnected(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void connect();
      }}
    >
      <BackLink onClick={onBack} />
      <h2 className="text-[24px] leading-tight font-semibold">Connect a server</h2>
      <p className="mt-2 mb-6 text-[15px] leading-relaxed text-muted">
        Run <code className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[12px]">opencode serve --hostname 0.0.0.0</code> with <code className="rounded-md bg-sunken px-1.5 py-0.5 font-mono text-[12px]">OPENCODE_SERVER_PASSWORD</code> set, then paste its address.
      </p>
      <div className="space-y-4">
        <TextField label="Server URL" autoFocus placeholder="https://my-box.example.com:4096" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} autoCapitalize="off" />
        <TextField label="Password" type="password" placeholder="OPENCODE_SERVER_PASSWORD" value={password} onChange={(e) => setPassword(e.target.value)} />
        <TextField label="Name" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} error={error} />
      </div>
      <Button type="submit" variant="primary" size="lg" className="mt-7" disabled={busy || !url.trim()} trailing={busy ? <Spinner /> : undefined}>
        {busy ? "Connecting" : "Connect"}
      </Button>
    </form>
  );
}

function SetupProgress({
  steps,
  error,
  startedAt,
  onRetry,
  onCancel,
}: {
  steps: Record<SetupStepId, { state: string; detail?: string; at?: number }>;
  error: { message: string; billing: boolean } | null;
  startedAt: number;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const now = useNow(!error);
  return (
    <div>
      <h2 className="text-[24px] leading-tight font-semibold">{error?.billing ? "Boat can't start a machine yet" : error ? "Setup paused" : "Setting up your workspace"}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {error?.billing
          ? "Your Boat account can't start a machine right now. Add a payment method or plan in Boat, then retry. Nothing here is lost."
          : error
            ? "Nothing is lost. Retry picks up where it stopped."
            : "Usually under a minute. You can leave this window in the background."}
      </p>
      <ol className="mt-7 border-t border-line">
        {SETUP_STEPS.map((s) => {
          const st = steps[s.id];
          return (
            <li key={s.id} className="flex items-start gap-3 border-b border-line py-3">
              <StepIcon state={st.state} />
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] ${st.state === "idle" ? "text-faint" : st.state === "error" ? "font-medium text-danger" : st.state === "active" ? "font-medium text-ink" : "text-ink-2"}`}>{s.title}</div>
                {st.state !== "idle" && st.state !== "error" && <div className="selectable truncate text-[13px] text-muted">{st.detail ?? s.hint}</div>}
              </div>
              <span className="pt-px text-[12px] text-faint tabular-nums">{st.state === "active" && startedAt ? clock(now - startedAt) : ""}</span>
            </li>
          );
        })}
      </ol>
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`selectable mt-4 max-h-40 overflow-auto rounded-2xl border px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${error.billing ? "border-line bg-raised text-ink-2" : "border-danger/25 bg-danger-soft font-mono text-[12px] text-ink"}`}>
            {error.message}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="mt-6 flex items-center gap-2">
        {error && (
          <Button variant="primary" onClick={onRetry}>
            Retry
          </Button>
        )}
        {error?.billing && (
          <Button variant="secondary" trailing={<ExternalLink size={13} />} onClick={() => openExternal(BOAT_BILLING_URL)}>
            Open Boat billing
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          {error ? "Back" : "Cancel"}
        </Button>
        <span className="ml-auto text-[13px] text-muted tabular-nums">{startedAt ? clock(now - startedAt) : ""}</span>
      </div>
    </div>
  );
}

function StepIcon({ state }: { state: string }) {
  return (
    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
      {state === "done" ? (
        <Check size={16} strokeWidth={2.5} className="text-ok" />
      ) : state === "active" ? (
        <AgentClock size={14} />
      ) : state === "error" ? (
        <X size={16} strokeWidth={2.5} className="text-danger" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
      )}
    </span>
  );
}

function Done({ elapsed, onEnter }: { elapsed: number; onEnter: () => void }) {
  useEffect(() => {
    const t = setTimeout(onEnter, 1800);
    return () => clearTimeout(t);
  }, [onEnter]);
  return (
    <div>
      <h2 className="flex items-center gap-2.5 text-[24px] leading-tight font-semibold">
        <Check size={24} strokeWidth={2.5} className="text-ok" /> Workspace ready
      </h2>
      <p className="mt-2 text-[15px] text-muted">{elapsed ? `Set up in ${duration(elapsed)}. ` : ""}Your agent is waiting for its first task.</p>
      <Button variant="primary" size="lg" className="mt-7" onClick={onEnter}>
        Open Otto
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Segmented({ options, value, onChange }: { options: { id: string; label: string; sub?: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-1 rounded-2xl bg-sunken p-1 hairline">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`relative flex-1 rounded-xl px-2 py-1.5 text-center transition-colors ${value === o.id ? "text-ink" : "text-muted hover:text-ink"}`}
        >
          {value === o.id && <motion.span layoutId={`seg-${options.map((x) => x.id).join("")}`} className="absolute inset-0 rounded-xl bg-raised shadow-soft" transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }} />}
          <span className="relative block text-[13px] font-medium">{o.label}</span>
          {o.sub && <span className="relative block text-[12px] text-muted">{o.sub}</span>}
        </button>
      ))}
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mb-5 -ml-1 inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-[13px] font-medium text-muted hover:text-ink">
      <ArrowLeft size={15} /> Back
    </button>
  );
}

function BoatLogo() {
  return (
    <div className="grid h-full w-full place-items-center rounded-lg bg-[#1f5fe0] text-white">
      <svg viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 15l2.5 4h13L21 15H3z" fill="currentColor" fillOpacity="0.25" />
        <path d="M12 3v12M12 4l6 8h-6" />
      </svg>
    </div>
  );
}

function LetterLogo({ letter }: { letter: string }) {
  return <div className="grid h-full w-full place-items-center rounded-lg border border-line bg-panel text-[14px] font-semibold text-muted">{letter}</div>;
}
