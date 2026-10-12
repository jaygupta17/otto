/**
 * boxd (https://boxd.sh) provider: hardware-isolated Linux microVMs that
 * hibernate when idle and wake on the first request.
 *
 * Uses boxd's official SDK through its `web` entry (grpc-web over fetch;
 * boxd.sh:9443 sends CORS headers), so it runs in the app's webview on every
 * platform with no native code.
 */
import { Boxd, APIStatusError, AuthenticationError, PermissionDeniedError, RateLimitError, type Machine } from "@boxd-sh/sdk/web";
import { OpenCode, type ServerEndpoint } from "../opencode/client";
import { OPENCODE_PORT, healthScript, installScript, serviceScript, wrapScript } from "./boat";
import type { ProvisionCheckpoint, ProvisionResult, SetupStepId, StepUpdate } from "./provision";

export const BOXD_KEYS_URL = "https://app.boxd.sh";
export const BOXD_BILLING_URL = "https://app.boxd.sh";
/** Subdomain proxy name. Subdomain proxies skip boxd's bot check, which would answer API clients with a 503 while waking. */
const PROXY = "otto";

export const BOXD_SIZES = [
  { id: "1", label: "Small", spec: "1 vCPU · 4 GB" },
  { id: "2", label: "Standard", spec: "2 vCPU · 8 GB" },
  { id: "4", label: "Large", spec: "4 vCPU · 16 GB" },
];
export const BOXD_SLEEP = [
  { id: 900, label: "15 min" },
  { id: 3600, label: "1 hour" },
  { id: 14400, label: "4 hours" },
  { id: 0, label: "Never" },
];

export class BoxdError extends Error {
  constructor(
    message: string,
    readonly billing = false,
  ) {
    super(message);
  }
}

export function boxdClient(apiKey: string) {
  return new Boxd({ apiKey, maxRetries: 2 });
}

/** Turn SDK errors into sentences a person can act on. */
export function humanizeBoxd(e: unknown): BoxdError {
  if (e instanceof BoxdError) return e;
  if (e instanceof AuthenticationError) return new BoxdError("That API key wasn't accepted. Check it in the boxd console and try again.");
  if (e instanceof PermissionDeniedError) return new BoxdError("This API key can't create machines. Use a member key from the boxd console.");
  if (e instanceof RateLimitError) return new BoxdError("boxd is rate-limiting this key. Wait a moment, then retry.");
  const msg = e instanceof Error ? e.message : String(e);
  if (/balance|billing|payment|credit|quota|insufficient/i.test(msg)) return new BoxdError(`boxd: ${msg}`, true);
  if (e instanceof APIStatusError) return new BoxdError(`boxd: ${msg}`);
  return new BoxdError(msg);
}

