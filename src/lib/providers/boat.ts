/**
 * Boat (https://boat.dev) sandbox provider.
 *
 * Lifecycle we drive:
 *   create sandbox → wait until it accepts commands → install OpenCode v2
 *   → run it as an enabled systemd service (survives stop/resume)
 *   → expose its port on Boat's HTTPS proxy (`POST /sandboxes/{id}/host`).
 */
import { httpFetch } from "../platform";

const BOAT_API = "https://boat.dev/api/v1";
export const OPENCODE_PORT = 4096;

export type BoatSandboxState =
  | "init"
  | "provisioning"
  | "provisioned"
  | "cloning"
  | "ready"
  | "idle"
  | "running"
  | "archiving"
  | "archived"
  | "error"
  | "cancelled";

export interface BoatSandbox {
  id: string;
  name: string;
  state: BoatSandboxState;
  error?: string | null;
  health?: "ok" | "degraded";
  type?: string;
  vcpu?: number;
  memoryGB?: number;
  archiveAfter?: string | null;
  createdAt?: string;
}

export interface BoatUser {
  id?: string;
  email?: string;
  name?: string;
  [k: string]: unknown;
}

export interface BoatLimits {
  accessTier?: string;
  canStart: boolean;
  checkoutRequired?: boolean;
  startBlockedReason?: string | null;
  blockedReason?: string | null;
  activeSandboxes: number;
  maxActiveSandboxes: number;
  billingStatus?: string;
}

export const BOAT_BILLING_URL = "https://boat.dev/dashboard?tab=billing";

/** Errors the user can only fix in Boat's billing page (not by retrying). */
export function isBillingError(e: unknown): boolean {
  if (!(e instanceof BoatError)) return false;
  return (
    e.status === 402 ||
    ["billing_required", "start_blocked", "trial_machine_class_not_allowed", "org_suspended", "team_member_cap_reached"].includes(e.code) ||
    /trial|billing|payment|allowance/i.test(e.message)
  );
}

export class BoatError extends Error {
  status: number;
  code: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, retryable = false, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

/** States where the machine is up and can run commands. */
export const RUNNING_STATES: BoatSandboxState[] = ["ready", "idle", "running"];
export const BOOTING_STATES: BoatSandboxState[] = ["init", "provisioning", "provisioned", "cloning"];

export class BoatClient {
  constructor(private apiKey: string) {}

