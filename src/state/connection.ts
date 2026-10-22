/**
 * Live connection to the active workspace's OpenCode server.
 * Owns: health check, waking a sleeping sandbox, the event stream.
 */
import { create } from "zustand";
import { OpenCode, OpenCodeError, type ServerInfo } from "../lib/opencode/client";
import { startEventStream, type StreamStatus } from "../lib/opencode/events";
import { waitForCatalog, type CatalogResult } from "../lib/opencode/readiness";
import { useShells } from "./shells";
import "./connectors";
import { reviveBoat } from "../lib/providers/provision";
import { ensureBrowserKit } from "../lib/providers/boatBrowser";
import { BoxdError, reviveBoxd } from "../lib/providers/boxd";
import { E2BError, keepE2BAwake, reviveE2B } from "../lib/providers/e2b";
import { DAYTONA_EXTRA_HEADERS, DAYTONA_PREVIEW_HEADER, DaytonaError, keepDaytonaAwake, reviveDaytona } from "../lib/providers/daytona";
import { PROVIDER_NAME } from "../lib/providers/names";
import { reviveLocal } from "../lib/providers/local";
import { BoatError, isBillingError } from "../lib/providers/boat";
import { secrets } from "../lib/secrets";
import { isCloud, secretKeys, useWorkspaces, type Workspace } from "./workspaces";
import { useChat } from "./chat";

