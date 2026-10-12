/**
 * Provisioning and reconnect flows for sandbox-backed workspaces.
 * Each step reports progress so the UI can tell a calm, honest story.
 */
import { BoatClient, BoatError, BOOTING_STATES, RUNNING_STATES, OPENCODE_PORT, installScript, serviceScript, healthScript, wrapScript, type BoatSandbox } from "./boat";
import { OpenCode, type ServerEndpoint } from "../opencode/client";
import { randomSecret, uid } from "../id";

export type SetupStepId = "verify" | "machine" | "install" | "server" | "tunnel" | "hello";

export const SETUP_STEPS: { id: SetupStepId; title: string; hint: string }[] = [
  { id: "verify", title: "Checking your key", hint: "Signing in to your cloud account" },
  { id: "machine", title: "Launching a cloud machine", hint: "Linux microVM" },
  { id: "install", title: "Installing OpenCode", hint: "The agent engine, v2" },
  { id: "server", title: "Starting the agent server", hint: "Runs as a service, survives sleep" },
  { id: "tunnel", title: "Opening a secure URL", hint: "HTTPS, password-protected" },
  { id: "hello", title: "Saying hello", hint: "First handshake with your agent" },
];

export interface StepUpdate {
  step: SetupStepId;
  state: "active" | "done" | "error";
  detail?: string;
}

export interface ProvisionResult {
  sandboxId: string;
  endpoint: ServerEndpoint;
  version?: string;
}

