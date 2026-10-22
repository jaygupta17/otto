/**
 * When is an OpenCode server actually ready to answer a prompt?
 *
 * `GET /api/info` only proves the HTTP listener is up. On a cold start the
 * Location and its plugins are still activating, and `/api/model` answers 503
 * ("Location plugins did not finish activating") until they finish. `/api/agent`
 * does not wait for activation, so it can answer with a partial list first.
 *
 * This module waits for the catalog to settle, without ever throwing: the
 * connection turns the result into `status` + `catalog` and the UI decides
 * what to show. Warming is normal for a few seconds after a sandbox wakes.
 */
import type { AgentInfo, ModelInfo } from "@opencode/client";

/** The two catalog reads a server needs to answer. Matches `OpenCode`, easy to fake in tests. */
export interface CatalogClient {
  agents(directory?: string): Promise<AgentInfo[]>;
  models(directory?: string): Promise<ModelInfo[]>;
}

export type CatalogPhase = "ready" | "degraded" | "aborted";
export type CatalogReason = "auth" | "fatal" | "timeout" | "aborted";

export interface CatalogResult {
  ok: boolean;
  agents: AgentInfo[];
  models: ModelInfo[];
  reason?: CatalogReason;
  phase: CatalogPhase;
  /** The budget ran out while the server was still warming. */
  timedOut: boolean;
}

export interface PhaseInfo {
  /** 1-based poll number. */
  attempt: number;
  /** At least one of the two endpoints answered 200 (even if empty or partial). */
  responded: boolean;
}

