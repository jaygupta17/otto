/**
 * A minimal WebSocket that can send custom headers.
 *
 * Inside Tauri it goes through the Rust client (`@tauri-apps/plugin-websocket`):
 * provider proxies like Daytona's want a token header, which a browser
 * WebSocket can't send, and it avoids mixed-content rules for plain `ws://`
 * servers. In a plain browser it falls back to `window.WebSocket` (headers
 * dropped).
 */
import { isTauri } from "./platform";

export interface Socket {
  send(data: string): void;
  close(): void;
}

export interface SocketHandlers {
  onText(text: string): void;
  /** Binary frames, decoded as UTF-8. */
  onBinary?(text: string): void;
  onClose(code: number, reason: string): void;
}

const decoder = new TextDecoder();

export async function openSocket(url: string, headers: Record<string, string>, h: SocketHandlers): Promise<Socket> {
  if (isTauri) {
    const { default: WS } = await import("@tauri-apps/plugin-websocket");
    const ws = await WS.connect(url, { headers });
    let closed = false;
    const done = (code: number, reason: string) => {
      if (closed) return;
      closed = true;
      unlisten();
      h.onClose(code, reason);
    };
    const unlisten = ws.addListener((m) => {
      if (m.type === "Text") h.onText(m.data);
      else if (m.type === "Binary") h.onBinary?.(decoder.decode(new Uint8Array(m.data)));
      else if (m.type === "Close") done(m.data?.code ?? 1006, m.data?.reason ?? "");
    });
    return {
      send: (d) => void ws.send(d).catch(() => done(1006, "send failed")),
      close: () => {
        void ws.disconnect().catch(() => {});
        done(1000, "");
      },
    };
  }

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    let opened = false;
    ws.onopen = () => {
      opened = true;
      resolve({ send: (d) => ws.readyState === WebSocket.OPEN && ws.send(d), close: () => ws.close() });
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") h.onText(e.data);
      else h.onBinary?.(decoder.decode(new Uint8Array(e.data as ArrayBuffer)));
    };
    ws.onerror = () => {
      if (!opened) reject(new Error("Couldn't open the terminal connection."));
    };
    ws.onclose = (e) => opened && h.onClose(e.code, e.reason);
  });
}