export async function verifyBoxdKey(apiKey: string) {
  try {
    return await boxdClient(apiKey).account.get();
  } catch (e) {
    throw humanizeBoxd(e);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const abortIf = (s: AbortSignal) => {
  if (s.aborted) throw new DOMException("Cancelled", "AbortError");
};

async function run(boxd: Boxd, id: string, script: string, timeoutSeconds: number, signal: AbortSignal) {
  for (let i = 0; ; i++) {
    abortIf(signal);
    try {
      const r = await boxd.machines.exec(id, { command: ["bash", "-lc", wrapScript(script)], timeout: timeoutSeconds * 1000 });
      if (r.exitCode !== 0) throw new BoxdError(lastLines(r.stdout + "\n" + r.stderr) || `Command failed (exit ${r.exitCode})`);
      return r;
    } catch (e) {
      // A machine that just booted can refuse exec for a moment.
      const transient = e instanceof APIStatusError && /unavailable|not ready|starting|booting/i.test(e.message);
      if (!transient || i >= 15) throw humanizeBoxd(e);
      await sleep(2000);
    }
  }
}

function lastLines(s: string, n = 6) {
  return s.trim().split("\n").filter(Boolean).slice(-n).join("\n");
}

/** The HTTPS URL of the `otto` subdomain proxy, creating it on first use. */
async function ensureProxy(boxd: Boxd, machine: Machine): Promise<string> {
  const list = await boxd.machines.proxies.list(machine.id);
  const mine = list.find((p) => p.name === PROXY);
  if (mine) {
    if (mine.port !== OPENCODE_PORT) await boxd.machines.proxies.setPort(machine.id, OPENCODE_PORT, { name: PROXY });
    return `https://${mine.domain}`;
  }
  await boxd.machines.proxies.create(machine.id, PROXY, OPENCODE_PORT);
  const made = (await boxd.machines.proxies.list(machine.id)).find((p) => p.name === PROXY);
  return `https://${made?.domain ?? `${PROXY}.${machine.name}.boxd.sh`}`;
}

export async function wake(boxd: Boxd, machine: Machine, signal: AbortSignal, onDetail: (d: string) => void): Promise<Machine> {
  if (machine.status === "destroyed") throw new BoxdError("This machine no longer exists on boxd.");
  if (machine.status === "stopped") {
    onDetail("Booting the machine");
    await boxd.machines.start(machine.id);
  } else if (machine.status === "suspended" || machine.status === "hibernated") {
    onDetail("Waking from hibernation");
    await boxd.machines.wake(machine.id);
  } else if (machine.status === "failed") {
    onDetail("Rebooting the machine");
    await boxd.machines.reboot(machine.id);
  }
  abortIf(signal);
  return boxd.machines.waitUntilReady(machine.id, { timeout: 180_000 });
}

/**
 * First-time setup on boxd. `checkpoint.sandboxId` holds the machine id so a
 * retry reuses the same machine instead of creating another.
 */
export async function provisionBoxd(
  apiKey: string,
  checkpoint: ProvisionCheckpoint,
  opts: { vcpu: number; hibernateAfter: number; name?: string },
  report: (u: StepUpdate) => void,
  signal: AbortSignal,
  onCheckpoint: (c: ProvisionCheckpoint) => void,
): Promise<ProvisionResult> {
  const boxd = boxdClient(apiKey);
  const step = async <T>(id: SetupStepId, fn: () => Promise<T>): Promise<T> => {
    abortIf(signal);
    report({ step: id, state: "active" });
    try {
      const v = await fn();
      report({ step: id, state: "done" });
      return v;
    } catch (e) {
      const err = (e as Error)?.name === "AbortError" ? e : humanizeBoxd(e);
      report({ step: id, state: "error", detail: (err as Error).message });
      throw err;
    }
  };

  await step("verify", () => boxd.account.get());

  const machine = await step("machine", async () => {
    let m: Machine | null = null;
    if (checkpoint.sandboxId) m = await boxd.machines.get(checkpoint.sandboxId).catch(() => null);
    if (!m || m.status === "destroyed") {
      const base = (opts.name || "otto").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "otto";
      m = await boxd.machines.create({ name: `${base}-${Math.random().toString(36).slice(2, 7)}`, config: { vcpu: opts.vcpu } });
      checkpoint.sandboxId = m.id;
      onCheckpoint({ ...checkpoint });
    }
    m = await wake(boxd, m, signal, (d) => report({ step: "machine", state: "active", detail: d }));
    await boxd.machines.setAutoHibernateTimeout(m.id, opts.hibernateAfter).catch(() => {});
    return m;
  });

  const version = await step("install", async () => {
    const r = await run(boxd, machine.id, installScript(), 600, signal);
    return r.stdout.trim().split("\n").pop()?.replace(/^opencode\s+/, "");
  });

  await step("server", async () => {
    const r = await run(boxd, machine.id, serviceScript(checkpoint.password), 180, signal);
    if (!r.stdout.includes("OTTO_READY")) throw new BoxdError(lastLines(r.stdout + "\n" + r.stderr) || "The agent server didn't start.");
  });

  const endpoint: ServerEndpoint = await step("tunnel", async () => ({ baseUrl: await ensureProxy(boxd, machine), password: checkpoint.password }));

  await step("hello", async () => {
    const oc = new OpenCode(endpoint);
    let lastErr: unknown;
    // DNS for a new subdomain proxy takes a few seconds.
    for (let i = 0; i < 30; i++) {
      abortIf(signal);
      try {
        await oc.info(signal);
        return;
      } catch (e) {
        lastErr = e;
        await sleep(2000);
      }
    }
    throw lastErr instanceof Error ? lastErr : new BoxdError("Couldn't reach the agent server over HTTPS.");
  });

  return { sandboxId: machine.id, endpoint, version };
}

/** Bring a boxd workspace back: wake the machine, repair the service if needed, refresh the URL. */
export async function reviveBoxd(
  apiKey: string,
  machineId: string,
  password: string,
  report: (phase: "waking" | "repairing", detail?: string) => void,
  signal: AbortSignal,
): Promise<ServerEndpoint> {
  const boxd = boxdClient(apiKey);
  try {
    let m = await boxd.machines.get(machineId);
    if (m.status !== "running") {
      report("waking", "Waking your machine");
      m = await wake(boxd, m, signal, (d) => report("waking", d));
    }
    report("repairing", "Checking the agent server");
    const ok = await run(boxd, m.id, healthScript(password), 60, signal).catch(() => null);
    if (!ok?.stdout.includes("OTTO_READY")) {
      report("repairing", "Restarting the agent server");
      await run(boxd, m.id, installScript(), 600, signal);
      const r = await run(boxd, m.id, serviceScript(password), 180, signal);
      if (!r.stdout.includes("OTTO_READY")) throw new BoxdError("The agent server didn't come back up.");
    }
    return { baseUrl: await ensureProxy(boxd, m), password };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    throw humanizeBoxd(e);
  }
}

/** Sleep / wake from Settings. */
export async function boxdMachine(apiKey: string, id: string) {
  return boxdClient(apiKey).machines.get(id);
}
export async function boxdHibernate(apiKey: string, id: string) {
  await boxdClient(apiKey).machines.hibernate(id);
}
export async function boxdWake(apiKey: string, id: string) {
  await boxdClient(apiKey).machines.wake(id);
}
