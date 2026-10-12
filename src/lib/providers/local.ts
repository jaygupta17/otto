/**
 * "This computer": OpenCode v2 running on the same machine as Otto.
 *
 *   find an OpenCode v2 install (or download one into Otto's data folder)
 *   → start `opencode serve` on 127.0.0.1 with a random password → say hello
 *
 * The heavy lifting is in src-tauri/src/local.rs. The server is detached, so
 * agents keep working after Otto quits; reconnecting restarts it if needed.
 */
import { OpenCode, type ServerEndpoint } from "../opencode/client";
import { isTauri, osName } from "../platform";
import type { SetupStepId, StepUpdate } from "./provision";

export const LOCAL_SETUP_STEPS: { id: SetupStepId; title: string; hint: string }[] = [
  { id: "install", title: "Finding OpenCode v2", hint: "Installs it if this computer doesn't have it" },
  { id: "server", title: "Starting the agent server", hint: "On this computer, private to it" },
  { id: "hello", title: "Saying hello", hint: "First handshake with your agent" },
];

interface Found {
  path: string;
  version: string;
  managed: boolean;
}

/** Only desktops can run the agent next to the app. */
export function localAvailable() {
  return isTauri && ["macos", "windows", "linux"].includes(osName());
}

export function localName() {
  const os = osName();
  return os === "macos" ? "This Mac" : os === "windows" ? "This PC" : "This computer";
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : (e as Error).message);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const portOf = (baseUrl: string) => Number(new URL(baseUrl).port) || undefined;

/** An OpenCode v2 binary: the user's own if they have one, else Otto's copy. */
async function ensureOpenCode(onDetail?: (d: string) => void): Promise<Found> {
  const found = await call<Found | null>("local_find_opencode");
  if (found) {
    onDetail?.(`Using v${found.version}${found.managed ? "" : ` at ${found.path.replace(/^\/Users\/[^/]+|^\/home\/[^/]+/, "~")}`}`);
    return found;
  }
  onDetail?.("Not installed yet. Downloading v2");
  return call<Found>("local_install_opencode");
}

/** Start the server and wait until it answers with our password. */
async function startServer(bin: string, preferredPort: number | undefined, password: string, signal: AbortSignal): Promise<ServerEndpoint> {
  const port = await call<number>("local_free_port", { preferred: preferredPort ?? null });
  await call<number>("local_start_server", { bin, port, password });
  const endpoint: ServerEndpoint = { baseUrl: `http://127.0.0.1:${port}`, password };
  const oc = new OpenCode(endpoint);
  for (let i = 0; i < 60; i++) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (await oc.info(signal).then(() => true, () => false)) return endpoint;
    await sleep(500);
  }
  const log = await call<string>("local_server_log", { port }).catch(() => "");
  // "server listening on …" in the log means it did start and simply never
  // answered, which is what an OpenCode too old to have /api/info looks like.
  throw new Error(
    log.includes("server listening")
      ? "The agent server started but never answered. That OpenCode build is too old for Otto — it needs 2.0.26 or newer."
      : log || "The agent server didn't start.",
  );
}

export async function provisionLocal(password: string, report: (u: StepUpdate) => void, signal: AbortSignal): Promise<{ endpoint: ServerEndpoint; version: string }> {
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
  const oc = await step("install", () => ensureOpenCode((detail) => report({ step: "install", state: "active", detail })));
  const endpoint = await step("server", () => startServer(oc.path, undefined, password, signal));
  const info = await step("hello", () => new OpenCode(endpoint).info(signal));
  return { endpoint, version: info.version ?? oc.version };
}

/** Bring a local workspace back after a restart or a crash. Keeps its port when it's free. */
export async function reviveLocal(baseUrl: string, password: string, report: (phase: "waking" | "repairing", detail?: string) => void, signal: AbortSignal): Promise<ServerEndpoint> {
  report("waking", "Starting OpenCode on this computer");
  const oc = await ensureOpenCode((d) => report("repairing", d));
  return startServer(oc.path, portOf(baseUrl), password, signal);
}

/** Stop the server Otto started for this workspace. */
export async function stopLocal(baseUrl: string) {
  const port = portOf(baseUrl);
  if (port) await call("local_stop_server", { port }).catch(() => {});
}
