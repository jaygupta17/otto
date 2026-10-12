/**
 * Daytona (https://daytona.io) provider: isolated sandboxes with REST control.
 *
 *   - control plane: https://app.daytona.io/api, `Authorization: Bearer <key>`
 *   - commands: the sandbox toolbox, `POST {toolboxProxyUrl}/{id}/process/execute`
 *   - HTTPS: preview URL `https://4096-<id>.<proxy>`; private, so every request
 *     carries the preview token in `x-daytona-preview-token`. The token changes
 *     when a stopped sandbox starts again, so revive refreshes it.
 *
 * Container sandboxes have no systemd: OpenCode runs under `daemonScript`, and
 * a stopped sandbox loses its processes, so revive restarts the server.
 */
import { httpFetch } from "../platform";
import { OpenCode, type ServerEndpoint } from "../opencode/client";
import { OPENCODE_PORT, daemonScript, healthScript, installScript, wrapScript } from "./boat";
import type { ProvisionCheckpoint, ProvisionResult, SetupStepId, StepUpdate } from "./provision";

const API = "https://app.daytona.io/api";
export const DAYTONA_KEYS_URL = "https://app.daytona.io/dashboard/keys";
export const DAYTONA_BILLING_URL = "https://app.daytona.io/dashboard/billing";
export const DAYTONA_PREVIEW_HEADER = "x-daytona-preview-token";
/** Skips the browser warning page Daytona puts in front of previews. */
export const DAYTONA_EXTRA_HEADERS = { "X-Daytona-Skip-Preview-Warning": "true" };

export const DAYTONA_SIZES = [
  { id: "daytona-small", label: "Small", spec: "1 vCPU · 1 GB" },
  { id: "daytona-medium", label: "Standard", spec: "2 vCPU · 4 GB" },
  { id: "daytona-large", label: "Large", spec: "4 vCPU · 8 GB" },
];
/** Auto-stop after this many minutes without traffic (0 = never). */
export const DAYTONA_SLEEP = [
  { id: 15, label: "15 min" },
  { id: 60, label: "1 hour" },
  { id: 240, label: "4 hours" },
  { id: 0, label: "Never" },
];

export class DaytonaError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly billing = false,
  ) {
    super(message);
  }
}

interface Sandbox {
  id: string;
  name?: string;
  state: string;
  errorReason?: string | null;
  toolboxProxyUrl?: string;
  public?: boolean;
}

export const RUNNING = ["started"];
const BOOTING = ["creating", "starting", "restoring", "pulling_snapshot", "pending_build", "building_snapshot", "resuming"];

export class DaytonaClient {
  constructor(private readonly apiKey: string) {}

  private async call<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await httpFetch(url.startsWith("http") ? url : API + url, {
        method,
        signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      throw new DaytonaError(0, "Can't reach Daytona. Check your connection.");
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const m = (json as { message?: string | string[] })?.message;
      throw humanize(res.status, Array.isArray(m) ? m.join("; ") : (m ?? text));
    }
    return json as T;
  }

