/**
 * Provider sign-in, as data: which methods an integration offers, what they're
 * called, what a form starts with and whether an attempt is still running.
 *
 * Pure functions and types only. `components/settings/ProviderConnect.tsx`
 * owns the network, the timers and the pixels; everything here can be reasoned
 * about (and tested) without a server.
 */
import type {
  ConnectionInfo,
  FormField,
  FormValue,
  FormWhen,
  IntegrationInfo,
  IntegrationMethod,
} from "@opencode/client";

/** Everything but `env`: a method you can actually act on. `env` is advice. */
export type ConnectMethod = Exclude<IntegrationMethod, { type: "env" }>;
export type MethodKind = ConnectMethod["type"];

/** A form's current values, keyed by field. */
export type Answers = Record<string, FormValue>;
/** What the connect endpoints take as `answer`. */
export type AnswerPayload = Record<string, string | number | boolean | string[]>;

const CONNECTABLE = (m: IntegrationMethod): m is ConnectMethod => m.type !== "env";

/** Methods that do something, in the server's own order (key first). */
export function connectMethods(info: IntegrationInfo): ConnectMethod[] {
  return info.methods.filter(CONNECTABLE);
}

/** Environment variable names that would work instead, e.g. `OPENAI_API_KEY`. */
export function envNames(info: IntegrationInfo): string[] {
  return info.methods.flatMap((m) => (m.type === "env" ? m.names : []));
}

/**
 * The server's label, which is already written for a person ("Sign in with
 * ChatGPT", "AWS profile (SSO or named profile)"). Key methods are the only
 * ones without a label, and "API key" says what the field wants.
 */
export function methodLabel(m: ConnectMethod): string {
  if (m.type === "key") return m.label || "API key";
  if (m.type === "oauth") return m.label || "Sign in";
  if (m.type === "external") return m.label || "Check this machine";
  return m.label || m.command.join(" ");
}

/** The one word on the button that starts this method. */
export function methodVerb(m: ConnectMethod): string {
  return m.type === "key" ? "Save" : m.type === "oauth" ? "Sign in" : m.type === "external" ? "Check" : "Run";
}

/** The quiet noun beside the method's label when a provider offers several. */
export function methodKindLabel(m: ConnectMethod): string {
  return m.type === "key" ? "API key" : m.type === "oauth" ? "Sign in" : m.type === "external" ? "Checks this machine" : "Runs a command";
}

/** A method that hands out a code to type somewhere else works from any device. */
export function isDeviceLike(m: ConnectMethod): boolean {
  return m.type === "oauth" && /device|headless/i.test(`${m.id} ${m.label ?? ""}`);
}

// ---- forms ------------------------------------------------------------

/** Every field the server sent, defaults filled in. Booleans start off. */
export function defaultAnswers(fields: readonly FormField[]): Answers {
  const out: Answers = {};
  for (const f of fields) {
    if (f.type === "boolean") out[f.key] = f.default ?? false;
    else if (f.type === "multiselect") out[f.key] = f.default ?? [];
    else if (f.type === "external") continue;
    else if (f.default !== undefined) out[f.key] = f.default;
  }
  return out;
}

function whenMet(when: FormWhen[] | undefined, answers: Answers): boolean {
  if (!when?.length) return true;
  return when.every((w) => {
    const v = answers[w.key];
    const same = v === w.value || (Array.isArray(v) ? v.length === 1 && v[0] === String(w.value) : String(v) === String(w.value));
    return w.op === "eq" ? same : !same;
  });
}

/** Every form field that takes an answer rather than a link out. */
export type AnswerField = Exclude<FormField, { type: "external" }>;

/** Fields worth showing: not `hidden`, and their `when` holds. */
export function visibleFields(fields: readonly FormField[], answers: Answers): AnswerField[] {
  return fields.filter((f): f is AnswerField => f.type !== "external" && !f.hidden && whenMet(f.when, answers));
}

/** Fields whose `url` is worth offering (the server can't open it for you). */
export function externalFields(fields: readonly FormField[]): Extract<FormField, { type: "external" }>[] {
  return fields.filter((f): f is Extract<FormField, { type: "external" }> => f.type === "external");
}

const filled = (v: FormValue | undefined) => (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null);

/** Required, visible fields still empty. Empty means Save stays off. */
export function missingRequired(fields: readonly FormField[], answers: Answers): AnswerField[] {
  return visibleFields(fields, answers).filter((f) => f.required && !filled(answers[f.key]));
}

/**
 * What to send as `answer`: fields the form is showing (or hiding with a
 * value), numbers as numbers, empty optional strings left out so the server's
 * own default applies.
 */
export function payloadAnswers(fields: readonly FormField[], answers: Answers): AnswerPayload {
  const out: AnswerPayload = {};
  for (const f of fields) {
    if (f.type === "external") continue;
    if (!f.hidden && !whenMet(f.when, answers)) continue;
    const v = answers[f.key];
    if (!filled(v)) continue;
    if (f.type === "number" || f.type === "integer") {
      const n = Number(v);
      if (!Number.isNaN(n)) out[f.key] = n;
    } else if (Array.isArray(v)) out[f.key] = v;
    else out[f.key] = v as string | number | boolean;
  }
  return out;
}

