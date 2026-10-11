/**
 * Live connection to the active workspace's OpenCode server.
 * Owns: health check, waking a sleeping sandbox, the event stream.
 */
import { create } from "zustand";
import { OpenCode, OpenCodeError, type ServerInfo } from "../lib/opencode/client";
import { startEventStream, type StreamStatus } from "../lib/opencode/events";
import { reviveBoat } from "../lib/providers/provision";
import { BoxdError, reviveBoxd } from "../lib/providers/boxd";
import { E2BError, keepE2BAwake, reviveE2B } from "../lib/providers/e2b";
import { DAYTONA_EXTRA_HEADERS, DAYTONA_PREVIEW_HEADER, DaytonaError, keepDaytonaAwake, reviveDaytona } from "../lib/providers/daytona";
import { PROVIDER_NAME } from "../lib/providers/names";
import { BoatError, isBillingError } from "../lib/providers/boat";
import { secrets } from "../lib/secrets";
import { secretKeys, useWorkspaces, type Workspace } from "./workspaces";
import { useChat } from "./chat";

export type ConnStatus = "idle" | "connecting" | "waking" | "repairing" | "ready" | "error";

interface State {
  status: ConnStatus;
  detail?: string;
  error?: string;
  /** The error can only be fixed in the provider's billing page. */
  billing?: boolean;
  stream: StreamStatus;
  client: OpenCode | null;
  info: ServerInfo | null;
  workspaceId: string | null;
  connect(ws: Workspace, opts?: { forceRevive?: boolean }): Promise<void>;
  disconnect(): void;
  retry(): void;
  wake(): void;
}

let stream: ReturnType<typeof startEventStream> | null = null;
/** Stops the provider keep-awake timer (E2B timeout / Daytona activity). */
let keepAwake: (() => void) | null = null;

/** Provider-specific transport details for a workspace's OpenCode URL. */
function endpointExtras(ws: Workspace) {
  return ws.provider === "daytona" ? { gateHeader: DAYTONA_PREVIEW_HEADER, extraHeaders: DAYTONA_EXTRA_HEADERS } : {};
}
const E2B_DEFAULT_SLEEP = 1800;
let abort: AbortController | null = null;
let generation = 0;

export const useConnection = create<State>((set, get) => ({
  status: "idle",
  stream: "offline",
  client: null,
  info: null,
  workspaceId: null,

  async connect(ws, opts) {
    const gen = ++generation;
    get().disconnect();
    abort = new AbortController();
    const signal = abort.signal;
    set({ status: "connecting", detail: undefined, error: undefined, billing: false, workspaceId: ws.id, client: null, info: null });
    const stale = () => gen !== generation;

    try {
      const password = (await secrets.get(secretKeys.password(ws.id))) ?? "";
      const gateToken = (await secrets.get(secretKeys.gate(ws.id))) ?? undefined;
      let client = new OpenCode({ baseUrl: ws.baseUrl, password, gateToken, ...endpointExtras(ws) });
      let info: ServerInfo | null = null;
      let lastError = "";

      if (!opts?.forceRevive) {
        info = await withTimeout(client.info(signal), 8000).catch((e) => {
          // On a provider machine a 401 usually means the proxy token went stale (Daytona rotates it on restart): revive refreshes it.
          if (e instanceof OpenCodeError && e.status === 401 && ws.provider === "custom") throw new Error("The agent server rejected our password.");
          lastError = e instanceof Error ? e.message : String(e);
          return null;
        });
      }

      if (!info && ws.provider !== "custom" && ws.sandboxId) {
        const apiKey = await secrets.get(secretKeys[ws.provider]);
        if (!apiKey) throw new Error(`Add your ${PROVIDER_NAME[ws.provider]} API key in Settings → Workspaces to wake this machine.`);
        const progress = (phase: "waking" | "repairing", detail?: string) => !stale() && set({ status: phase, detail });
        const id = ws.sandboxId;
        const endpoint =
          ws.provider === "boxd"
            ? await reviveBoxd(apiKey, id, password, progress, signal)
            : ws.provider === "e2b"
              ? await reviveE2B(apiKey, id, password, ws.sleepAfter ?? E2B_DEFAULT_SLEEP, progress, signal)
              : ws.provider === "daytona"
                ? await reviveDaytona(apiKey, id, password, progress, signal)
                : await reviveBoat(apiKey, id, password, progress, signal);
        if (stale()) return;
        if (endpoint.baseUrl !== ws.baseUrl || endpoint.gateToken !== gateToken) {
          await useWorkspaces.getState().update(ws.id, { baseUrl: endpoint.baseUrl }, { gateToken: endpoint.gateToken ?? null });
        }
        client = new OpenCode(endpoint);
        set({ status: "connecting", detail: "Saying hello" });
        for (let i = 0; i < 15 && !info; i++) {
          info = await withTimeout(client.info(signal), 8000).catch(() => null);
          if (!info) await new Promise((r) => setTimeout(r, 1500));
        }
      }

      if (stale()) return;
      if (!info) throw new Error(ws.provider === "custom" ? `Can't reach this server. Is it running and reachable?${lastError ? ` (${lastError})` : ""}` : "Can't reach your agent server.");

      set({ client, info, status: "ready", detail: undefined });
      keepAwake?.();
      keepAwake = null;
      if ((ws.provider === "e2b" || ws.provider === "daytona") && ws.sandboxId) {
        const key = await secrets.get(secretKeys[ws.provider]);
        if (key && !stale()) keepAwake = ws.provider === "e2b" ? keepE2BAwake(key, ws.sandboxId, ws.sleepAfter ?? E2B_DEFAULT_SLEEP) : keepDaytonaAwake(key, ws.sandboxId);
      }
      if (info.version && info.version !== ws.version) void useWorkspaces.getState().update(ws.id, { version: info.version });

      const chat = useChat.getState();
      chat.reset();
      void chat.bootstrap(client);

      stream = startEventStream(client, {
        onEvent: (e) => useChat.getState().ingest(e),
        onStatus: (s) => !stale() && set({ stream: s }),
        onConnected: (reconnect) => {
          if (reconnect) void useChat.getState().resync();
        },
      });
    } catch (e) {
      if (stale() || (e as Error)?.name === "AbortError") return;
      const msg = e instanceof BoatError || e instanceof Error ? e.message : String(e);
      set({ status: "error", error: msg, billing: isBillingError(e) || ((e instanceof BoxdError || e instanceof E2BError || e instanceof DaytonaError) && e.billing), detail: undefined });
    }
  },

  disconnect() {
    stream?.stop();
    stream = null;
    keepAwake?.();
    keepAwake = null;
    abort?.abort();
    abort = null;
    set({ stream: "offline" });
  },

  retry() {
    const ws = useWorkspaces.getState().workspaces.find((w) => w.id === get().workspaceId);
    if (ws) void get().connect(ws);
  },

  wake() {
    if (get().status === "ready") stream?.retryNow();
    else if (get().status === "error") get().retry();
  },
}));

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Stores hold live connections; a hot swap would orphan them. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
