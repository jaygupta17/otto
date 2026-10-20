/**
 * Apps: Gmail, Calendar, Slack and the rest, through the user's own Composio
 * account. A key once; then one tap per app, approved in the app's own
 * sign-in page. Every teammate on every machine can use what's connected.
 */
import { AnimatePresence, motion } from "motion/react";
import { Check, ExternalLink, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { APPS, appLogo, COMPOSIO_KEY_URL, type Account, type App } from "../../lib/composio";
import { openExternal } from "../../lib/platform";
import { useChat } from "../../state/chat";
import { useConnectors } from "../../state/connectors";
import { Button } from "../ui/Button";
import { TextField } from "../ui/Field";
import { Spinner } from "../ui/AgentClock";
import { Rows, Section, StatusDot } from "./common";
import { APP_PERMISSIONS_ID } from "./AppPermissions";
import { appEffect, KINDS, sample } from "../../lib/appPermissions";
import { useExtensions } from "../../state/extensions";
import { useUI } from "../../state/ui";

export function AppsTab() {
  const key = useConnectors((s) => s.key);
  const init = useConnectors((s) => s.init);
  const load = useConnectors((s) => s.load);
  useEffect(() => {
    void init().then(() => load());
  }, [init, load]);

  if (key === undefined)
    return (
      <div className="flex justify-center py-10 text-muted">
        <Spinner />
      </div>
    );
  return (
    <Section page title="Apps" desc="Let your teammates work in your email, calendar, docs and chat.">
      {key ? <Connected /> : <Setup />}
    </Section>
  );
}

function Logo({ slug, size = 28 }: { slug: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-[9px] bg-white hairline" style={{ width: size, height: size }}>
      <img src={appLogo(slug)} alt="" width={size * 0.62} height={size * 0.62} draggable={false} />
    </span>
  );
}

/** First visit: what this is, and the one key it needs. */
function Setup() {
  const saveKey = useConnectors((s) => s.saveKey);
  const error = useConnectors((s) => s.error);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="rounded-2xl bg-raised p-5 hairline">
      <div className="flex -space-x-1.5">
        {APPS.slice(0, 6).map((a) => (
          <Logo key={a.slug} slug={a.slug} size={34} />
        ))}
      </div>
      <h3 className="mt-4 text-[16px] font-semibold text-ink">Bring your apps</h3>
      <p className="mt-1 max-w-[460px] text-[13px] leading-relaxed text-muted">
        Otto connects apps through Composio, using a free account of your own. You approve each app on its own sign-in page, and the access stays between you, Composio and the app.
      </p>
      <ol className="mt-5 space-y-4 text-[13.5px] text-ink-2">
        <li className="flex gap-3">
          <Step n={1} />
          <div className="min-w-0 flex-1">
            <div>Get your key from Composio</div>
            <div className="mt-0.5 text-[12.5px] text-muted">Sign in, then For You → Sessions &amp; API Key.</div>
            <Button size="sm" className="mt-2" trailing={<ExternalLink size={13} />} onClick={() => void openExternal(COMPOSIO_KEY_URL)}>
              Open Composio
            </Button>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <form
            className="min-w-0 flex-1"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!value.trim()) return;
              setBusy(true);
              const ok = await saveKey(value);
              setBusy(false);
              if (ok) setValue("");
            }}
          >
            <div>Paste it here</div>
            <div className="mt-2 flex items-start gap-2">
              <div className="flex-1">
                <TextField type="password" autoComplete="off" spellCheck={false} placeholder="ck_…" value={value} onChange={(e) => {
                    setValue(e.target.value);
                    if (error) useConnectors.setState({ error: null });
                  }}
                  error={error} />
              </div>
              <Button type="submit" variant="primary" className="h-9" disabled={busy || !value.trim()}>
                {busy ? <Spinner size={13} /> : "Save"}
              </Button>
            </div>
            <div className="mt-1.5 text-[12px] text-faint">Kept in this device's keychain, and in a private file on each agent machine.</div>
          </form>
        </li>
      </ol>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-active text-[12px] font-semibold text-ink">{n}</span>;
}