export interface ProvisionCheckpoint {
  idempotencyKey: string;
  password: string;
  sandboxId?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function newCheckpoint(): ProvisionCheckpoint {
  return { idempotencyKey: crypto.randomUUID?.() ?? uid("idem_"), password: randomSecret(32) };
}

/**
 * Full first-time setup. `checkpoint` makes retries resume where they stopped
 * (same sandbox, same password) instead of starting a second billable machine.
 */
export async function provisionBoat(
  apiKey: string,
  checkpoint: ProvisionCheckpoint,
  opts: { ttlSeconds: number | null; type?: string; name?: string },
  report: (u: StepUpdate) => void,
  signal: AbortSignal,
  onCheckpoint: (c: ProvisionCheckpoint) => void,
): Promise<ProvisionResult> {
  const boat = new BoatClient(apiKey);
  const step = async <T>(id: SetupStepId, fn: () => Promise<T>): Promise<T> => {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    report({ step: id, state: "active" });
    try {
      const v = await fn();
      report({ step: id, state: "done" });
      return v;
    } catch (e) {
      report({ step: id, state: "error", detail: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  };

  const limits = await step("verify", async () => {
    await boat.me(signal);
    const l = await boat.limits(signal).catch(() => null);
    // Reusing a sandbox from a previous attempt doesn't need a new start slot.
    if (l && !l.canStart && !checkpoint.sandboxId) {
      throw new BoatError(402, "start_blocked", l.startBlockedReason || l.blockedReason || "Boat can't start new machines on this account right now.");
    }
    if (l && l.maxActiveSandboxes && l.activeSandboxes >= l.maxActiveSandboxes && !checkpoint.sandboxId) {
      throw new BoatError(429, "limit_reached", `You already have ${l.activeSandboxes} of ${l.maxActiveSandboxes} sandboxes running. Put one to sleep in the Boat dashboard, then retry.`);
    }
    return l;
  });
  if (limits?.accessTier === "trial") {
    // Trial: auto-stop must be ≤ 2h and only small/default sizes are allowed.
    if (opts.ttlSeconds === null || opts.ttlSeconds > 7200) opts = { ...opts, ttlSeconds: 7200 };
    if (opts.type && !["small", "default"].includes(opts.type)) opts = { ...opts, type: "default" };
  }

  const sandbox = await step("machine", async () => {
    let sb: BoatSandbox;
    if (checkpoint.sandboxId) {
      sb = await boat.get(checkpoint.sandboxId);
      if (sb.state === "archived") await boat.resume(sb.id);
      if (sb.state === "error" || sb.state === "cancelled") {
        checkpoint.sandboxId = undefined;
        checkpoint.idempotencyKey = crypto.randomUUID?.() ?? uid("idem_");
      }
    }
    if (!checkpoint.sandboxId) {
      sb = await createWithTrialFallback(boat, opts, checkpoint.idempotencyKey);
      checkpoint.sandboxId = sb.id;
      onCheckpoint({ ...checkpoint });
    }
    return waitUntilRunning(boat, checkpoint.sandboxId!, signal, (d) => report({ step: "machine", state: "active", detail: d }));
  });

  const version = await step("install", async () => {
    const r = await runScript(boat, sandbox.id, installScript(), 600, signal);
    return r.stdout.trim().split("\n").pop()?.replace(/^opencode\s+/, "");
  });

  await step("server", async () => {
    const r = await runScript(boat, sandbox.id, serviceScript(checkpoint.password), 180, signal);
    if (!r.stdout.includes("OTTO_READY")) throw new Error(lastLines(r.stdout + "\n" + r.stderr) || "The agent server didn't start.");
  });

  const endpoint = await step("tunnel", async () => endpointFromHostUrl(await boat.host(sandbox.id, OPENCODE_PORT, "Otto agent"), checkpoint.password));

  await step("hello", async () => {
    const oc = new OpenCode(endpoint);
    let lastErr: unknown;
    // The proxy route can take a few seconds to propagate.
    for (let i = 0; i < 20; i++) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      try {
        await oc.info(signal);
        return;
      } catch (e) {
        lastErr = e;
        await sleep(1500);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("Couldn't reach the agent server over HTTPS.");
  });

  return { sandboxId: sandbox.id, endpoint, version };
}

async function createWithTrialFallback(boat: BoatClient, opts: { ttlSeconds: number | null; type?: string; name?: string }, key: string) {
  try {
    return await boat.create(opts, key);
  } catch (e) {
    if (e instanceof BoatError && e.code === "trial_auto_stop_required") {
      return boat.create({ ...opts, ttlSeconds: 7200 }, key + "-trial");
    }
    throw e;
  }
}

export async function waitUntilRunning(boat: BoatClient, id: string, signal: AbortSignal, onDetail?: (d: string) => void): Promise<BoatSandbox> {
  const started = Date.now();
  for (;;) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    const sb = await boat.get(id, signal);
    if (RUNNING_STATES.includes(sb.state)) return sb;
    if (sb.state === "error" || sb.state === "cancelled") throw new Error(sb.error || "The machine failed to start.");
    if (sb.state === "archived" && Date.now() - started > 4000) {
      // Resume was not picked up; nudge once more.
      await boat.resume(id).catch(() => {});
    }
    onDetail?.(BOOTING_STATES.includes(sb.state) ? `State: ${sb.state}` : sb.state === "archiving" ? "Finishing a previous snapshot" : `State: ${sb.state}`);
    if (Date.now() - started > 6 * 60_000) throw new Error("The machine is taking unusually long to start.");
    await sleep(1500);
  }
}

/** Run a bash script, retrying the transient "still starting" class of errors. */
async function runScript(boat: BoatClient, id: string, script: string, timeoutSeconds: number, signal: AbortSignal) {
  for (let i = 0; ; i++) {
    try {
      const r = await boat.command(id, wrapScript(script), timeoutSeconds, signal);
      if (!r.success) {
        throw new Error(lastLines(r.stdout + "\n" + r.stderr) || `Command failed (exit ${r.exitCode ?? "?"})`);
      }
      return r;
    } catch (e) {
      const transient = e instanceof BoatError && (e.code === "sandbox_starting" || (e.code === "sandbox_direct_failed" && e.retryable));
      if (!transient || i >= 20 || signal.aborted) throw e;
      await sleep(2000);
    }
  }
}

function lastLines(s: string, n = 6) {
  return s.trim().split("\n").filter(Boolean).slice(-n).join("\n");
}

function endpointFromHostUrl(url: string, password: string): ServerEndpoint {
  const u = new URL(url);
  const gateToken = u.searchParams.get("_token") ?? undefined;
  return { baseUrl: u.origin, password, gateToken };
}

/**
 * Bring an existing Boat workspace back: resume if asleep, make sure the
 * service answers (repairing it if needed), and refresh the tunnel URL.
 */
export async function reviveBoat(
  apiKey: string,
  sandboxId: string,
  password: string,
  report: (phase: "waking" | "repairing", detail?: string) => void,
  signal: AbortSignal,
): Promise<ServerEndpoint> {
  const boat = new BoatClient(apiKey);
  let sb = await boat.get(sandboxId, signal);
  if (sb.state === "cancelled") throw new BoatError(404, "not_found", "This sandbox no longer exists.");
  if (!RUNNING_STATES.includes(sb.state)) {
    report("waking", "Resuming from snapshot");
    if (sb.state === "archived" || sb.state === "error") await boat.resume(sandboxId);
    sb = await waitUntilRunning(boat, sandboxId, signal, (d) => report("waking", d));
  }
  report("repairing", "Checking the agent server");
  const health = await runScript(boat, sandboxId, healthScript(password), 60, signal).catch(() => null);
  if (!health?.stdout.includes("OTTO_READY")) {
    report("repairing", "Restarting the agent server");
    await runScript(boat, sandboxId, installScript(), 600, signal);
    const r = await runScript(boat, sandboxId, serviceScript(password), 180, signal);
    if (!r.stdout.includes("OTTO_READY")) throw new Error("The agent server didn't come back up.");
  }
  report("repairing", "Refreshing the tunnel");
  return endpointFromHostUrl(await boat.host(sandboxId, OPENCODE_PORT, "Otto agent"), password);
}