// ---- sign-in attempts -------------------------------------------------

/** `gone` is the server saying it has no such attempt any more (cancelled, or swept up). */
export type AttemptState = AttemptStatusLike["status"] | "gone";

/** The part of an attempt's status this module reads; OAuth and command use the same words. */
export type AttemptStatusLike = { status: "pending" | "complete" | "failed" | "expired"; message?: string };

export function attemptState(s: AttemptStatusLike | null | undefined): AttemptState {
  if (!s) return "pending";
  return s.status;
}

/** Only a pending attempt is worth asking about again. */
export function shouldPoll(s: AttemptStatusLike | null | undefined): boolean {
  return attemptState(s) === "pending";
}

/** What to tell the user about how the attempt ended, or null while it runs. */
export function attemptNote(s: AttemptStatusLike | null | undefined): string | null {
  if (!s) return null;
  if (s.status === "failed") return s.message ?? "That didn't work.";
  if (s.status === "expired") return "This sign-in expired before it finished.";
  if (s.status === "complete") return "Signed in.";
  return null;
}

/** The wait after an attempt's deadline before Otto stops asking. */
export const ATTEMPT_GRACE = 2000;

/**
 * Whether an attempt's own deadline has passed. The server normally answers
 * `expired` itself, but one that never does would leave a panel waiting
 * forever, so the attempt's `time.expires` is enforced here too. The grace
 * covers a status call already in flight when the deadline lands.
 *
 * Both attempt shapes carry the same `time`, and a non-finite `expires`
 * (`Infinity` on a command attempt) means there is no deadline to enforce.
 */
export function attemptExpired(attempt: { time: { expires: number | string } } | null | undefined, now: number, grace = ATTEMPT_GRACE): boolean {
  const expires = attempt?.time.expires;
  if (typeof expires !== "number" || !Number.isFinite(expires)) return false;
  return now >= expires + grace;
}

/**
 * What a panel should show for an attempt: the server's own complete or
 * failed wins, then Otto's deadline, then whatever the server last said. A
 * `pending` that lands after the deadline therefore reads as expired.
 */
export function attemptView(run: { gone?: boolean; expired?: boolean; status?: AttemptStatusLike | null }): AttemptState {
  if (run.gone) return "gone";
  const reported = run.status?.status;
  if (reported === "complete" || reported === "failed") return reported;
  if (run.expired) return "expired";
  return reported ?? "pending";
}

/**
 * The device code, when the server put it inside its instructions rather than
 * in a field of its own: "Enter code: VHMW-P6K3A".
 */
const CODE = /\bcode\b\s*[:=]?\s*([A-Z0-9]{4,}(?:-[A-Z0-9]{4,})*)/i;

export function codeFromInstructions(instructions: string | null | undefined): string | null {
  if (!instructions) return null;
  const m = CODE.exec(instructions);
  return m ? m[1].toUpperCase() : null;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

/**
 * Whether a sign-in can only finish in a browser on the agent machine: the
 * flow's `redirect_uri` (or the whole URL) points at loopback, so the callback
 * never reaches a phone, or a desktop talking to a remote sandbox.
 *
 * Device-code flows open a public page instead and work from anywhere.
 */
export function finishesOnAgentMachine(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    const redirect = u.searchParams.get("redirect_uri");
    if (redirect) return LOOPBACK.has(new URL(redirect).hostname);
    return LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

/** Whether Otto is talking to a machine other than the one it runs on. */
export function isRemoteUrl(baseUrl: string): boolean {
  try {
    const u = new URL(baseUrl);
    return !LOOPBACK.has(u.hostname) && !u.hostname.endsWith(".localhost");
  } catch {
    return true;
  }
}

// ---- connections ------------------------------------------------------

export interface ConnectionSummary {
  /** The server knows a credential or env var for this integration. */
  connected: boolean;
  /** Set when the connection exists but the machine still needs to sign in. */
  needsAuth: string | null;
  /** Credential connections the server can remove. Env ones it can't. */
  removable: string[];
}

export function connectionSummary(info: IntegrationInfo): ConnectionSummary {
  const creds = info.connections;
  return {
    connected: creds.length > 0,
    needsAuth: creds.find(needsAuthMessage)?.status?.message ?? null,
    removable: creds.filter((c): c is Extract<ConnectionInfo, { type: "credential" }> => c.type === "credential").map((c) => c.id),
  };
}

function needsAuthMessage(c: ConnectionInfo): boolean {
  return c.status?.status === "needs_auth";
}

/**
 * A credential the server has recorded but not yet judged: machine
 * credentials are checked just after they're stored, so the first read can
 * carry a connection with no `status`.
 */
export function connectionPending(info: IntegrationInfo): boolean {
  return info.connections.some((c) => c.type === "credential" && !c.status);
}