export interface WaitForCatalogOptions {
  signal?: AbortSignal;
  /** Total time to keep trying. Default 45s. */
  budgetMs?: number;
  onPhase?: (phase: CatalogPhase | "warming", info: PhaseInfo) => void;
  /** Test seams: fake timers without touching the scheduler. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

/** Waits after each attempt; the last value repeats until the budget runs out. */
const DELAYS = [500, 1000, 2000, 4000, 8000];
const DEFAULT_BUDGET_MS = 45_000;
/** A single catalog read shouldn't hang the whole wait. */
const ATTEMPT_TIMEOUT_MS = 8_000;
/** Two empty 200s this far apart mean the server really has no models (fresh, no keys). */
const STABLE_EMPTY_MS = 1_000;

/**
 * Poll `/api/agent` and `/api/model` until they both come back non-empty, the
 * server proves it is genuinely empty, or the budget runs out.
 *
 * 401/403 stops at once (`auth`), 404 stops at once (`fatal`). Everything else
 * (5xx, a network blip, a timeout, the plugin-activation message) is a normal
 * warmup: keep trying until the budget. An empty agents list with models
 * present is still warming too: every real server has at least `build`.
 */
export async function waitForCatalog(client: CatalogClient, opts: WaitForCatalogOptions = {}): Promise<CatalogResult> {
  const budget = opts.budgetMs ?? DEFAULT_BUDGET_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const signal = opts.signal;
  const started = now();

  let agents: AgentInfo[] = [];
  let models: ModelInfo[] = [];
  /** When the previous consecutive empty read happened, in `now()` time. */
  let emptyAt: number | null = null;
  let responded = false;
  let attempt = 0;

  const report = (phase: CatalogPhase | "warming", respondedNow = responded) => opts.onPhase?.(phase, { attempt, responded: respondedNow });
  const aborted = (): CatalogResult => {
    report("aborted");
    return { ok: false, agents, models, reason: "aborted", phase: "aborted", timedOut: false };
  };
  const degraded = (reason: CatalogReason, timedOut: boolean): CatalogResult => {
    report("degraded");
    return { ok: false, agents, models, reason, phase: "degraded", timedOut };
  };

  if (signal?.aborted) return aborted();

  for (;;) {
    if (signal?.aborted) return aborted();
    attempt++;
    const slice = Math.max(1, Math.min(ATTEMPT_TIMEOUT_MS, budget - (now() - started)));
    let probe: Probe;
    try {
      probe = await probeCatalog(client, slice, signal);
    } catch (e) {
      if (isAbort(e) || signal?.aborted) return aborted();
      probe = { kind: "warming", responded: false };
    }
    if (signal?.aborted) return aborted();
    if (probe.responded) responded = true;

    if (probe.kind === "auth") return degraded("auth", false);
    if (probe.kind === "fatal") return degraded("fatal", false);

    if (probe.kind === "ready") {
      agents = probe.agents;
      models = probe.models;
      report("ready");
      return { ok: true, agents, models, phase: "ready", timedOut: false };
    }

    if (probe.kind === "empty") {
      agents = [];
      models = [];
      const at = now();
      if (emptyAt !== null && at - emptyAt >= STABLE_EMPTY_MS) {
        report("ready");
        return { ok: true, agents, models, phase: "ready", timedOut: false };
      }
      emptyAt = at;
      report("warming");
    } else {
      // A partial read looks like progress but isn't readiness: keep what it
      // gave us and wait for a full one. It also breaks the empty streak.
      if (probe.agents?.length) agents = probe.agents;
      if (probe.models?.length) models = probe.models;
      emptyAt = null;
      report("warming");
    }

    const elapsed = now() - started;
    if (elapsed >= budget) return degraded("timeout", true);
    const next = DELAYS[Math.min(attempt - 1, DELAYS.length - 1)];
    try {
      await sleep(Math.max(1, Math.min(next, budget - elapsed)), signal);
    } catch (e) {
      if (isAbort(e) || signal?.aborted) return aborted();
      // A failed sleep shouldn't spin: treat it as the rest of the wait.
      if (now() - started >= budget) return degraded("timeout", true);
    }
  }
}

type Probe =
  | { kind: "ready"; agents: AgentInfo[]; models: ModelInfo[]; responded: true }
  | { kind: "empty"; responded: true }
  | { kind: "warming"; agents?: AgentInfo[]; models?: ModelInfo[]; responded: boolean }
  | { kind: "auth"; responded: boolean }
  | { kind: "fatal"; responded: boolean };

async function probeCatalog(client: CatalogClient, timeoutMs: number, signal?: AbortSignal): Promise<Probe> {
  const call = <T>(p: Promise<T>) => withTimeout(p, timeoutMs, signal);
  const [agents, models] = await Promise.allSettled([call(client.agents()), call(client.models())]);

  // An error from either endpoint decides the round. `models` is the one that
  // awaits plugin activation, so a 503 there usually arrives first.
  const failed = [agents, models].find((r): r is PromiseRejectedResult => r.status === "rejected");
  const anyFulfilled = agents.status === "fulfilled" || models.status === "fulfilled";
  if (failed) {
    const message = String((failed.reason as { message?: unknown } | undefined)?.message ?? failed.reason ?? "");
    const status = statusOf(failed.reason);
    if (status === 401 || status === 403) return { kind: "auth", responded: anyFulfilled };
    if (isWarmingText(message)) return { kind: "warming", responded: anyFulfilled };
    if (status === 404) return { kind: "fatal", responded: anyFulfilled };
    return { kind: "warming", responded: anyFulfilled };
  }

  const a = agents.status === "fulfilled" ? agents.value : [];
  const m = models.status === "fulfilled" ? models.value : [];
  if (a.length && m.length) return { kind: "ready", agents: a, models: m, responded: true };
  if (!a.length && !m.length) return { kind: "empty", responded: true };
  // `build` always exists on a live server: agents empty but models present is
  // still activation in progress, not a real empty catalog.
  return { kind: "warming", agents: a, models: m, responded: true };
}

function statusOf(e: unknown): number | undefined {
  if (!e || typeof e !== "object") return undefined;
  const status = (e as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function isWarmingText(message: string) {
  return /did not finish activating|plugin/i.test(message);
}

function isAbort(e: unknown) {
  return (e as Error | undefined)?.name === "AbortError";
}

/** Reject when the budget slice ends or the wait is aborted; the request itself can't be cancelled. */
function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        cleanup();
        resolve(v);
      },
      (e) => {
        cleanup();
        reject(e);
      },
    );
  });
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}
