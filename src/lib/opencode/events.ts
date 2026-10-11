/**
 * Live OpenCode event stream (`GET /api/event`, Server-Sent Events).
 *
 * - Runs over our HTTP layer so it works through Tauri + the sandbox proxy.
 * - Reconnects with backoff; reports status so the UI can show it.
 * - A watchdog drops the connection when the server's heartbeats stop
 *   (proxies sometimes keep a dead socket open forever).
 */
import type { V2Event } from "@opencode/client";
import { httpFetch } from "../platform";
import type { OpenCode } from "./client";

export type { V2Event };
export type StreamStatus = "connecting" | "live" | "reconnecting" | "offline";

interface Options {
  onEvent: (e: V2Event) => void;
  onStatus: (s: StreamStatus, info?: { attempt: number; error?: string }) => void;
  /** Called after every (re)connect so callers can resync authoritative state. */
  onConnected?: (reconnect: boolean) => void;
}

const HEARTBEAT_TIMEOUT_MS = 45_000;

export function startEventStream(client: OpenCode, opts: Options) {
  let stopped = false;
  let controller: AbortController | null = null;
  let attempt = 0;
  let everConnected = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;

  const kick = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => controller?.abort(), HEARTBEAT_TIMEOUT_MS);
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(t);
        resolve();
      };
    });

  async function loop() {
    while (!stopped) {
      controller = new AbortController();
      opts.onStatus(everConnected ? "reconnecting" : "connecting", { attempt });
      try {
        const res = await httpFetch(client.url("/api/event"), {
          headers: client.headers({ Accept: "text/event-stream", "Cache-Control": "no-cache" }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
        kick();
        const reconnect = everConnected;
        everConnected = true;
        attempt = 0;
        opts.onStatus("live", { attempt });
        opts.onConnected?.(reconnect);
        await readSse(res.body, (data) => {
          kick();
          if (!data) return;
          try {
            opts.onEvent(JSON.parse(data) as V2Event);
          } catch {
            // ignore malformed frames
          }
        }, kick);
        if (stopped) break;
        throw new Error("stream closed");
      } catch (e) {
        if (stopped) break;
        attempt += 1;
        const msg = e instanceof Error ? e.message : String(e);
        opts.onStatus(attempt >= 4 ? "offline" : "reconnecting", { attempt, error: msg });
        const delay = Math.min(15_000, 600 * 2 ** Math.min(attempt, 5)) * (0.8 + Math.random() * 0.4);
        await sleep(delay);
      } finally {
        if (watchdog) clearTimeout(watchdog);
      }
    }
  }

  void loop();

  return {
    stop() {
      stopped = true;
      controller?.abort();
      wake?.();
    },
    /** Skip the backoff and reconnect right now (e.g. app came to foreground). */
    retryNow() {
      if (attempt > 0) wake?.();
    },
  };
}

async function readSse(body: ReadableStream<Uint8Array>, onData: (data: string) => void, onActivity: () => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let dataLines: string[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    onActivity();
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) >= 0) {
      let line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line === "") {
        if (dataLines.length) onData(dataLines.join("\n"));
        dataLines = [];
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(line.charCodeAt(5) === 32 ? 6 : 5));
      }
      // ignore "event:", "id:", and ":" comments (heartbeats) — activity is enough
    }
  }
}

// Stores hold live connections; a hot swap would orphan them. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
