import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Eye, EyeOff, ExternalLink, KeyRound, Laptop, Server, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppGlyph } from "../ui/Mark";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { AgentClock, Spinner } from "../ui/AgentClock";
import { Backdrop } from "../ui/Backdrop";
import { SETUP_STEPS, newCheckpoint, provisionBoat, type ProvisionCheckpoint, type SetupStepId, type StepUpdate } from "../../lib/providers/provision";
import { BOXD_BILLING_URL, BOXD_SIZES, BOXD_SLEEP, BoxdError, provisionBoxd, verifyBoxdKey } from "../../lib/providers/boxd";
import { E2BClient, E2BError, E2B_BILLING_URL, E2B_KEYS_URL, E2B_SLEEP, provisionE2B } from "../../lib/providers/e2b";
import { DaytonaClient, DaytonaError, DAYTONA_BILLING_URL, DAYTONA_KEYS_URL, DAYTONA_SIZES, DAYTONA_SLEEP, provisionDaytona } from "../../lib/providers/daytona";
import { BoatClient, BOAT_BILLING_URL, isBillingError } from "../../lib/providers/boat";
import { LOCAL_SETUP_STEPS, localAvailable, localName, provisionLocal } from "../../lib/providers/local";
import { OpenCode } from "../../lib/opencode/client";
import { randomSecret, uid } from "../../lib/id";
import { kv } from "../../lib/kv";
import { secrets } from "../../lib/secrets";
import { openExternal } from "../../lib/platform";
import { clock, duration } from "../../lib/format";
import { useNow } from "../../hooks/useNow";
import { secretKeys, useWorkspaces, isCloud, type CloudId } from "../../state/workspaces";
import { attachExisting, listSandboxes, sandboxExists, type SandboxEntry } from "../../lib/providers/existing";

type Screen = "providers" | "sandbox" | "existing" | "custom" | "setup" | "done";
type Cloud = "boat" | "boxd" | "e2b" | "daytona";

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
  {
    id: "boxd",
    name: "boxd",
    blurb: "MicroVMs that hibernate when idle, wake instantly.",
    available: true,
    logo: <BoxdLogo />,
  },
  { id: "e2b", name: "E2B", blurb: "Sandboxes that pause and resume where they left off.", available: true, logo: <LetterLogo letter="E2B" tone="#ff8800" /> },
  { id: "daytona", name: "Daytona", blurb: "Fast isolated sandboxes that stop when idle.", available: true, logo: <LetterLogo letter="D" tone="#0a0a0a" /> },
  {
    id: "local",
    name: localName(),
    blurb: "Runs OpenCode here. Installs it if needed.",
    available: localAvailable(),
    badge: "No key needed",
    logo: <div className="grid h-full w-full place-items-center rounded-lg border border-line bg-panel text-ink-2"><Laptop size={16} /></div>,
  },
  { id: "custom", name: "Your own server", blurb: "Any reachable OpenCode v2 server.", available: true, logo: <div className="grid h-full w-full place-items-center rounded-lg border border-line bg-panel text-ink-2"><Server size={16} /></div> },
];