  private async request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>, signal?: AbortSignal): Promise<T> {
    let res: Response;
    try {
      res = await httpFetch(`${BOAT_API}${path}`, {
        method,
        signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new BoatError(0, "network", `Couldn't reach Boat. ${errorText(e)}`, true);
    }
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    if (!res.ok || json.ok === false) {
      const err = (json.error ?? {}) as Record<string, unknown>;
      const details = (err.details ?? {}) as Record<string, unknown>;
      const code = String(json.code ?? err.code ?? `http_${res.status}`);
      const message = String(json.message ?? err.message ?? (text.slice(0, 200) || res.statusText || "Request failed"));
      const retryable = details.retryable === true || code === "sandbox_starting" || code === "idempotency_in_progress" || res.status === 429 || res.status >= 500;
      throw new BoatError(res.status, code, humanizeBoatError(res.status, code, message), retryable, details);
    }
    return json as T;
  }

  me(signal?: AbortSignal) {
    return this.request<{ user?: BoatUser } & BoatUser>("GET", "/me", undefined, undefined, signal);
  }

  limits(signal?: AbortSignal) {
    return this.request<BoatLimits>("GET", "/limits", undefined, undefined, signal);
  }

  async list(): Promise<BoatSandbox[]> {
    const r = await this.request<{ sandboxes: BoatSandbox[] }>("GET", "/sandboxes");
    return r.sandboxes ?? [];
  }

  async get(id: string, signal?: AbortSignal): Promise<BoatSandbox> {
    const r = await this.request<{ sandbox: BoatSandbox }>("GET", `/sandboxes/${id}`, undefined, undefined, signal);
    return r.sandbox;
  }

  async create(opts: { ttlSeconds: number | null; type?: string; name?: string }, idempotencyKey: string): Promise<BoatSandbox> {
    const body: Record<string, unknown> = { ttlSeconds: opts.ttlSeconds };
    if (opts.type) body.type = opts.type;
    const r = await this.request<{ sandbox: BoatSandbox }>("POST", "/sandboxes", body, { "Idempotency-Key": idempotencyKey });
    if (opts.name) {
      // Best effort; a name is cosmetic.
      await this.request("PATCH", `/sandboxes/${r.sandbox.id}`, { name: opts.name }).catch(() => {});
    }
    return r.sandbox;
  }

  async resume(id: string): Promise<void> {
    await this.request("POST", `/sandboxes/${id}/resume`, {});
  }

  async stop(id: string): Promise<void> {
    await this.request("POST", `/sandboxes/${id}/stop`, {});
  }

  async update(id: string, patch: { name?: string; ttlSeconds?: number | null }) {
    await this.request("PATCH", `/sandboxes/${id}`, patch);
  }

  async command(id: string, command: string, timeoutSeconds = 120, signal?: AbortSignal) {
    return this.request<{ success: boolean; exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }>(
      "POST",
      `/sandboxes/${id}/commands`,
      { command, timeoutSeconds },
      undefined,
      signal,
    );
  }

  /**
   * A signed-in URL for the live desktop (Moonlight stream). Null while Boat
   * is still preparing it; ask
   * again in a couple of seconds. It must be opened within 10 minutes, so ask
   * on every page load. Secret-bearing: never log it.
   */
  async stream(id: string, signal?: AbortSignal): Promise<string | null> {
    const r = await this.request<{ desktopUrl?: string | null; provisioning?: boolean }>("POST", `/sandboxes/${id}/desktop`, {}, undefined, signal);
    return r.desktopUrl ?? null;
  }

  /** Expose a port on Boat's HTTPS proxy. Returns the full (possibly token-gated) URL. */
  async host(id: string, port: number, title: string): Promise<string> {
    try {
      const r = await this.request<Record<string, unknown>>("POST", `/sandboxes/${id}/host`, { port, title });
      const url = findUrl(r);
      if (url) return url;
    } catch (e) {
      if (e instanceof BoatError && e.status !== 404 && e.status !== 405) throw e;
    }
    // Fallback: the in-sandbox `host` CLI prints the URL.
    await this.command(id, `host ${port} --title ${shellQuote(title)}`, 60);
    const r = await this.command(id, `host url ${port}`, 90);
    const url = findUrl(r.stdout);
    if (!url) throw new BoatError(500, "host_failed", "Boat didn't return a URL for the agent server.");
    return url;
  }
}

function findUrl(value: unknown): string | null {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const m = text.match(/https:\/\/[A-Za-z0-9.-]+\.(?:on\.boat\.dev|on\.ascii\.dev)[^\s"'\\]*/);
  return m ? m[0] : null;
}

function shellQuote(s: string) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function humanizeBoatError(status: number, code: string, message: string) {
  if (status === 401 || code === "unauthorized") return "That API key wasn't accepted. Double-check it and try again.";
  if (status === 402 || code === "billing_required") return "Your Boat account needs billing set up before it can start machines.";
  if (code === "trial_machine_class_not_allowed") return "That machine size needs a paid Boat plan. Pick Small or Standard.";
  if (code === "trial_auto_stop_required") return "Free-trial sandboxes must auto-sleep within 2 hours.";
  if (code === "limit_reached" || code === "daily_limit_reached" || code === "rate_limited") return `Boat limit reached: ${message}`;
  if (code === "no_ready_machine") return "No machine is free right now. Try again in a moment.";
  return message;
}

/**
 * Bash run inside the sandbox to install OpenCode v2 (idempotent).
 * Prints the version on success.
 */
export function installScript(): string {
  return [
    "set -eu",
    'OC="$HOME/.opencode/bin/opencode"',
    'mkdir -p "$HOME/.otto" "$HOME/projects"',
    // 2.1.0 or newer: the first build that lets the apps plugin ask for approval.
    'V=$("$OC" --version 2>/dev/null | grep -Eo "[0-9]+\\.[0-9]+\\.[0-9]+" | head -n 1 || true)',
    'if ! printf "2.1.0\\n%s\\n" "$V" | sort -V -C 2>/dev/null; then',
    '  curl -fsSL https://opencode.ai/v2/install | bash > "$HOME/.otto/install.log" 2>&1 || { tail -n 30 "$HOME/.otto/install.log"; exit 1; }',
    "fi",
    '"$OC" --version',
  ].join("\n");
}

/**
 * Bash that (re)writes the systemd unit for `opencode serve`, restarts it
 * and waits for /api/info. The password lives in a root-only env file.
 */
export function serviceScript(password: string, port = OPENCODE_PORT): string {
  return `set -eu
OC="$HOME/.opencode/bin/opencode"
U="$(id -un)"
LOGIN_PATH="$(bash -lc 'printf %s "$PATH"' 2>/dev/null || true)"
[ -n "$LOGIN_PATH" ] || LOGIN_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
sudo mkdir -p /etc/otto
printf 'OPENCODE_SERVER_PASSWORD=%s\\nPATH=%s\\n' '${password}' "$HOME/.opencode/bin:$LOGIN_PATH" | sudo tee /etc/otto/opencode.env >/dev/null
sudo chmod 600 /etc/otto/opencode.env
sudo tee /etc/systemd/system/otto-opencode.service >/dev/null <<UNIT
[Unit]
Description=Otto OpenCode server
After=network-online.target
Wants=network-online.target

[Service]
User=$U
WorkingDirectory=$HOME/projects
Environment=HOME=$HOME
Environment=TERM=xterm-256color
EnvironmentFile=/etc/otto/opencode.env
ExecStart=$OC serve --hostname 0.0.0.0 --port ${port}
Restart=always
RestartSec=2
# When the agent installs something heavy (a browser, a big npm tree) and the
# machine runs out of memory, the kernel should kill that, not the agent server.
OOMScoreAdjust=-900

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable otto-opencode >/dev/null 2>&1
sudo systemctl restart otto-opencode
for i in $(seq 1 90); do
  if curl -fsS -u "opencode:${password}" "http://127.0.0.1:${port}/api/info" >/dev/null 2>&1; then echo OTTO_READY; exit 0; fi
  sleep 1
done
sudo journalctl -u otto-opencode -n 30 --no-pager 2>/dev/null || true
exit 1`;
}

/**
 * For sandboxes without systemd (E2B, Daytona containers): run `opencode serve`
 * under a tiny restart loop, detached with setsid so it outlives the command
 * that started it. The password lives in a 600 env file in ~/.otto.
 */
export function daemonScript(password: string, port = OPENCODE_PORT): string {
  return `set -eu
D="$HOME/.otto"
mkdir -p "$D" "$HOME/projects"
umask 077
printf 'OPENCODE_SERVER_PASSWORD=%s\n' '${password}' > "$D/opencode.env"
cat > "$D/serve.sh" <<'SERVE'
#!/bin/bash
set -a; . "$HOME/.otto/opencode.env"; set +a
export PATH="$HOME/.opencode/bin:$PATH" TERM=xterm-256color
cd "$HOME/projects"
# Out of memory (say, the agent installing a browser), the kernel should kill
# that and not the agent server. Inherited by the server; needs passwordless sudo.
sudo -n sh -c "echo -900 > /proc/$$/oom_score_adj" 2>/dev/null || true
while true; do
  "$HOME/.opencode/bin/opencode" serve --hostname 0.0.0.0 --port ${port} >> "$HOME/.otto/opencode.log" 2>&1
  sleep 2
done
SERVE
chmod 700 "$D/serve.sh"
if [ -f "$D/serve.pid" ]; then kill -- -"$(cat "$D/serve.pid")" 2>/dev/null || kill "$(cat "$D/serve.pid")" 2>/dev/null || true; fi
pkill -f "opencode serve --hostname 0.0.0.0 --port ${port}" 2>/dev/null || true
setsid nohup "$D/serve.sh" > /dev/null 2>&1 < /dev/null &
echo $! > "$D/serve.pid"
for i in $(seq 1 90); do
  if curl -fsS -u "opencode:${password}" "http://127.0.0.1:${port}/api/info" >/dev/null 2>&1; then echo OTTO_READY; exit 0; fi
  sleep 1
done
tail -n 30 "$D/opencode.log" 2>/dev/null || true
exit 1`;
}

/** Quick in-sandbox check that the service answers; used on resume. */
export function healthScript(password: string, port = OPENCODE_PORT): string {
  return `for i in $(seq 1 30); do curl -fsS -u "opencode:${password}" "http://127.0.0.1:${port}/api/info" >/dev/null 2>&1 && { echo OTTO_READY; exit 0; }; sleep 1; done; exit 1`;
}

/**
 * The password Otto's agent server was provisioned with; prints nothing when
 * there is none. daemonScript keeps it in ~/.otto, serviceScript in a
 * root-only /etc/otto file (hence `sudo -n`).
 */
export function readPasswordScript(): string {
  return `for f in "$HOME/.otto/opencode.env" /etc/otto/opencode.env; do
  v="$( (cat "$f" 2>/dev/null || sudo -n cat "$f" 2>/dev/null) | sed -n 's/^OPENCODE_SERVER_PASSWORD=//p' | head -n 1)"
  if [ -n "$v" ]; then printf '%s\\n' "$v"; exit 0; fi
done
exit 0`;
}

export function wrapScript(script: string): string {
  // Ship the script base64-encoded so no quoting survives the trip.
  const b64 = btoa(unescape(encodeURIComponent(script)));
  return `echo ${b64} | base64 -d | bash`;
}
