/**
 * E2B (https://e2b.dev) provider: Firecracker microVMs with pause/resume.
 *
 * Talks to E2B directly instead of bundling the `e2b` SDK (its Node-only
 * dependencies don't belong in the app):
 *   - control plane: REST at api.e2b.app, `X-API-KEY` header
 *   - in-sandbox commands: envd's `process.Process/Start` over the Connect
 *     protocol (JSON, server-streaming) at https://49983-<id>.<domain>
 *
 * E2B sandboxes have no systemd, so OpenCode runs under `daemonScript`.
 * They pause on timeout (memory kept) and auto-resume on the next request.
 */
import { httpFetch } from "../platform";
import { OpenCode, type ServerEndpoint } from "../opencode/client";
import { OPENCODE_PORT, daemonScript, healthScript, installScript, wrapScript } from "./boat";
import type { ProvisionCheckpoint, ProvisionResult, SetupStepId, StepUpdate } from "./provision";

const API = "https://api.e2b.app";
const ENVD_PORT = 49983;
export const E2B_KEYS_URL = "https://e2b.dev/dashboard?tab=keys";
export const E2B_BILLING_URL = "https://e2b.dev/dashboard?tab=billing";

/** How long a sandbox runs without the app before pausing (memory and files are kept). */
export const E2B_SLEEP = [
  { id: 900, label: "15 min" },
  { id: 1800, label: "30 min" },
  { id: 3600, label: "1 hour" },
];

export class E2BError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly billing = false,
  ) {
    super(message);
  }
}

interface SandboxRef {
  sandboxID: string;
  domain?: string | null;
  envdAccessToken?: string | null;
  envdVersion?: string;
}
interface SandboxInfo extends SandboxRef {
  state: "running" | "paused" | string;
  endAt?: string;
}

export class E2BClient {
  constructor(private readonly apiKey: string) {}

  private async call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await httpFetch(API + path, {
        method,
        signal,
        headers: { "X-API-KEY": this.apiKey, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      throw new E2BError(0, "Can't reach E2B. Check your connection.");
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) throw humanize(res.status, (json as { message?: string })?.message ?? text);
    return json as T;
  }

  /** Cheap authenticated call to check the key. */
  async verify() {
    await this.call("GET", "/v2/sandboxes?limit=1");
  }

  create(opts: { timeout: number }, signal?: AbortSignal) {
    return this.call<SandboxRef>(
      "POST",
      "/v2/sandboxes",
      { templateID: "base", timeout: opts.timeout, autoPause: true, autoResume: { enabled: true }, metadata: { app: "otto" } },
      signal,
    );
  }
  get(id: string, signal?: AbortSignal) {
    return this.call<SandboxInfo>("GET", `/sandboxes/${id}`, undefined, signal);
  }
  /** Resume a paused sandbox (or just refresh a running one) and get fresh envd credentials. */
  connect(id: string, timeout: number, signal?: AbortSignal) {
    return this.call<SandboxRef>("POST", `/v2/sandboxes/${id}/connect`, { timeout }, signal);
  }
  setTimeout(id: string, timeout: number) {
    return this.call<void>("POST", `/sandboxes/${id}/timeout`, { timeout });
  }
  pause(id: string) {
    return this.call<void>("POST", `/sandboxes/${id}/pause`, {});
  }

  /** Run a bash script inside the sandbox; resolves with combined output and exit code. */
  async exec(ref: SandboxRef, script: string, timeoutSeconds: number, signal?: AbortSignal): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const domain = ref.domain || "e2b.app";
    const url = `https://${ENVD_PORT}-${ref.sandboxID}.${domain}/process.Process/Start`;
    const msg = JSON.stringify({ process: { cmd: "/bin/bash", args: ["-lc", wrapScript(script)], envs: {} } });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutSeconds * 1000);
    signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
    try {
      const res = await httpFetch(url, {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/connect+json",
          "Connect-Protocol-Version": "1",
          "Keepalive-Ping-Interval": "50",
          Authorization: `Basic ${btoa("user:")}`,
          "E2b-Sandbox-Id": ref.sandboxID,
          "E2b-Sandbox-Port": String(ENVD_PORT),
          ...(ref.envdAccessToken ? { "X-Access-Token": ref.envdAccessToken } : {}),
        },
        body: envelope(msg),
      });
      if (!res.ok || !res.body) throw new E2BError(res.status, `Couldn't run a command in the sandbox (${res.status}).`);
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      for await (const frame of frames(res.body)) {
        const data = frame.json as { event?: { data?: { stdout?: string; stderr?: string }; end?: { exitCode?: number; error?: string } }; error?: { message?: string } };
        if (frame.end) {
          if (data?.error) throw new E2BError(500, data.error.message ?? "The sandbox command failed.");
          break;
        }
        const ev = data?.event;
        if (ev?.data?.stdout) stdout += b64text(ev.data.stdout);
        if (ev?.data?.stderr) stderr += b64text(ev.data.stderr);
        if (ev?.end) exitCode = ev.end.exitCode ?? (ev.end.error ? 1 : 0);
      }
      return { exitCode: exitCode ?? 1, stdout, stderr };
    } catch (e) {
      if (ctrl.signal.aborted && !signal?.aborted) throw new E2BError(504, "A setup command took too long.");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** One Connect frame: 1 flag byte, 4-byte big-endian length, payload. */
function envelope(json: string) {
  const bytes = new TextEncoder().encode(json);
  const out = new Uint8Array(5 + bytes.length);
  new DataView(out.buffer).setUint32(1, bytes.length, false);
  out.set(bytes, 5);
  return out;
}

async function* frames(body: ReadableStream<Uint8Array>): AsyncGenerator<{ end: boolean; json: unknown }> {
  const reader = body.getReader();
  let buf = new Uint8Array(0);
  const dec = new TextDecoder();
  for (;;) {
    while (buf.length >= 5) {
      const len = new DataView(buf.buffer, buf.byteOffset).getUint32(1, false);
      if (buf.length < 5 + len) break;
      const flags = buf[0];
      const payload = buf.slice(5, 5 + len);
      buf = buf.slice(5 + len);
      let json: unknown;
      try {
        json = payload.length ? JSON.parse(dec.decode(payload)) : undefined;
      } catch {
        json = undefined;
      }
      yield { end: (flags & 0x02) !== 0, json };
    }
    const { value, done } = await reader.read();
    if (done) return;
    const next = new Uint8Array(buf.length + value.length);
    next.set(buf);
    next.set(value, buf.length);
    buf = next;
  }
}

function b64text(s: string) {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  } catch {
    return "";
  }
}