/** Per-cloud copy and options for the shared setup form. */
const CLOUD: Record<Cloud, { name: string; keyPlaceholder: string; keyHelp: string; sizes: { id: string; label: string; spec: string }[]; sleep: { id: number; label: string }[]; defaultSize: string; defaultSleep: number; sleepHint: string; billingUrl: string }> = {
  boat: {
    name: "Boat",
    keyPlaceholder: "sandbox_…",
    keyHelp: "https://docs.boat.dev/api-keys",
    sizes: [],
    sleep: [],
    defaultSize: "default",
    defaultSleep: 3600,
    sleepHint: "Sleeping machines cost nothing and wake automatically when you open Otto.",
    billingUrl: BOAT_BILLING_URL,
  },
  boxd: {
    name: "boxd",
    keyPlaceholder: "bxd_…",
    keyHelp: "https://docs.boxd.sh/cli/authentication#api-keys",
    sizes: BOXD_SIZES,
    sleep: BOXD_SLEEP,
    defaultSize: "2",
    defaultSleep: 14400,
    sleepHint: "A hibernated machine costs only its disk and wakes on the next request.",
    billingUrl: BOXD_BILLING_URL,
  },
  e2b: {
    name: "E2B",
    keyPlaceholder: "e2b_…",
    keyHelp: E2B_KEYS_URL,
    sizes: [],
    sleep: E2B_SLEEP,
    defaultSize: "",
    defaultSleep: 1800,
    sleepHint: "When Otto isn't open, the sandbox pauses after this long, keeping everything. It resumes when you come back. Hobby plans cap a run at 1 hour.",
    billingUrl: E2B_BILLING_URL,
  },
  daytona: {
    name: "Daytona",
    keyPlaceholder: "dtn_…",
    keyHelp: DAYTONA_KEYS_URL,
    sizes: DAYTONA_SIZES,
    sleep: DAYTONA_SLEEP,
    defaultSize: "daytona-medium",
    defaultSleep: 60,
    sleepHint: "Stops after this long without Otto connected. Files are kept; Otto restarts the agent when you come back.",
    billingUrl: DAYTONA_BILLING_URL,
  },
};

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

  const [cloud, setCloud] = useState<Cloud>("boat");
  const spec = CLOUD[cloud];
  const [apiKey, setApiKey] = useState("");
  const [size, setSize] = useState("default");
  const [sleepAfter, setSleepAfter] = useState(3600);
  const [name, setName] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [checkingKey, setCheckingKey] = useState(false);
  function pickCloud(c: Cloud) {
    setCloud(c);
    setSize(CLOUD[c].defaultSize);
    setSleepAfter(CLOUD[c].defaultSleep);
    setKeyError(null);
    setApiKey("");
    void secrets.get(secretKeys[c]).then((k) => k && setApiKey(k));
    go("sandbox");
  }
  function openExisting(c: Cloud) {
    setCloud(c);
    setApiKey("");
    void secrets.get(secretKeys[c]).then((k) => k && setApiKey(k));
    go("existing");
  }

  // ---- setup run ----
  const [steps, setSteps] = useState<Record<SetupStepId, { state: "idle" | "active" | "done" | "error"; detail?: string }>>(() => initialSteps());
  const [setupError, setSetupError] = useState<{ message: string; billing: boolean } | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [finishedAt, setFinishedAt] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const checkpointRef = useRef<ProvisionCheckpoint | null>(null);
  const resultRef = useRef<{ wsId: string } | null>(null);
  /** Set while the setup screen is attaching an existing machine, so retry re-attaches instead of making a new one. */
  const attachRef = useRef<{ id: string; sleepAfter?: number } | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function verifyKeyAndStart() {
    const key = apiKey.trim();
    if (!key) return setKeyError(`Paste your ${spec.name} API key to continue.`);
    setCheckingKey(true);
    setKeyError(null);
    try {
      if (cloud === "boxd") {
        await verifyBoxdKey(key);
        await useWorkspaces.getState().setProviderKey("boxd", key);
      } else if (cloud === "e2b") {
        await new E2BClient(key).verify();
        await useWorkspaces.getState().setProviderKey("e2b", key);
      } else if (cloud === "daytona") {
        await new DaytonaClient(key).verify();
        await useWorkspaces.getState().setProviderKey("daytona", key);
      } else {
        await new BoatClient(key).me();
        await useWorkspaces.getState().setProviderKey("boat", key);
      }
      setCheckingKey(false);
      void runSetup(key);
    } catch (e) {
      setCheckingKey(false);
      setKeyError((e as Error).message);
    }
  }

  async function runSetup(key: string) {
    attachRef.current = null;
    go("setup");
    setSetupError(null);
    setFinishedAt(0);
    setStartedAt(Date.now());
    setSteps((prev) => {
      const next = { ...prev };
      for (const s of SETUP_STEPS) if (next[s.id].state !== "done") next[s.id] = { state: "idle" };
      return next;
    });
    const ckKey = cloud === "boat" ? "setup.checkpoint" : `setup.checkpoint.${cloud}`;
    if (!checkpointRef.current) checkpointRef.current = (await kv.get<ProvisionCheckpoint>(ckKey)) ?? newCheckpoint();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const onStep = (u: StepUpdate) => setSteps((prev) => ({ ...prev, [u.step]: { state: u.state, detail: u.detail } }));
      const onCheckpoint = (c: ProvisionCheckpoint) => void kv.set(ckKey, c);
      const result =
        cloud === "e2b"
          ? await provisionE2B(key, checkpointRef.current, { timeout: sleepAfter }, onStep, ctrl.signal, onCheckpoint)
          : cloud === "daytona"
            ? await provisionDaytona(key, checkpointRef.current, { snapshot: size, autoStop: sleepAfter, name: name.trim() || "otto" }, onStep, ctrl.signal, onCheckpoint)
            : cloud === "boxd"
          ? await provisionBoxd(key, checkpointRef.current, { vcpu: Number(size) || 2, hibernateAfter: sleepAfter, name: name.trim() || "otto" }, onStep, ctrl.signal, onCheckpoint)
          : await provisionBoat(key, checkpointRef.current, { ttlSeconds: sleepAfter < 0 ? null : sleepAfter, type: size, name: name.trim() || "Otto" }, onStep, ctrl.signal, onCheckpoint);
      const wsId = uid("ws_");
      await useWorkspaces.getState().add(
        {
          id: wsId,
          name: name.trim() || (cloud === "boxd" ? `boxd · ${result.endpoint.baseUrl.replace(/^https:\/\/(otto\.)?/, "").split(".")[0]}` : cloud === "boat" ? `Boat · ${result.sandboxId.slice(3)}` : `${CLOUD[cloud].name} · ${result.sandboxId.slice(0, 8)}`),
          provider: cloud,
          sandboxId: result.sandboxId,
          sleepAfter: cloud === "e2b" ? sleepAfter : undefined,
          baseUrl: result.endpoint.baseUrl,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          version: result.version,
        },
        { password: result.endpoint.password, gateToken: result.endpoint.gateToken },
      );
      await kv.delete(ckKey);
      checkpointRef.current = null;
      resultRef.current = { wsId };
      setFinishedAt(Date.now());
      go("done");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setSetupError({ message: (e as Error).message || "Something went wrong.", billing: isBillingError(e) || ((e instanceof BoxdError || e instanceof E2BError || e instanceof DaytonaError) && e.billing) });
    }
  }

  const [local, setLocal] = useState(false);

  async function runLocal() {
    attachRef.current = null;
    setLocal(true);
    go("setup");
    setSetupError(null);
    setFinishedAt(0);
    setStartedAt(Date.now());
    setSteps(initialSteps());
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const onStep = (u: StepUpdate) => setSteps((prev) => ({ ...prev, [u.step]: { state: u.state, detail: u.detail } }));
      const { endpoint, version } = await provisionLocal(randomSecret(32), onStep, ctrl.signal);
      const wsId = uid("ws_");
      await useWorkspaces.getState().add(
        { id: wsId, name: localName(), provider: "local", baseUrl: endpoint.baseUrl, createdAt: Date.now(), lastUsedAt: Date.now(), version },
        { password: endpoint.password },
      );
      resultRef.current = { wsId };
      setFinishedAt(Date.now());
      go("done");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setSetupError({ message: (e as Error).message || "Something went wrong.", billing: false });
    }
  }

  function cancelSetup() {
    abortRef.current?.abort();
    go(local ? "providers" : attachRef.current ? "existing" : "sandbox", -1);
  }

  /** Attach to an existing machine: revive it in place and register the workspace. */
  async function runAttach(sandboxId: string, sleepAfter?: number) {
    attachRef.current = { id: sandboxId, sleepAfter };
    go("setup");
    setLocal(false);
    setSetupError(null);
    setFinishedAt(0);
    setStartedAt(Date.now());
    setSteps(initialSteps());
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const onStep = (u: StepUpdate) => setSteps((prev) => ({ ...prev, [u.step]: { state: u.state, detail: u.detail } }));
      const password = randomSecret(32);
      const { endpoint, version } = await attachExisting({
        cloud,
        apiKey: apiKey.trim(),
        sandboxId,
        password,
        sleepAfter,
        report: onStep,
        signal: ctrl.signal,
      });
      // Reconnecting later wakes the machine with the saved key, so attaching must save it too.
      await useWorkspaces.getState().setProviderKey(cloud, apiKey.trim());
      const wsId = uid("ws_");
      await useWorkspaces.getState().add(
        {
          id: wsId,
          name: name.trim() || `${CLOUD[cloud].name} · ${sandboxId.slice(0, 8)}`,
          provider: cloud,
          sandboxId,
          sleepAfter: cloud === "e2b" ? (sleepAfter ?? CLOUD.e2b.defaultSleep) : undefined,
          baseUrl: endpoint.baseUrl,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          version,
        },
        { password: endpoint.password, gateToken: endpoint.gateToken },
      );
      resultRef.current = { wsId };
      setFinishedAt(Date.now());
      go("done");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setSetupError({ message: (e as Error).message || "Something went wrong.", billing: isBillingError(e) || ((e instanceof BoxdError || e instanceof E2BError || e instanceof DaytonaError) && e.billing) });
    }
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
            onPick={(id) => (id === "custom" ? go("custom") : id === "local" ? void runLocal() : (setLocal(false), pickCloud(id as Cloud)))}
            onExisting={(c) => (setLocal(false), openExisting(c))}
          />
        )}
        {screen === "existing" && (
          <ExistingForm
            cloud={cloud}
            apiKey={apiKey}
            setApiKey={(v) => {
              setApiKey(v);
              setKeyError(null);
            }}
            onBack={() => go("providers", -1)}
            onAttach={(id, sleepAfter) => void runAttach(id, sleepAfter)}
          />
        )}
        {screen === "sandbox" && (
          <BoatForm
            cloud={cloud}
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
          <SetupProgress cloud={cloud} list={local ? LOCAL_SETUP_STEPS : SETUP_STEPS} steps={steps} error={setupError} startedAt={startedAt} onRetry={() => (local ? runLocal() : attachRef.current ? runAttach(attachRef.current.id, attachRef.current.sleepAfter) : runSetup(apiKey.trim()))} onCancel={cancelSetup} />
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

function Providers({ onPick, embedded, onExisting }: { onPick: (id: string) => void; embedded: boolean; onExisting: (id: CloudId) => void }) {
  const hasLocal = useWorkspaces((s) => s.workspaces.some((w) => w.provider === "local"));
  return (
    <div>
      <h1 className={`${embedded ? "text-[20px]" : "text-[28px] leading-tight"} font-semibold text-ink`}>{embedded ? "Add a workspace" : "Where should your agents run?"}</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {embedded ? "Start another cloud machine, use this computer, or connect a server you already run." : "Otto starts a cloud machine, installs the OpenCode agent and keeps it running. You just bring an API key."}
      </p>
      <ul className="mt-7 divide-y divide-[var(--border)] overflow-hidden rounded-3xl border border-line bg-raised">
        {PROVIDERS.filter((p) => p.id !== "local" || (p.available && !hasLocal)).map((p) => (
          <li key={p.id} className="flex items-stretch">
            <button disabled={!p.available} onClick={() => onPick(p.id)} className={`group flex min-w-0 flex-1 items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-hover disabled:hover:bg-transparent`}>
              <div className={`h-9 w-9 shrink-0 ${p.available ? "" : "opacity-50"}`}>{p.logo}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[14px] font-medium ${p.available ? "text-ink" : "text-muted"}`}>{p.name}</span>
                  {p.badge && <span className="text-[12px] text-muted">· {p.badge}</span>}
                </div>
                <div className="mt-0.5 truncate text-[13px] text-muted">{p.blurb}</div>
              </div>
              {p.available ? <ArrowRight size={16} className="text-faint transition-colors group-hover:text-ink" /> : <span className="shrink-0 text-[12px] text-faint">Coming soon</span>}
            </button>
            {isCloud(p.id as CloudId) && p.available && (
              <button
                onClick={() => onExisting(p.id as CloudId)}
                className="shrink-0 border-l border-[var(--border)] px-4 text-[12.5px] text-muted transition-colors hover:bg-hover hover:text-ink"
                title={`Attach to one of your existing ${p.name} sandboxes`}
              >
                Attach…
              </button>
            )}
          </li>
        ))}
      </ul>
      {!embedded && <p className="mt-4 text-[13px] text-muted">Keys stay on this device{navigator.userAgent.includes("Mac") ? ", in your Keychain" : ""}. "Attach" takes a machine you already have instead of making one.</p>}
    </div>
  );
}

/** Attach to a machine the account already has: pick it from the list, or paste its id. */
function ExistingForm({
  cloud,
  apiKey,
  setApiKey,
  onBack,
  onAttach,
}: {
  cloud: Cloud;
  apiKey: string;
  setApiKey: (v: string) => void;
  onBack: () => void;
  onAttach: (id: string, sleepAfter?: number) => void;
}) {
  const c = CLOUD[cloud];
  const key = apiKey.trim();
  const [id, setId] = useState("");
  const [entries, setEntries] = useState<SandboxEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const workspaces = useWorkspaces((st) => st.workspaces);
  const attached = useMemo(() => new Set(workspaces.filter((w) => w.provider === cloud && w.sandboxId).map((w) => w.sandboxId!)), [workspaces, cloud]);

  // List once the key stops changing, not on every keystroke of a paste-in-progress.
  useEffect(() => {
    setEntries(null);
    setKeyError(null);
    if (!key) return;
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      listSandboxes(cloud, key)
        .then((l) => alive && setEntries(l))
        .catch((e) => alive && setKeyError((e as Error).message))
        .finally(() => alive && setLoading(false));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [cloud, key]);

  async function attach(rawId: string) {
    const sid = rawId.trim();
    if (!sid) return setIdError(`Paste your ${c.name} sandbox id.`);
    if (attached.has(sid)) return setIdError("That machine is already one of your workspaces.");
    setBusy(true);
    setIdError(null);
    const ok = await sandboxExists(cloud, key, sid).catch(() => false);
    setBusy(false);
    if (!ok) return setIdError(`${c.name} doesn't know a sandbox with that id on this key.`);
    onAttach(sid, cloud === "e2b" ? c.defaultSleep : undefined);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void attach(id);
      }}
    >
      <BackLink onClick={onBack} />
      <h2 className="text-[24px] leading-tight font-semibold">Attach to {c.name}</h2>
      <p className="mt-2 mb-6 text-[15px] leading-relaxed text-muted">Otto connects to a machine your account already has, restarting its agent if needed. It won't create anything.</p>

      <TextField
        label="API key"
        autoFocus
        placeholder={c.keyPlaceholder}
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={apiKey}
        onChange={(e) => setApiKey((e as React.ChangeEvent<HTMLInputElement>).target.value)}
        error={keyError ?? undefined}
        trailing={loading ? <Spinner size={15} /> : undefined}
      />
      {!key && <p className="mt-2 text-[13px] text-muted">Paste the key first. Otto lists the machines on its account.</p>}

      {entries && entries.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-line bg-raised">
          {entries.map((s) => {
            const taken = attached.has(s.id);
            return (
              <li key={s.id}>
                <button type="button" disabled={taken || busy} onClick={() => void attach(s.id)} className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover disabled:opacity-50 disabled:hover:bg-transparent">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-ink">{s.name}</div>
                    <div className="mt-0.5 truncate font-mono text-[12px] text-muted">{s.id}</div>
                  </div>
                  {taken ? <span className="shrink-0 text-[12px] text-faint">Already added</span> : <SandState state={s.state} />}
                  <ArrowRight size={15} className="shrink-0 text-faint transition-colors group-hover:text-ink" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {entries && entries.length === 0 && <p className="mt-3 text-[13px] text-muted">No machines found on this key.</p>}

      <div className="mt-4">
        <TextField
          label={entries?.length ? "Or paste a sandbox id" : "Sandbox id"}
          placeholder="Sandbox id"
          spellCheck={false}
          autoCapitalize="off"
          value={id}
          onChange={(e) => {
            setId((e as React.ChangeEvent<HTMLInputElement>).target.value);
            setIdError(null);
          }}
          error={idError ?? undefined}
        />
      </div>

      <Button type="submit" variant="primary" size="lg" className="mt-7" disabled={busy || !id.trim() || !key} trailing={busy ? <Spinner /> : undefined}>
        {busy ? "Checking" : "Attach"}
      </Button>
    </form>
  );
}

function SandState({ state }: { state: string }) {
  const asleep = /archiv|paus|stop|hibernat|suspend/i.test(state);
  return <span className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px] ${asleep ? "bg-[#f5b04a]/15 text-[#f5b04a]" : "bg-[#5fd39a]/15 text-[#5fd39a]"}`}>{state}</span>;
}

function BoatForm(props: {
  cloud: Cloud;
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
  const c = CLOUD[props.cloud];
  const sizes = props.cloud === "boat" ? SIZES : c.sizes;
  const sleeps = props.cloud === "boat" ? SLEEP : c.sleep;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        props.onStart();
      }}
    >
      <BackLink onClick={props.onBack} />
      <h2 className="text-[24px] leading-tight font-semibold">Connect {c.name}</h2>
      <p className="mt-2 mb-6 text-[15px] leading-relaxed text-muted">Paste an API key. Otto starts the machine, installs OpenCode and connects to it.</p>

      <TextField
        label="API key"
        autoFocus
        placeholder={c.keyPlaceholder}
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
          <button type="button" className="inline-flex items-center gap-1 text-ink hover:underline" onClick={() => openExternal(c.keyHelp)}>
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
              {sizes.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[13px] font-medium text-ink">Size</div>
                  <Segmented options={sizes.map((s) => ({ id: s.id, label: s.label, sub: s.spec }))} value={props.size} onChange={props.setSize} />
                </div>
              )}
              <div>
                <div className="mb-1.5 text-[13px] font-medium text-ink">Sleep after</div>
                <Segmented options={sleeps.map((s) => ({ id: String(s.id), label: s.label }))} value={String(props.sleepAfter)} onChange={(v) => props.setSleepAfter(Number(v))} />
                <p className="mt-1.5 text-[12px] text-muted">{c.sleepHint}</p>
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
  cloud,
  list,
  steps,
  error,
  startedAt,
  onRetry,
  onCancel,
}: {
  cloud: Cloud;
  list: { id: SetupStepId; title: string; hint: string }[];
  steps: Record<SetupStepId, { state: string; detail?: string; at?: number }>;
  error: { message: string; billing: boolean } | null;
  startedAt: number;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const now = useNow(!error);
  return (
    <div>
      <h2 className="text-[24px] leading-tight font-semibold">{error?.billing ? `${CLOUD[cloud].name} can't start a machine yet` : error ? "Setup paused" : "Setting up your workspace"}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        {error?.billing
          ? `Your ${CLOUD[cloud].name} account can't start a machine right now. Add credits or a plan there, then retry. Nothing here is lost.`
          : error
            ? "Nothing is lost. Retry picks up where it stopped."
            : "Usually under a minute. You can leave this window in the background."}
      </p>
      <ol className="mt-7 border-t border-line">
        {list.map((s) => {
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
          <Button variant="secondary" trailing={<ExternalLink size={13} />} onClick={() => openExternal(CLOUD[cloud].billingUrl)}>
            Open {CLOUD[cloud].name} billing
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
          {value === o.id && <motion.span layoutId={`seg-${options.map((x) => x.id).join("")}`} className="seg-pill absolute inset-0 rounded-xl shadow-soft" transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }} />}
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

function BoxdLogo() {
  return (
    <div className="grid h-full w-full place-items-center rounded-lg bg-[#111] text-white">
      <svg viewBox="0 0 24 24" width="56%" height="56%" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
        <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
      </svg>
    </div>
  );
}

function LetterLogo({ letter, tone }: { letter: string; tone?: string }) {
  if (tone)
    return (
      <div className="grid h-full w-full place-items-center rounded-lg text-white" style={{ background: tone, fontSize: letter.length > 1 ? 11 : 15, fontWeight: 700, letterSpacing: "-0.02em" }}>
        {letter}
      </div>
    );
  return <div className="grid h-full w-full place-items-center rounded-lg border border-line bg-panel text-[14px] font-semibold text-muted">{letter}</div>;
}