export type ConnStatus = "idle" | "connecting" | "waking" | "repairing" | "ready" | "error";
/** How far the server's model/agent catalog has got. `status` stays the connection's own story. */
export type CatalogStatus = "offline" | "warming" | "ready" | "degraded";

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
  /** Models and agents: the server can accept HTTP before it can answer a prompt. */
  catalog: CatalogStatus;
  /** One quiet sentence for why the catalog didn't load. Never toasted. */
  catalogError?: string;
  connect(ws: Workspace, opts?: { forceRevive?: boolean }): Promise<void>;
  disconnect(): void;
  retry(): void;
  /** Back in the foreground or online: reconnect now; `force` replaces a connection that still looks live. */
  wake(force?: boolean): void;
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
  catalog: "offline",

  async connect(ws, opts) {
    // Stops any previous connection and invalidates work still in flight for it.
    get().disconnect();
    const gen = ++generation;
    abort = new AbortController();
    const signal = abort.signal;
    set({ status: "connecting", detail: undefined, error: undefined, billing: false, workspaceId: ws.id, client: null, info: null, catalog: "offline", catalogError: undefined });
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

      if (!info && ws.provider === "local") {
        // Not running (or something else took its port): start it again.
        const endpoint = await reviveLocal(ws.baseUrl, password, (phase, detail) => !stale() && set({ status: phase, detail }), signal);
        if (stale()) return;
        if (endpoint.baseUrl !== ws.baseUrl) await useWorkspaces.getState().update(ws.id, { baseUrl: endpoint.baseUrl });
        client = new OpenCode(endpoint);
        info = await withTimeout(client.info(signal), 8000).catch(() => null);
      }

      if (!info && isCloud(ws.provider) && ws.sandboxId) {
        const provider = ws.provider;
        const apiKey = await secrets.get(secretKeys[provider]);
        if (!apiKey) throw new Error(`Add your ${PROVIDER_NAME[provider]} API key in Settings → Workspaces to wake this machine.`);
        const progress = (phase: "waking" | "repairing", detail?: string) => !stale() && set({ status: phase, detail });
        const id = ws.sandboxId;
        const endpoint =
          provider === "boxd"
            ? await reviveBoxd(apiKey, id, password, progress, signal)
            : provider === "e2b"
              ? await reviveE2B(apiKey, id, password, ws.sleepAfter ?? E2B_DEFAULT_SLEEP, progress, signal)
              : provider === "daytona"
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
      if (!info || !client) throw new Error(ws.provider === "custom" ? `Can't reach this server. Is it running and reachable?${lastError ? ` (${lastError})` : ""}` : "Can't reach your agent server.");

      // `info` only proves the listener is up. On a cold start the Location and
      // its plugins may still be activating; live events are already flowing
      // but the catalog is empty and a prompt would fail. Wait for the catalog
      // before calling this connection ready. `catalog` carries the nuance to
      // the UI: a degraded catalog leaves chat readable but send paused.
      set({ status: "connecting", detail: "Starting OpenCode…", catalog: "warming", catalogError: undefined });
      let sawReply = false;
      const catalog = await waitForCatalog(client, {
        signal,
        onPhase: (phase, info) => {
          if (stale()) return;
          if (info.responded) sawReply = true;
          if (phase === "warming") set({ detail: sawReply ? "Loading models and agents…" : "Starting OpenCode…" });
        },
      });
      if (stale()) return;
      if (catalog.phase === "aborted") return;
      set({
        client,
        info,
        status: "ready",
        detail: undefined,
        catalog: catalog.phase === "ready" ? "ready" : "degraded",
        catalogError: catalog.phase === "ready" ? undefined : catalogProblem(catalog),
      });
      // Boat machines get the agent's browser; older setups pick it up here.
      if (ws.provider === "boat") void ensureBrowserKit(client).catch((e) => console.warn("browser kit:", e));
      keepAwake?.();
      keepAwake = null;
      if ((ws.provider === "e2b" || ws.provider === "daytona") && ws.sandboxId) {
        const key = await secrets.get(secretKeys[ws.provider]);
        if (key && !stale()) keepAwake = ws.provider === "e2b" ? keepE2BAwake(key, ws.sandboxId, ws.sleepAfter ?? E2B_DEFAULT_SLEEP) : keepDaytonaAwake(key, ws.sandboxId);
      }
      // Reading the secret above can outlast a workspace switch: don't reset
      // and bootstrap the chat for a connection that is no longer current.
      if (stale()) return;
      if (info.version && info.version !== ws.version) void useWorkspaces.getState().update(ws.id, { version: info.version });

      const chat = useChat.getState();
      chat.reset();
      // The first stream connect can fire while this is still running: chain
      // its quiet sync instead of resyncing underneath the bootstrap.
      const booted = chat.bootstrap(client).catch(() => {});

      stream = startEventStream(client, {
        onEvent: (e) => {
          if (e.type.startsWith("shell.")) useShells.getState().ingest(e);
          useChat.getState().ingest(e);
        },
        onStatus: (s) => !stale() && set({ stream: s }),
        onConnected: (reconnect) => {
          if (reconnect) void useChat.getState().resync();
          else
            void booted.then(() => {
              if (stale() || useChat.getState().client !== client) return;
              void useChat.getState().syncOnConnect();
            });
          void useShells.getState().load();
        },
      });
    } catch (e) {
      if (stale() || (e as Error)?.name === "AbortError") return;
      const msg = e instanceof BoatError || e instanceof Error ? e.message : String(e);
      set({ status: "error", error: msg, billing: isBillingError(e) || ((e instanceof BoxdError || e instanceof E2BError || e instanceof DaytonaError) && e.billing), detail: undefined });
    }
  },

  disconnect() {
    // Invalidate a connect still in flight: it must not publish a client or
    // bootstrap chats for a workspace that is gone or no longer active.
    generation++;
    stream?.stop();
    stream = null;
    keepAwake?.();
    keepAwake = null;
    abort?.abort();
    abort = null;
    set({ status: "idle", detail: undefined, error: undefined, billing: false, stream: "offline", client: null, info: null, workspaceId: null, catalog: "offline", catalogError: undefined });
  },

  retry() {
    const st = useWorkspaces.getState();
    // After a disconnect workspaceId is cleared; the active workspace is the
    // one to bring back (e.g. after waking a sleeping machine).
    const ws = st.workspaces.find((w) => w.id === get().workspaceId) ?? st.workspaces.find((w) => w.id === st.activeId);
    if (ws) void get().connect(ws);
  },

  wake(force) {
    if (get().status === "ready") stream?.retryNow(force);
    else if (get().status === "error") get().retry();
  },
}));

/** One quiet sentence for the store; the UI shows it, nothing toasts it. */
function catalogProblem(catalog: CatalogResult): string {
  if (catalog.reason === "auth") return "The agent server refused to load its models and agents.";
  if (catalog.reason === "fatal") return "The agent server can't load its models and agents.";
  return "OpenCode is taking longer than usual to load models and agents.";
}

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