  verify() {
    return this.call<unknown>("GET", "/api-keys/current");
  }
  create(opts: { snapshot: string; autoStop: number; name: string }, signal?: AbortSignal) {
    return this.call<Sandbox>("POST", "/sandbox", { name: opts.name, snapshot: opts.snapshot, autoStopInterval: opts.autoStop, public: false, labels: { app: "otto" } }, signal);
  }
  get(id: string, signal?: AbortSignal) {
    return this.call<Sandbox>("GET", `/sandbox/${id}`, undefined, signal);
  }
  /** Sandboxes on this key, filtered to what Otto creates (labels: { app: "otto" }). */
  list() {
    return this.call<{ items?: Sandbox[] } | Sandbox[]>("GET", "/sandbox?limit=100&labels=" + encodeURIComponent(JSON.stringify({ app: "otto" }))).then((r) =>
      Array.isArray(r) ? r : (r.items ?? []),
    );
  }
  start(id: string) {
    return this.call<unknown>("POST", `/sandbox/${id}/start`);
  }
  stop(id: string) {
    return this.call<unknown>("POST", `/sandbox/${id}/stop`);
  }
  touch(id: string) {
    return this.call<unknown>("POST", `/sandbox/${id}/last-activity`);
  }
  preview(id: string, port = OPENCODE_PORT) {
    return this.call<{ url: string; token?: string }>("GET", `/sandbox/${id}/ports/${port}/preview-url`);
  }
  async exec(sb: Sandbox, script: string, timeoutSeconds: number, signal?: AbortSignal) {
    const base = (sb.toolboxProxyUrl || "https://proxy.app.daytona.io/toolbox").replace(/\/$/, "");
    const r = await this.call<{ exitCode: number; result: string }>("POST", `${base}/${sb.id}/process/execute`, { command: `bash -c "${wrapScript(script)}"`, timeout: timeoutSeconds }, signal);
    return { exitCode: r.exitCode, stdout: r.result ?? "" };
  }
}

