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
import { useChat } from "../state/chat";
import { useArtifacts } from "../state/artifacts";
import { secrets } from "./secrets";
import { OPENCODE_PORT } from "./providers/boat";
import { openExternal } from "./platform";

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

/**
 * Open a link from chat, a link card, or a terminal. `localhost` links point
 * at the agent machine, so they become an artifact (the Artifact surface goes
 * through the provider's port forwarding to frame them); anything else opens
 * outside the app.
 */
export function openLink(href: string) {
  if (localPort(href)) {
    const sid = useChat.getState().activeId;
    if (sid) return useArtifacts.getState().showUrl(sid, href);
  }
  void openExternal(href);
}
