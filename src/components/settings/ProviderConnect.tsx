/**
 * The panel under a provider row: choose how to connect — an API key, a
 * sign-in, a credential that already exists on the agent machine, or the
 * provider's own login command — then do it.
 *
 * The network and timers live here. The decisions (labels, form defaults,
 * when an attempt is finished, whether a flow can only complete on the agent
 * machine) live in `lib/integrations.ts`, where they can be tested.
 */
import { Check, Copy, ExternalLink, KeyRound, LogIn, ShieldCheck, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FormField, FormValue, IntegrationAttempt, IntegrationAttemptStatus, IntegrationCommandAttempt, IntegrationCommandAttemptStatus, IntegrationInfo } from "@opencode/client";
import { OpenCodeError } from "../../lib/opencode/client";
import {
  attemptNote,
  codeFromInstructions,
  connectMethods,
  connectionPending,
  connectionSummary,
  defaultAnswers,
  envNames,
  externalFields,
  finishesOnAgentMachine,
  isDeviceLike,
  methodKindLabel,
  methodLabel,
  methodVerb,
  missingRequired,
  payloadAnswers,
  shouldPoll,
  visibleFields,
  type Answers,
  type AnswerField,
  type ConnectMethod,
} from "../../lib/integrations";
import { openExternal } from "../../lib/platform";
import { useChat } from "../../state/chat";
import { toast } from "../../state/ui";
import { Spinner } from "../ui/AgentClock";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Pip } from "../ui/Pip";
import { Toggle } from "./common";
import { providerName } from "../chat/Pickers";

/** How often a running attempt is checked. The server answers in milliseconds. */
const POLL = 2000;

const ICON: Record<ConnectMethod["type"], ReactNode> = {
  key: <KeyRound size={14} />,
  oauth: <LogIn size={14} />,
  external: <ShieldCheck size={14} />,
  command: <Terminal size={14} />,
};

/** Key methods have no id; there is only ever one per provider. */
const methodKey = (m: ConnectMethod) => (m.type === "key" ? "key" : m.id);

const displayName = (info: IntegrationInfo) => (providerName(info.id) === info.id ? info.name : providerName(info.id));

type OauthRun = { attempt: IntegrationAttempt; status: IntegrationAttemptStatus | null; error: string | null; gone: boolean };
type CommandRun = { attempt: IntegrationCommandAttempt; status: IntegrationCommandAttemptStatus | null; error: string | null; gone: boolean };

