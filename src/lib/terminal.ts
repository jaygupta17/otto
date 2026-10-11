/**
 * One terminal: an xterm.js view wired to an OpenCode PTY over a WebSocket.
 *
 * The PTY lives on the agent machine, so it outlives the app: closing Otto
 * (or losing the network) only drops the socket. Reconnecting asks the server
 * to replay the PTY's buffer from the start, so the screen comes back intact.
 *
 * Each session keeps its own DOM node, so switching tabs or panel surfaces
 * moves the node instead of re-creating the terminal (scrollback survives).
 */
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { OpenCode } from "./opencode/client";
import { openSocket, type Socket } from "./socket";

export type TermStatus = "connecting" | "live" | "offline" | "exited";

const DARK: ITheme = {
  background: "rgba(0,0,0,0)",
  foreground: "#e6e6e4",
  cursor: "#f1f1f0",
  cursorAccent: "#161618",
  selectionBackground: "rgba(255,255,255,0.18)",
  black: "#2a2a2d",
  red: "#ff6b62",
  green: "#4cc488",
  yellow: "#f3b13f",
  blue: "#6d9cff",
  magenta: "#c792ea",
  cyan: "#5fd1d8",
  white: "#d6d6d4",
  brightBlack: "#6d6d6b",
  brightRed: "#ff8a83",
  brightGreen: "#6fd7a1",
  brightYellow: "#f7c76a",
  brightBlue: "#94b6ff",
  brightMagenta: "#d9b0f2",
  brightCyan: "#86e1e6",
  brightWhite: "#f5f5f4",
};

const LIGHT: ITheme = {
  background: "rgba(0,0,0,0)",
  foreground: "#1d1d1f",
  cursor: "#161616",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(29,95,214,0.18)",
  black: "#1d1d1f",
  red: "#c93a32",
  green: "#1f8a4c",
  yellow: "#9a5c00",
  blue: "#1d5fd6",
  magenta: "#8e3fb5",
  cyan: "#127f8a",
  white: "#8f8f8f",
  brightBlack: "#6b6b6b",
  brightRed: "#e0524a",
  brightGreen: "#2aa35f",
  brightYellow: "#b87a10",
  brightBlue: "#3b7af0",
  brightMagenta: "#a65ccc",
  brightCyan: "#1f98a4",
  brightWhite: "#3a3a3c",
};

export const terminalTheme = (mode: "light" | "dark") => (mode === "dark" ? DARK : LIGHT);

export class TermSession {
  readonly host: HTMLDivElement;
  readonly term: Terminal;
  private fit = new FitAddon();
  private socket: Socket | null = null;
  private opened = false;
  private disposed = false;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSize = "";
  private listeners = new Set<(s: TermStatus) => void>();
  status: TermStatus = "connecting";

  constructor(
    readonly id: string,
    private client: OpenCode,
    private directory: string | undefined,
    mode: "light" | "dark",
    onLink: (url: string) => void,
  ) {
    this.host = document.createElement("div");
    this.host.className = "h-full w-full";
    this.term = new Terminal({
      allowTransparency: true,
      theme: terminalTheme(mode),
      fontFamily: '"JetBrains Mono Variable", ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: "bar",
      scrollback: 5000,
      macOptionIsMeta: true,
      allowProposedApi: false,
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon((_e, url) => onLink(url)));
    this.term.onData((d) => this.socket?.send(d));
    void this.connect();
  }

  onStatus(fn: (s: TermStatus) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private setStatus(s: TermStatus) {
    this.status = s;
    for (const fn of this.listeners) fn(s);
  }

  /** Put the terminal into `container` (first call opens xterm there). */
  mount(container: HTMLElement) {
    if (this.host.parentElement !== container) container.appendChild(this.host);
    if (!this.opened) {
      this.term.open(this.host);
      this.opened = true;
    }
    this.refit();
  }

  refit() {
    if (!this.opened || !this.host.isConnected || this.host.clientWidth === 0) return;
    try {
      this.fit.fit();
    } catch {
      return;
    }
    const size = `${this.term.cols}x${this.term.rows}`;
    if (size === this.lastSize) return;
    this.lastSize = size;
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      void this.client.resizePty(this.id, { rows: this.term.rows, cols: this.term.cols }, this.directory).catch(() => {});
    }, 120);
  }

  focus() {
    this.term.focus();
  }

  /** Type into the shell (the on-screen key bar on phones). */
  send(data: string) {
    this.socket?.send(data);
  }

  setTheme(mode: "light" | "dark") {
    this.term.options.theme = terminalTheme(mode);
  }

  async connect() {
    if (this.disposed) return;
    this.setStatus("connecting");
    try {
      const url = await this.client.ptySocketUrl(this.id, { cursor: 0, directory: this.directory });
      // The server replays the PTY from the start, so begin from a blank screen.
      this.term.reset();
      this.socket = await openSocket(url, this.client.socketHeaders(), {
        onText: (t) => this.term.write(t),
        // Binary frames are control messages (`\0{"cursor":n}`), not output.
        onBinary: () => {},
        onClose: (code, reason) => this.dropped(code, reason),
      });
      if (this.disposed) return this.socket.close();
      this.retry = 0;
      this.lastSize = "";
      this.setStatus("live");
      this.refit();
    } catch (e) {
      const msg = (e as Error).message ?? "";
      if (/not found|404/i.test(msg)) return this.exited();
      this.dropped(1006, msg);
    }
  }

  private exited() {
    this.socket = null;
    this.setStatus("exited");
    this.term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
  }

  private dropped(code: number, reason: string) {
    this.socket = null;
    if (this.disposed) return;
    if (code === 4404 || /exited|not found/i.test(reason)) return this.exited();
    this.setStatus("offline");
    const delay = [800, 1500, 3000, 6000, 10000][Math.min(this.retry++, 4)];
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  /** Reconnect now (after the app comes back to the foreground). */
  wake() {
    if (this.status === "offline") {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      void this.connect();
    }
  }

  dispose() {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.socket?.close();
    this.socket = null;
    this.listeners.clear();
    this.term.dispose();
    this.host.remove();
  }
}