function humanize(status: number, message: string): E2BError {
  if (status === 401 || status === 403) return new E2BError(status, "That API key wasn't accepted. Copy it again from the E2B dashboard.");
  if (status === 402 || /credit|billing|payment|quota|limit/i.test(message)) return new E2BError(status, `E2B: ${message || "your plan can't start another sandbox"}`, true);
  if (status === 429) return new E2BError(status, "E2B is rate-limiting this key. Wait a moment, then retry.");
  if (status === 404) return new E2BError(status, "This sandbox no longer exists on E2B.");
  return new E2BError(status, message || `E2B request failed (${status}).`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const abortIf = (s: AbortSignal) => {
  if (s.aborted) throw new DOMException("Cancelled", "AbortError");
};
const tail = (s: string, n = 6) => s.trim().split("\n").filter(Boolean).slice(-n).join("\n");

function endpointFor(ref: SandboxRef, password: string): ServerEndpoint {
  return { baseUrl: `https://${OPENCODE_PORT}-${ref.sandboxID}.${ref.domain || "e2b.app"}`, password };
}

async function run(e2b: E2BClient, ref: SandboxRef, script: string, timeout: number, signal: AbortSignal) {
  for (let i = 0; ; i++) {
    abortIf(signal);
    try {
      const r = await e2b.exec(ref, script, timeout, signal);
      if (r.exitCode !== 0) throw new E2BError(500, tail(r.stdout + "\n" + r.stderr) || `Command failed (exit ${r.exitCode})`);
      return r;
    } catch (e) {
      // envd needs a moment after create/resume.
      const transient = e instanceof E2BError && (e.status === 502 || e.status === 503 || e.status === 0);
      if (!transient || i >= 10) throw e;
      await sleep(1500);
    }
  }
}

export async function provisionE2B(
  apiKey: string,
  checkpoint: ProvisionCheckpoint,
  opts: { timeout: number },
  report: (u: StepUpdate) => void,
  signal: AbortSignal,
  onCheckpoint: (c: ProvisionCheckpoint) => void,
): Promise<ProvisionResult> {
  const e2b = new E2BClient(apiKey);
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

  await step("verify", () => e2b.verify());

  const ref = await step("machine", async () => {
    if (checkpoint.sandboxId) {
      const again = await e2b.connect(checkpoint.sandboxId, opts.timeout, signal).catch(() => null);
      if (again) return again;
    }
    const made = await e2b.create(opts, signal);
    checkpoint.sandboxId = made.sandboxID;
    onCheckpoint({ ...checkpoint });
    return made;
  });

  const version = await step("install", async () => {
    const r = await run(e2b, ref, installScript(), 600, signal);
    return r.stdout.trim().split("\n").pop()?.replace(/^opencode\s+/, "");
  });

  await step("server", async () => {
    const r = await run(e2b, ref, daemonScript(checkpoint.password), 180, signal);
    if (!r.stdout.includes("OTTO_READY")) throw new E2BError(500, tail(r.stdout + "\n" + r.stderr) || "The agent server didn't start.");
  });

  const endpoint = await step("tunnel", async () => endpointFor(ref, checkpoint.password));

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
    throw last instanceof Error ? last : new E2BError(0, "Couldn't reach the agent server over HTTPS.");
  });

  return { sandboxId: ref.sandboxID, endpoint, version };
}

/** Resume a paused sandbox, repair the server if needed. */
export async function reviveE2B(apiKey: string, sandboxId: string, password: string, timeout: number, report: (phase: "waking" | "repairing", detail?: string) => void, signal: AbortSignal): Promise<ServerEndpoint> {
  const e2b = new E2BClient(apiKey);
  report("waking", "Resuming your sandbox");
  const ref = await e2b.connect(sandboxId, timeout, signal);
  report("repairing", "Checking the agent server");
  const ok = await run(e2b, ref, healthScript(password), 60, signal).catch(() => null);
  if (!ok?.stdout.includes("OTTO_READY")) {
    report("repairing", "Restarting the agent server");
    await run(e2b, ref, installScript(), 600, signal);
    const r = await run(e2b, ref, daemonScript(password), 180, signal);
    if (!r.stdout.includes("OTTO_READY")) throw new E2BError(500, "The agent server didn't come back up.");
  }
  return endpointFor(ref, password);
}

/** While the app is connected, keep pushing the pause deadline out. */
export function keepE2BAwake(apiKey: string, sandboxId: string, timeout: number) {
  const e2b = new E2BClient(apiKey);
  const tick = () => void e2b.setTimeout(sandboxId, timeout).catch(() => {});
  tick();
  const id = setInterval(tick, Math.max(60_000, (timeout * 1000) / 3));
  return () => clearInterval(id);
}