function humanize(status: number, message: string): DaytonaError {
  if (status === 401 || status === 403) return new DaytonaError(status, "That API key wasn't accepted. Create one in the Daytona dashboard under Keys.");
  if (status === 402 || /credit|billing|payment|quota|limit|insufficient/i.test(message)) return new DaytonaError(status, `Daytona: ${message || "your account can't start another sandbox"}`, true);
  if (status === 429) return new DaytonaError(status, "Daytona is rate-limiting this key. Wait a moment, then retry.");
  if (status === 404) return new DaytonaError(status, "This sandbox no longer exists on Daytona.");
  return new DaytonaError(status, message || `Daytona request failed (${status}).`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const abortIf = (s: AbortSignal) => {
  if (s.aborted) throw new DOMException("Cancelled", "AbortError");
};
const tail = (s: string, n = 6) => s.trim().split("\n").filter(Boolean).slice(-n).join("\n");

export async function waitRunning(day: DaytonaClient, id: string, signal: AbortSignal, onDetail: (d: string) => void): Promise<Sandbox> {
  const started = Date.now();
  for (;;) {
    abortIf(signal);
    const sb = await day.get(id, signal);
    if (RUNNING.includes(sb.state)) return sb;
    if (sb.state === "error" || sb.state === "build_failed" || sb.state === "destroyed") throw new DaytonaError(500, sb.errorReason || "The sandbox failed to start.");
    if (["stopped", "archived", "paused"].includes(sb.state)) await day.start(id).catch(() => {});
    onDetail(BOOTING.includes(sb.state) ? `State: ${sb.state.replace(/_/g, " ")}` : `State: ${sb.state}`);
    if (Date.now() - started > 6 * 60_000) throw new DaytonaError(504, "The sandbox is taking unusually long to start.");
    await sleep(1500);
  }
}

async function run(day: DaytonaClient, sb: Sandbox, script: string, timeout: number, signal: AbortSignal) {
  for (let i = 0; ; i++) {
    abortIf(signal);
    try {
      const r = await day.exec(sb, script, timeout, signal);
      if (r.exitCode !== 0) throw new DaytonaError(500, tail(r.stdout) || `Command failed (exit ${r.exitCode})`);
      return r;
    } catch (e) {
      const transient = e instanceof DaytonaError && (e.status === 502 || e.status === 503 || e.status === 0);
      if (!transient || i >= 10) throw e;
      await sleep(2000);
    }
  }
}

async function endpointFor(day: DaytonaClient, id: string, password: string): Promise<ServerEndpoint> {
  const p = await day.preview(id);
  return { baseUrl: p.url.replace(/\/$/, ""), password, gateToken: p.token, gateHeader: DAYTONA_PREVIEW_HEADER, extraHeaders: DAYTONA_EXTRA_HEADERS };
}

export async function provisionDaytona(
  apiKey: string,
  checkpoint: ProvisionCheckpoint,
  opts: { snapshot: string; autoStop: number; name?: string },
  report: (u: StepUpdate) => void,
  signal: AbortSignal,
  onCheckpoint: (c: ProvisionCheckpoint) => void,
): Promise<ProvisionResult> {
  const day = new DaytonaClient(apiKey);
  const step = async <T>(id: SetupStepId, fn: () => Promise<T>): Promise<T> => {
    abortIf(signal);
    report({ step: id, state: "active" });
    try {
      const v = await fn();
      report({ step: id, state: "done" });
      return v;
    } catch (e) {
      report({ step: id, state: "error", detail: (e as Error).message });
      throw e;
    }
  };

  await step("verify", () => day.verify());

  const sb = await step("machine", async () => {
    let id = checkpoint.sandboxId;
    if (id) {
      const existing = await day.get(id, signal).catch(() => null);
      if (!existing || existing.state === "destroyed" || existing.state === "error") id = undefined;
    }
    if (!id) {
      const base = (opts.name || "otto").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || "otto";
      const made = await day.create({ snapshot: opts.snapshot, autoStop: opts.autoStop, name: `${base}-${Math.random().toString(36).slice(2, 7)}` }, signal);
      id = made.id;
      checkpoint.sandboxId = id;
      onCheckpoint({ ...checkpoint });
    }
    return waitRunning(day, id, signal, (d) => report({ step: "machine", state: "active", detail: d }));
  });

  const version = await step("install", async () => {
    const r = await run(day, sb, installScript(), 600, signal);
    return r.stdout.trim().split("\n").pop()?.replace(/^opencode\s+/, "");
  });

  await step("server", async () => {
    const r = await run(day, sb, daemonScript(checkpoint.password), 180, signal);
    if (!r.stdout.includes("OTTO_READY")) throw new DaytonaError(500, tail(r.stdout) || "The agent server didn't start.");
  });

  const endpoint = await step("tunnel", () => endpointFor(day, sb.id, checkpoint.password));

  await step("hello", async () => {
    const oc = new OpenCode(endpoint);
    let last: unknown;
    for (let i = 0; i < 20; i++) {
      abortIf(signal);
      try {
        await oc.info(signal);
        return;
      } catch (e) {
        last = e;
        await sleep(1500);
      }
    }
    throw last instanceof Error ? last : new DaytonaError(0, "Couldn't reach the agent server over HTTPS.");
  });

  return { sandboxId: sb.id, endpoint, version };
}

/** Start a stopped sandbox, restart OpenCode (processes don't survive a stop), refresh the preview token. */
export async function reviveDaytona(apiKey: string, id: string, password: string, report: (phase: "waking" | "repairing", detail?: string) => void, signal: AbortSignal): Promise<ServerEndpoint> {
  const day = new DaytonaClient(apiKey);
  let sb = await day.get(id, signal);
  if (!RUNNING.includes(sb.state)) {
    report("waking", "Starting your sandbox");
    if (["stopped", "archived", "paused"].includes(sb.state)) await day.start(id);
    sb = await waitRunning(day, id, signal, (d) => report("waking", d));
  }
  report("repairing", "Checking the agent server");
  const ok = await run(day, sb, healthScript(password), 60, signal).catch(() => null);
  if (!ok?.stdout.includes("OTTO_READY")) {
    report("repairing", "Starting the agent server");
    await run(day, sb, installScript(), 600, signal);
    const r = await run(day, sb, daemonScript(password), 180, signal);
    if (!r.stdout.includes("OTTO_READY")) throw new DaytonaError(500, "The agent server didn't come back up.");
  }
  return endpointFor(day, id, password);
}

/**
 * A long-lived event stream may not count as activity for auto-stop, so while
 * the app is connected, tell Daytona the sandbox is in use.
 */
export function keepDaytonaAwake(apiKey: string, id: string) {
  const day = new DaytonaClient(apiKey);
  const tick = () => void day.touch(id).catch(() => {});
  tick();
  const h = setInterval(tick, 5 * 60_000);
  return () => clearInterval(h);
}