function Connected() {
  const accounts = useConnectors((s) => s.accounts);
  const error = useConnectors((s) => s.error);
  const load = useConnectors((s) => s.load);
  return (
    <>
      {error && !accounts && (
        <div className="mb-3 flex items-center gap-2 text-[13px] text-danger">
          {error}
          <Button size="sm" variant="ghost" icon={<RotateCw size={13} />} onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}
      <Rows>
        {APPS.map((a) => (
          <AppRow key={a.slug} app={a} />
        ))}
      </Rows>
      <p className="mt-3 text-[12.5px] text-muted">Need another app? Just ask. Your teammate finds it among 500+ and asks you to connect it.</p>
      <Machine />
    </>
  );
}

/** One empty list for every row: a fresh [] from a selector re-renders forever. */
const NONE: Account[] = [];

function AppRow({ app }: { app: App }) {
  const loaded = useConnectors((s) => s.accounts !== null);
  const accounts = useConnectors((s) => s.accounts?.[app.slug]) ?? NONE;
  const pending = useConnectors((s) => s.pending[app.slug]);
  const connect = useConnectors((s) => s.connect);
  const cancel = useConnectors((s) => s.cancel);
  const disconnect = useConnectors((s) => s.disconnect);
  const [busy, setBusy] = useState(false);
  // Abandoned attempts linger as "initiated"; only real accounts count.
  const live = accounts.filter((a) => a.status === "active");
  const lapsed = accounts.filter((a) => a.status === "expired" || a.status === "inactive");
  const start = async () => {
    setBusy(true);
    await connect(app.slug);
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Logo slug={app.slug} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13.5px] font-medium text-ink">
          {app.name}
          {live.length > 0 && <Check size={13} className="text-ok" aria-label="Connected" />}
        </div>
        <div className="truncate text-[12.5px] text-muted">
          {pending ? "Waiting for you in the browser…" : live.length > 1 ? `${live.length} accounts` : lapsed.length && !live.length ? "Sign-in expired" : app.blurb}
        </div>
      </div>
      <AnimatePresence mode="popLayout" initial={false}>
        {!loaded ? (
          <motion.span key="load" className="text-faint" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Spinner size={13} />
          </motion.span>
        ) : pending ? (
          <motion.div key="pending" className="flex items-center gap-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Button size="sm" variant="ghost" onClick={() => void openExternal(pending.url)}>
              Open again
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Stop connecting ${app.name}`} onClick={() => cancel(app.slug)}>
              <X size={14} />
            </Button>
          </motion.div>
        ) : live.length ? (
          <motion.div key="live" className="flex items-center gap-1" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Button size="sm" variant="ghost" disabled={busy} onClick={start}>
              Add account
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted hover:text-danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                for (const a of live) await disconnect(app.slug, a.id);
                setBusy(false);
              }}
            >
              Disconnect
            </Button>
          </motion.div>
        ) : (
          <motion.div key="connect" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <Button size="sm" disabled={busy} onClick={start}>
              {busy ? <Spinner size={12} /> : lapsed.length ? "Reconnect" : "Connect"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** What every teammate may do in your apps, unless its own permissions say otherwise; changed in General. */
function AppsAllowed() {
  const rules = useExtensions((s) => s.config?.permissions);
  const loaded = useExtensions((s) => !!s.config);
  const client = useChat((s) => s.client);
  useEffect(() => {
    if (client && !useExtensions.getState().config) void useExtensions.getState().load();
  }, [client]);
  const open = () => {
    useUI.getState().openSettings("general");
    setTimeout(() => document.getElementById(APP_PERMISSIONS_ID)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
  };
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-[13px]">
      <span className="min-w-0 flex-1">
        <span className="block text-ink-2">What teammates may do</span>
        {loaded && (
          <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-[12px] text-muted">
            {KINDS.map((k) => {
              const e = appEffect(sample("*", k.kind), { global: rules ?? [], agent: [] });
              return (
                <span key={k.kind} className="inline-flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${e === "allow" ? "bg-ok" : e === "ask" ? "bg-warn" : "bg-danger"}`} />
                  {k.label}: {e === "allow" ? "Allow" : e === "ask" ? "Ask" : "Block"}
                </span>
              );
            })}
          </span>
        )}
      </span>
      <Button size="sm" variant="ghost" onClick={open}>
        Change
      </Button>
    </div>
  );
}

/** Whether the machine you're on can use them, and the key itself. */
function Machine() {
  const machine = useConnectors((s) => s.machine);
  const install = useConnectors((s) => s.install);
  const forgetKey = useConnectors((s) => s.forgetKey);
  const connected = useChat((s) => !!s.client);
  const [confirm, setConfirm] = useState(false);
  const state = !connected
    ? { tone: "muted" as const, text: "Connect to a workspace and its teammates get these apps." }
    : machine === "ready"
      ? { tone: "ok" as const, text: "Teammates on this workspace can use your apps." }
      : machine === "error"
        ? { tone: "danger" as const, text: "Couldn't add your apps to this workspace." }
        : { tone: "warn" as const, text: "Adding your apps to this workspace…" };
  return (
    <div className="mt-6">
      <Rows>
        <AppsAllowed />
        <div className="flex items-center gap-3 px-4 py-3 text-[13px]">
          <StatusDot tone={state.tone} />
          <span className="min-w-0 flex-1 text-ink-2">{state.text}</span>
          {machine === "error" && (
            <Button size="sm" onClick={() => void install(true)}>
              Try again
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3 px-4 py-3 text-[13px]">
          <span className="min-w-0 flex-1 text-ink-2">Composio key</span>
          {confirm ? (
            <>
              <span className="text-[12.5px] text-muted">Teammates lose your apps.</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                Keep
              </Button>
              <Button size="sm" variant="danger" onClick={() => void forgetKey()}>
                Remove
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" className="text-muted hover:text-danger" onClick={() => setConfirm(true)}>
              Remove key
            </Button>
          )}
        </div>
      </Rows>
    </div>
  );
}