export function ProviderConnect({ info, remote, refresh, onDone }: { info: IntegrationInfo; remote: boolean; refresh: () => Promise<IntegrationInfo | undefined>; onDone: () => void }) {
  const client = useChat((s) => s.client);
  const methods = useMemo(() => connectMethods(info), [info]);
  const env = useMemo(() => envNames(info), [info]);
  const [picked, setPicked] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oauth, setOauth] = useState<OauthRun | null>(null);
  const [command, setCommand] = useState<CommandRun | null>(null);

  // One method per provider is the common case: skip a picker that offers a
  // single choice and show that method's form straight away. With several, the
  // first (the server's own order, API key first) is shown until another is picked.
  const active = methods.find((m) => methodKey(m) === picked) ?? methods[0] ?? null;
  const activeKey = active ? methodKey(active) : null;
  const fields = (active && "form" in active ? active.form : undefined) ?? [];

  const done = useRef({ refresh, onDone });
  done.current = { refresh, onDone };
  /** The attempt whose sign-in would be abandoned if this panel went away. */
  const pending = useRef<{ kind: "oauth" | "command"; attemptID: string } | null>(null);

  // A different method means different fields: start its form from the
  // server's defaults, during render so the first paint already has them.
  const [answersFor, setAnswersFor] = useState<string | null>(null);
  if (activeKey !== answersFor) {
    setAnswersFor(activeKey);
    setAnswers(fields.length ? defaultAnswers(fields) : {});
  }

  // Walking away (another provider, closing settings, unmounting) abandons the
  // attempt: the server would otherwise hold a live callback open for minutes.
  useEffect(
    () => () => {
      const p = pending.current;
      if (!p || !client) return;
      void (p.kind === "oauth" ? client.cancelOauth(info.id, p.attemptID) : client.cancelCommand(info.id, p.attemptID)).catch(() => {});
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const settled = async () => {
    pending.current = null;
    let fresh = await done.current.refresh();
    // A machine credential is checked just after it's recorded, so the first
    // read can carry a connection with no verdict yet. Ask again briefly.
    for (let i = 0; i < 5 && fresh && connectionPending(fresh); i++) {
      await new Promise((r) => window.setTimeout(r, 400));
      fresh = await done.current.refresh();
    }
    const gap = fresh ? connectionSummary(fresh).needsAuth : null;
    if (gap) return setNotice(gap);
    setNotice(null);
    toast({ tone: "ok", title: `${displayName(info)} connected` });
    done.current.onDone();
  };

  // ---- sign-in --------------------------------------------------------
  const attemptID = oauth?.attempt.attemptID ?? null;
  useEffect(() => {
    if (!client || !attemptID) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const s = await client.oauthStatus(info.id, attemptID);
        if (stopped) return;
        setOauth((o) => (o && o.attempt.attemptID === attemptID ? { ...o, status: s, error: null } : o));
        if (shouldPoll(s)) timer = window.setTimeout(poll, POLL);
        else {
          pending.current = null;
          if (s.status === "complete") void settled();
        }
      } catch (e) {
        if (stopped) return;
        // The server forgot the attempt: cancelled here, or swept up.
        const gone = e instanceof OpenCodeError && e.status === 404;
        setOauth((o) => (o && o.attempt.attemptID === attemptID ? { ...o, gone, error: gone ? null : (e as Error).message } : o));
        if (!gone) timer = window.setTimeout(poll, POLL);
      }
    };
    timer = window.setTimeout(poll, POLL);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one loop per attempt
  }, [attemptID]);

  async function startOauth(m: ConnectMethod) {
    if (!client || m.type !== "oauth") return;
    setBusy(true);
    setError(null);
    setOauth(null);
    try {
      const attempt = await client.connectOauth(info.id, m.id, payloadAnswers(m.form ?? [], answers));
      setOauth({ attempt, status: null, error: null, gone: false });
      pending.current = { kind: "oauth", attemptID: attempt.attemptID };
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function stopOauth(run: OauthRun) {
    if (!client) return;
    pending.current = null;
    setOauth(null);
    await client.cancelOauth(info.id, run.attempt.attemptID).catch(() => {});
  }

  // ---- command --------------------------------------------------------
  const commandID = command?.attempt.attemptID ?? null;
  useEffect(() => {
    if (!client || !commandID) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const s = await client.commandStatus(info.id, commandID);
        if (stopped) return;
        setCommand((c) => (c && c.attempt.attemptID === commandID ? { ...c, status: s, error: null } : c));
        if (shouldPoll(s)) timer = window.setTimeout(poll, POLL);
        else {
          pending.current = null;
          if (s.status === "complete") void settled();
        }
      } catch (e) {
        if (stopped) return;
        const gone = e instanceof OpenCodeError && e.status === 404;
        setCommand((c) => (c && c.attempt.attemptID === commandID ? { ...c, gone, error: gone ? null : (e as Error).message } : c));
        if (!gone) timer = window.setTimeout(poll, POLL);
      }
    };
    timer = window.setTimeout(poll, POLL);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one loop per attempt
  }, [commandID]);

  async function startCommand(m: ConnectMethod) {
    if (!client || m.type !== "command") return;
    setBusy(true);
    setError(null);
    setCommand(null);
    try {
      const attempt = await client.connectCommand(info.id, m.id);
      setCommand({ attempt, status: null, error: null, gone: false });
      pending.current = { kind: "command", attemptID: attempt.attemptID };
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function stopCommand(run: CommandRun) {
    if (!client) return;
    pending.current = null;
    setCommand(null);
    await client.cancelCommand(info.id, run.attempt.attemptID).catch(() => {});
  }

  // ---- key and external ----------------------------------------------
  async function submit(m: ConnectMethod) {
    if (!client) return;
    const answer = payloadAnswers(fields, answers);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (m.type === "key") await client.connectKey(info.id, key.trim(), Object.keys(answer).length ? answer : undefined);
      else if (m.type === "external") await client.connectExternal(info.id, m.id, Object.keys(answer).length ? answer : undefined);
      else return;
      setKey("");
      await settled();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const missing = missingRequired(fields, answers);
  const blocked = missing.length > 0 || busy;
  const envLine = env.length ? `or set ${env.join(" or ")} on the agent machine` : null;
  // A connection the server recorded but marked unauthenticated: its own words
  // say what the machine wants ("Run `claude auth login`…").
  const needsAuth = connectionSummary(info).needsAuth ?? notice;

  return (
    <div className="mt-2">
      {methods.length > 1 && (
        <div className="mb-2.5 divide-y divide-[var(--border)] overflow-hidden rounded-lg border border-line">
          {methods.map((m) => {
            const on = activeKey === methodKey(m);
            return (
              <button
                key={methodKey(m)}
                type="button"
                onClick={() => {
                  setPicked(methodKey(m));
                  setOauth(null);
                  setCommand(null);
                  setNotice(null);
                  setError(null);
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors ${on ? "bg-hover text-ink" : "text-ink-2 hover:bg-hover hover:text-ink"}`}
              >
                <span className="grid w-4 shrink-0 place-items-center text-muted">{ICON[m.type]}</span>
                <span className="min-w-0 flex-1 truncate">{methodLabel(m)}</span>
                <span className={`shrink-0 text-[12px] ${on ? "text-muted" : "text-faint"}`}>{methodKindLabel(m)}</span>
              </button>
            );
          })}
        </div>
      )}

      {envLine && <div className="mb-2 text-[12px] text-faint">{envLine}</div>}
      {needsAuth && <div className="mb-2 text-[13px] text-warn">{needsAuth}</div>}
      {error && <div className="mb-2 text-[13px] break-words text-danger">{error}</div>}
      {active && methods.length === 1 && active.type !== "key" && <div className="mb-1.5 text-[12px] text-muted">{methodLabel(active)}</div>}

      {active && active.type === "key" && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!key.trim() || blocked) return;
            void submit(active);
          }}
        >
          <AnswerFields fields={fields} answers={answers} onChange={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))} />
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <TextField autoFocus type="password" placeholder={active.label ?? "API key"} value={key} onChange={(e) => setKey(e.target.value)} />
            </div>
            <Button type="submit" variant="primary" className="h-9" disabled={blocked || !key.trim()}>
              {busy ? <Spinner /> : methodVerb(active)}
            </Button>
          </div>
        </form>
      )}

      {active && active.type === "external" && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (blocked) return;
            void submit(active);
          }}
        >
          <AnswerFields fields={fields} answers={answers} onChange={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))} />
          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" className="h-9" disabled={blocked}>
              {busy ? <Spinner /> : methodVerb(active)}
            </Button>
            <span className="text-[12px] text-muted">Looks for credentials already on the agent machine.</span>
          </div>
        </form>
      )}

      {active && active.type === "command" && (
        <div className="space-y-2">
          {command ? (
            <AttemptProgress
              running={<Spinner size={12} />}
              state={command.gone ? "gone" : (command.status?.status ?? "pending")}
              note={command.gone ? "The login command stopped." : attemptNote(command.status)}
              error={command.error}
              onCancel={() => void stopCommand(command)}
              onRetry={() => void startCommand(active)}
            />
          ) : (
            <>
              <pre className="selectable scroll-quiet overflow-x-auto rounded-lg bg-sunken px-3 py-2 font-mono text-[12px] text-muted">{active.command.join(" ")}</pre>
              <div className="flex items-center gap-2">
                <Button variant="primary" className="h-9" disabled={busy} onClick={() => void startCommand(active)}>
                  {busy ? <Spinner /> : methodVerb(active)}
                </Button>
                <span className="text-[12px] text-muted">Runs on the agent machine and waits for it to finish.</span>
              </div>
            </>
          )}
        </div>
      )}

      {active && active.type === "oauth" && (
        <div className="space-y-2">
          {oauth ? (
            <OauthPanel
              run={oauth}
              remote={remote}
              deviceAlt={methods.find((m) => m.type === "oauth" && isDeviceLike(m) && methodKey(m) !== activeKey)}
              onOpen={() => void openExternal(oauth.attempt.url)}
              onCancel={() => void stopOauth(oauth)}
              onRetry={() => void startOauth(active)}
              onCode={(code) => void client?.completeOauth(info.id, oauth.attempt.attemptID, code).catch((e) => setOauth((o) => (o ? { ...o, error: (e as Error).message } : o)))}
            />
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (blocked) return;
                void startOauth(active);
              }}
            >
              <AnswerFields fields={fields} answers={answers} onChange={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))} />
              <div className="flex items-center gap-2">
                <Button type="submit" variant="primary" className="h-9" disabled={blocked}>
                  {busy ? <Spinner /> : methodVerb(active)}
                </Button>
                <span className="text-[12px] text-muted">Signs in on the agent machine's account, not a key.</span>
              </div>
            </form>
          )}
        </div>
      )}

      {info.connections.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-2.5">
          {info.connections.map((c) => (
            <div key={c.type === "env" ? `env:${c.name}` : c.id} className="flex min-h-6 items-center gap-2 text-[12px]">
              <Pip tone={c.status?.status === "needs_auth" ? "needs" : "on"} />
              <span className="min-w-0 flex-1 truncate text-muted">{c.type === "env" ? c.name : c.label}</span>
              {c.type === "credential" ? <Disconnect id={c.id} label={c.label} onRemoved={() => void done.current.refresh()} /> : <span className="shrink-0 text-faint">environment</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Forget one saved credential. Kept two-step, like removing an MCP server. */
function Disconnect({ id, label, onRemoved }: { id: string; label: string; onRemoved: () => void }) {
  const client = useChat((s) => s.client);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (error) return <span className="shrink-0 text-danger">{error}</span>;
  if (!confirm)
    return (
      <Button size="sm" variant="ghost" className="h-6 px-2 text-[12px]" onClick={() => setConfirm(true)}>
        Remove
      </Button>
    );
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button size="sm" variant="ghost" className="h-6 px-2 text-[12px]" onClick={() => setConfirm(false)}>
        Keep
      </Button>
      <Button
        size="sm"
        variant="danger"
        className="h-6 px-2 text-[12px]"
        disabled={busy}
        onClick={async () => {
          if (!client) return;
          setBusy(true);
          try {
            await client.removeCredential(id);
            toast({ tone: "ok", title: `${label} removed` });
            onRemoved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner size={12} /> : "Remove"}
      </Button>
    </span>
  );
}

/**
 * Browser and device sign-in share one panel: instructions verbatim (the
 * server wrote them), the code when there is one, the browser button, and a
 * quiet wait that stops on its own when the server says how it ended.
 */
function OauthPanel({
  run,
  remote,
  deviceAlt,
  onOpen,
  onCancel,
  onRetry,
  onCode,
}: {
  run: OauthRun;
  remote: boolean;
  deviceAlt?: ConnectMethod;
  onOpen: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onCode: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const shown = codeFromInstructions(run.attempt.instructions);
  const state = run.gone ? "gone" : (run.status?.status ?? "pending");
  const note = run.gone ? "That sign-in ended. Start it again to get a fresh code." : attemptNote(run.status);
  const waiting = state === "pending";
  const endsHere = remote && finishesOnAgentMachine(run.attempt.url);

  return (
    <div className="space-y-2">
      {run.attempt.instructions && <div className="selectable text-[13px] leading-relaxed text-ink-2">{run.attempt.instructions}</div>}
      {shown && (
        <div className="flex items-center gap-2">
          <code className="selectable rounded-md bg-sunken px-2 py-1 font-mono text-[13px] tracking-[0.04em] text-ink">{shown}</code>
          <Button
            size="sm"
            variant="ghost"
            icon={copied ? <Check size={13} /> : <Copy size={13} />}
            onClick={() => {
              void navigator.clipboard?.writeText(shown);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {state === "pending" && (
          <>
            <Button size="sm" variant="primary" icon={<ExternalLink size={13} />} onClick={onOpen}>
              Open browser
            </Button>
            <Button size="sm" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <span className="flex items-center gap-1.5 text-[12px] text-muted">
              <Spinner size={12} /> Waiting for you to finish signing in…
            </span>
          </>
        )}
        {(state === "failed" || state === "expired" || state === "gone") && (
          <>
            {note && <span className="text-[13px] text-danger">{note}</span>}
            <Button size="sm" variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          </>
        )}
        {state === "complete" && <span className="text-[13px] text-ok">Signed in.</span>}
      </div>
      {run.attempt.mode === "code" && waiting && (
        <form
          className="flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) onCode(code.trim());
          }}
        >
          <div className="min-w-0 flex-1">
            <TextField placeholder="Code from the browser" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
          <Button type="submit" className="h-9" disabled={!code.trim()}>
            Finish
          </Button>
        </form>
      )}
      {run.error && <div className="text-[13px] break-words text-danger">{run.error}</div>}
      {endsHere && waiting && (
        <div className="text-[12px] leading-relaxed text-warn">
          This sign-in finishes in a browser on the agent machine — the callback goes to its own loopback address — so it can't complete from this device.
          {deviceAlt ? ` Try “${methodLabel(deviceAlt)}” instead: it gives you a code to enter anywhere.` : ""}
        </div>
      )}
    </div>
  );
}

function AttemptProgress({ state, note, error, running, onCancel, onRetry }: { state: string; note: string | null; error: string | null; running: ReactNode; onCancel: () => void; onRetry: () => void }) {
  if (state === "complete") return <div className="text-[13px] text-ok">Finished.</div>;
  if (state === "pending") {
    return (
      <div className="flex items-center gap-2 text-[12px] text-muted">
        {running} <span>Waiting for the agent machine to finish…</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-danger">{error ?? note ?? "That didn't work."}</span>
      <Button size="sm" variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/**
 * One renderer for the server's form fields: text, choice, number, on/off and
 * a link out. `when` hides follow-up fields until their answer means
 * something, which is how Copilot asks for an enterprise URL only on
 * enterprise.
 */
function AnswerFields({ fields, answers, onChange }: { fields: FormField[]; answers: Answers; onChange: (key: string, value: FormValue) => void }) {
  const shown = visibleFields(fields, answers);
  const links = externalFields(fields);
  if (!shown.length && !links.length) return null;
  return (
    <div className="space-y-2">
      {shown.map((f) => (
        <Field key={f.key} field={f} value={answers[f.key]} onChange={(v) => onChange(f.key, v)} />
      ))}
      {links.map((f) => (
        <div key={f.key} className="flex items-center gap-2 text-[12px] text-muted">
          <span className="min-w-0 flex-1">{f.description ?? f.title ?? f.url}</span>
          <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => void openExternal(f.url)}>
            {f.title ?? "Open"}
          </Button>
        </div>
      ))}
    </div>
  );
}

function Field({ field, value, onChange }: { field: AnswerField; value: FormValue | undefined; onChange: (v: FormValue) => void }) {
  const label = field.title ?? field.key;
  const hint = field.description;
  if (field.type === "boolean") {
    return (
      <div className="flex min-h-9 items-center justify-between gap-3">
        <span className="min-w-0 text-[13px] text-ink-2">{label}</span>
        <Toggle on={value === true} onChange={onChange} label={label} />
      </div>
    );
  }
  if (field.type === "multiselect") {
    const picked = Array.isArray(value) ? value : [];
    return (
      <div>
        <span className="mb-1 block text-[12px] font-medium text-ink-2">{label}</span>
        <div className="flex flex-wrap gap-1.5">
          {field.options.map((o) => {
            const on = picked.includes(o.value);
            return (
              <Button key={o.value} size="sm" variant={on ? "primary" : "secondary"} aria-pressed={on} onClick={() => onChange(on ? picked.filter((v) => v !== o.value) : [...picked, o.value])}>
                {o.label}
              </Button>
            );
          })}
        </div>
      </div>
    );
  }
  if (field.type === "string" && field.options?.length && !field.custom) {
    return (
      <div>
        <span className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
          {label}
          {field.required && <span className="font-normal text-faint">Required</span>}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {field.options.map((o) => (
            <Button key={o.value} size="sm" variant={value === o.value ? "primary" : "secondary"} aria-pressed={value === o.value} title={o.description} onClick={() => onChange(o.value)}>
              {o.label}
            </Button>
          ))}
        </div>
        {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
      </div>
    );
  }
  const numeric = field.type === "number" || field.type === "integer";
  return (
    <TextField
      label={label}
      hint={hint}
      type={numeric ? "number" : field.type === "string" && field.format === "uri" ? "url" : "text"}
      inputMode={numeric ? "decimal" : undefined}
      min={numeric && typeof field.minimum === "number" ? field.minimum : undefined}
      max={numeric && typeof field.maximum === "number" ? field.maximum : undefined}
      step={field.type === "integer" ? 1 : undefined}
      placeholder={(field.type === "string" ? field.placeholder : undefined) ?? (field.required ? "Required" : undefined)}
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

