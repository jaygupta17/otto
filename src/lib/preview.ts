/**
 * Turn "localhost:3000 on the agent machine" into a URL this device can open.
 *
 * The agent runs on a remote machine, so a dev server it starts is only
 * reachable through the provider's port forwarding:
 *   E2B / Daytona  `https://<port>-<sandbox>.<domain>` (same shape as the agent URL)
 *   Boat           its `host` API publishes a port
 *   boxd           an HTTPS proxy per port
 *   custom         the same host as the agent server, on that port
 */
import { useWorkspaces, secretKeys, type Workspace } from "../state/workspaces";
import { secrets } from "./secrets";
import { OPENCODE_PORT } from "./providers/boat";
import { openExternal } from "./platform";
import { useUI } from "../state/ui";

const cache = new Map<string, string>();

/** Port of a local URL (`http://localhost:5173/x`), or null if it isn't local. */
export function localPort(raw: string): { port: number; rest: string } | null {
  let u: URL;
  try {
    u = new URL(/^\w+:\/\//.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (!/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])$/.test(u.hostname)) return null;
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  return { port, rest: u.pathname + u.search + u.hash };
}

/** Whether `localhost` on this device *is* the agent machine (a local server). */
function agentIsLocal(ws: Workspace) {
  try {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(new URL(ws.baseUrl).hostname);
  } catch {
    return false;
  }
}

/** A URL for `port` on the agent machine. Throws with a readable message. */
export async function previewUrl(port: number): Promise<string> {
  const st = useWorkspaces.getState();
  const ws = st.workspaces.find((w) => w.id === st.activeId);
  if (!ws) throw new Error("No workspace is connected.");
  const key = `${ws.id}:${port}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const base = new URL(ws.baseUrl);
  let url: string;
  // E2B and Daytona put the port first in the hostname.
  const prefixed = base.hostname.match(/^(\d+)-(.+)$/);
  if (prefixed && (ws.provider === "e2b" || ws.provider === "daytona")) {
    url = `${base.protocol}//${port}-${prefixed[2]}`;
  } else if (ws.provider === "boat" && ws.sandboxId) {
    const k = await secrets.get(secretKeys.boat);
    if (!k) throw new Error("Add your Boat API key in Settings to open ports.");
    const { BoatClient } = await import("./providers/boat");
    url = await new BoatClient(k).host(ws.sandboxId, port, `Port ${port}`);
  } else if (ws.provider === "boxd" && ws.sandboxId) {
    const k = await secrets.get(secretKeys.boxd);
    if (!k) throw new Error("Add your boxd API key in Settings to open ports.");
    const { boxdClient } = await import("./providers/boxd");
    const proxies = boxdClient(k).machines.proxies;
    const name = `port-${port}`;
    let p = (await proxies.list(ws.sandboxId)).find((x) => x.name === name);
    if (!p) {
      await proxies.create(ws.sandboxId, name, port);
      p = (await proxies.list(ws.sandboxId)).find((x) => x.name === name);
    }
    if (!p) throw new Error("boxd didn't return a URL for that port.");
    url = `https://${p.domain}`;
  } else {
    if (port === OPENCODE_PORT && !agentIsLocal(ws)) throw new Error("That's the agent's own port.");
    base.port = String(port);
    url = base.origin;
  }
  url = url.replace(/\/$/, "");
  cache.set(key, url);
  return url;
}

/** Resolve a typed address: local URLs go through the provider, others pass through. */
export async function resolveAddress(raw: string): Promise<string> {
  const t = raw.trim();
  if (/^\d{2,5}$/.test(t)) return previewUrl(Number(t));
  const local = localPort(t);
  if (local) {
    const st = useWorkspaces.getState();
    const ws = st.workspaces.find((w) => w.id === st.activeId);
    if (ws && agentIsLocal(ws)) return /^\w+:\/\//.test(t) ? t : `http://${t}`;
    return (await previewUrl(local.port)) + local.rest;
  }
  if (/^\w+:\/\//.test(t)) return t;
  return /\s/.test(t) || !/\./.test(t) ? `https://duckduckgo.com/?q=${encodeURIComponent(t)}` : `https://${t}`;
}

/** Ports with something listening on the agent machine (minus Otto's own). */
export const IGNORED_PORTS = new Set([OPENCODE_PORT, 49983, 22, 53]);

function agentPort() {
  const st = useWorkspaces.getState();
  const ws = st.workspaces.find((w) => w.id === st.activeId);
  try {
    return ws ? Number(new URL(ws.baseUrl).port) || null : null;
  } catch {
    return null;
  }
}

export function parseListening(out: string): number[] {
  const ports = new Set<number>();
  for (const line of out.split("\n")) {
    // ss: "LISTEN 0 511 *:5173 *:*"  /  netstat: "tcp 0 0 0.0.0.0:3000 0.0.0.0:* LISTEN"
    const cols = line.trim().split(/\s+/);
    for (const c of cols) {
      const m = c.match(/[:.](\d{2,5})$/);
      if (m && /^(\*|0\.0\.0\.0|127\.0\.0\.1|\[?::\]?|\[::1\]|\[::ffff:[\d.]+\])[:.]/.test(c)) {
        const p = Number(m[1]);
        // Skip system ports, the OS's ephemeral range, and the agent itself.
        if (p >= 1024 && p < 32768 && !IGNORED_PORTS.has(p) && p !== agentPort()) ports.add(p);
        break;
      }
    }
  }
  return [...ports].sort((a, b) => a - b);
}

export const LISTEN_COMMAND =
  'if [ "$(uname)" = Darwin ]; then netstat -an -p tcp; else ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null; fi | grep -i listen | head -80';

/**
 * Open a link from chat or a terminal. `localhost` links point at the agent
 * machine, so they open in the browser panel; anything else opens outside.
 */
export function openLink(href: string) {
  if (localPort(href)) useUI.getState().openInBrowser(href);
  else void openExternal(href);
}
