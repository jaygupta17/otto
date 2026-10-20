/**
 * Thin, typed client for the OpenCode v2 HTTP API.
 * Types come from `@opencode/client` (type-only import, zero runtime cost);
 * transport is ours so it can run through Tauri's HTTP client and carry the
 * sandbox proxy's gate token.
 */
import type {
  AgentInfo,
  ModelInfo,
  SessionInfo,
  SessionMessageInfo,
  SessionsResponse,
  SessionMessagesResponse,
  ServerInfo,
  LocationPublicInfo,
  PermissionReply,
  IntegrationInfo,
  CommandInfo,
} from "@opencode/client";
import { httpFetch } from "../platform";

export type {
  AgentInfo,
  ModelInfo,
  SessionInfo,
  SessionMessageInfo,
  ServerInfo,
  LocationPublicInfo,
  PermissionReply,
  IntegrationInfo,
  CommandInfo,
};

/** Boat's HTTPS proxy, and the cookie it reads the access token from. */
const BOAT_PROXY = /\.on\.(boat|ascii)\.dev$/;
const BOAT_COOKIE = "_port_auth";

export interface ServerEndpoint {
  /** Origin (and optional path prefix) of the OpenCode server, no trailing slash. */
  baseUrl: string;
  password: string;
  /** Token required by the sandbox provider's HTTPS proxy (Boat `_token`, Daytona preview token). */
  gateToken?: string;
  /** Send `gateToken` in this header instead of the `_token` query parameter (Daytona). */
  gateHeader?: string;
  /** Extra headers the provider's proxy wants on every request. */
  extraHeaders?: Record<string, string>;
}

export interface SessionRevert {
  messageID: string;
  partID?: string;
  snapshot?: string;
  files?: FileDiff[];
}
export interface FileDiff {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
}
export interface InboxItem {
  id: string;
  sessionID: string;
  time: { created: number };
  type: "user" | "synthetic" | "compaction" | "move";
  payload: { text?: string; files?: { uri: string; name?: string }[] };
  delivery: "steer" | "queue";
}

export class OpenCodeError extends Error {
  status: number;
  tag: string;
  constructor(status: number, tag: string, message: string) {
    super(message);
    this.status = status;
    this.tag = tag;
  }
}

export interface ModelRef {
  providerID: string;
  id: string;
  variant?: string;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export class OpenCode {
  constructor(public readonly endpoint: ServerEndpoint) {}

  url(path: string, query?: Query): string {
    const u = new URL(this.endpoint.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        u.searchParams.set(k, String(v));
      }
    }
    if (this.endpoint.gateToken && !this.endpoint.gateHeader && !this.boatGate()) u.searchParams.set("_token", this.endpoint.gateToken);
    return u.toString();
  }

  /**
   * Boat's proxy answers every `?_token=` request with a redirect that sets
   * its `_port_auth` cookie (and a redirected POST comes back as a GET), so
   * on Boat URLs the token goes in that cookie instead.
   */
  private boatGate() {
    return !!this.endpoint.gateToken && !this.endpoint.gateHeader && BOAT_PROXY.test(new URL(this.endpoint.baseUrl).hostname);
  }

  /** The proxy's gate token as a header, when it isn't in the query. */
  private gateHeaders(): Record<string, string> {
    const token = this.endpoint.gateToken;
    if (!token) return {};
    if (this.endpoint.gateHeader) return { [this.endpoint.gateHeader]: token };
    if (this.boatGate()) return { Cookie: `${BOAT_COOKIE}=${token}` };
    return {};
  }

  headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Basic ${btoa(`opencode:${this.endpoint.password}`)}`,
      Accept: "application/json",
      ...this.endpoint.extraHeaders,
      ...this.gateHeaders(),
      ...extra,
    };
  }

  async request<T>(method: string, path: string, opts: { query?: Query; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
    let res: Response;
    try {
      res = await httpFetch(this.url(path, opts.query), {
        method,
        signal: opts.signal,
        headers: this.headers({ ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...opts.headers }),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw e;
      const why = e instanceof Error ? e.message : String(e);
      throw new OpenCodeError(0, "NetworkError", `Can't reach your agent server${why ? ` (${why})` : ""}.`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!res.ok) {
      const j = (json ?? {}) as { _tag?: string; message?: string };
      throw new OpenCodeError(res.status, j._tag ?? `HTTP${res.status}`, j.message ?? (text.slice(0, 200) || res.statusText));
    }
    return json as T;
  }

  // ---- server ---------------------------------------------------------
  // Liveness. v2 answered this at /api/health in 2.0.2 and at /api/info from
  // 2.0.26, and nothing newer; /api/info covers both, so ask for that.
  health(signal?: AbortSignal) {
    return this.info(signal);
  }
  info(signal?: AbortSignal) {
    return this.request<ServerInfo>("GET", "/api/info", { signal });
  }
  location(directory?: string) {
    return this.request<LocationPublicInfo>("GET", "/api/location", { query: locQuery(directory) });
  }

  // ---- catalog --------------------------------------------------------
  async agents(directory?: string): Promise<AgentInfo[]> {
    const r = await this.request<{ data: AgentInfo[] }>("GET", "/api/agent", { query: locQuery(directory) });
    return r.data;
  }
  async models(directory?: string): Promise<ModelInfo[]> {
    const r = await this.request<{ data: ModelInfo[] }>("GET", "/api/model", { query: locQuery(directory) });
    return r.data;
  }
  async defaultModel(directory?: string): Promise<ModelRef | null> {
    const r = await this.request<{ data: ModelRef | null }>("GET", "/api/model/default", { query: locQuery(directory) });
    return r.data;
  }
  async integrations(): Promise<IntegrationInfo[]> {
    const r = await this.request<{ data: IntegrationInfo[] } | IntegrationInfo[]>("GET", "/api/integration");
    return Array.isArray(r) ? r : r.data;
  }
  connectKey(integrationID: string, key: string) {
    return this.request<unknown>("POST", `/api/integration/${encodeURIComponent(integrationID)}/connect/key`, { body: { key } });
  }
  async commands(directory?: string): Promise<CommandInfo[]> {
    const r = await this.request<{ data: CommandInfo[] } | CommandInfo[]>("GET", "/api/command", { query: locQuery(directory) });
    return Array.isArray(r) ? r : r.data;
  }

  // ---- sessions -------------------------------------------------------
  sessions(query: { limit?: number; cursor?: string; search?: string; directory?: string; parentID?: string } = {}) {
    return this.request<SessionsResponse>("GET", "/api/session", {
      query: { limit: query.limit ?? 80, order: query.cursor ? undefined : "desc", cursor: query.cursor, search: query.search, directory: query.directory, parentID: query.parentID ?? "null" },
    });
  }
  async createSession(input: { directory?: string; model?: ModelRef | null; agent?: string | null; title?: string }) {
    const r = await this.request<{ data: SessionInfo }>("POST", "/api/session", {
      body: {
        location: input.directory ? { directory: input.directory } : undefined,
        model: input.model ?? undefined,
        agent: input.agent ?? undefined,
        title: input.title ?? undefined,
      },
    });
    return r.data;
  }
  async session(id: string) {
    const r = await this.request<{ data: SessionInfo } | SessionInfo>("GET", `/api/session/${id}`);
    return "data" in r ? r.data : r;
  }
  deleteSession(id: string) {
    return this.request<void>("DELETE", `/api/session/${id}`);
  }
  renameSession(id: string, title: string) {
    return this.request<void>("PATCH", `/api/session/${id}`, { body: { title } });
  }
  messages(id: string, query: { limit?: number; cursor?: string; order?: "asc" | "desc" } = {}) {
    return this.request<SessionMessagesResponse>("GET", `/api/session/${id}/message`, {
      query: { limit: query.limit ?? 200, order: query.cursor ? undefined : query.order ?? "desc", cursor: query.cursor },
    });
  }
  prompt(id: string, input: { text: string; files?: { uri: string; name?: string }[]; delivery?: "steer" | "queue" }) {
    return this.request<{ data: { id: string } }>("POST", `/api/session/${id}/prompt`, {
      body: { text: input.text, files: input.files?.length ? input.files : undefined, delivery: input.delivery ?? undefined },
    });
  }
  command(id: string, command: string, args: string) {
    return this.request<void>("POST", `/api/session/${id}/command`, { body: { name: command, text: args } });
  }
  interrupt(id: string) {
    return this.request<unknown>("POST", `/api/session/${id}/interrupt`);
  }
  /** Admit a synthetic message; with `resume: false` it waits for the next turn instead of starting one. */
  synthetic(id: string, input: { text: string; description?: string; metadata?: Record<string, unknown>; resume?: boolean }) {
    return this.request<unknown>("POST", `/api/session/${id}/synthetic`, { body: input });
  }
  async fork(id: string, before?: string | null) {
    const r = await this.request<{ data: SessionInfo }>("POST", `/api/session/${id}/fork`, { body: { before: before ?? null } });
    return r.data;
  }
  compact(id: string) {
    return this.request<unknown>("POST", `/api/session/${id}/compact`, { body: {} });
  }
  /** Undo back to (and including) `messageID`. Staged until committed or cleared. */
  revertStage(id: string, messageID: string) {
    return this.request<{ data: SessionRevert }>("POST", `/api/session/${id}/revert/stage`, { body: { messageID } });
  }
  revertCommit(id: string) {
    return this.request<void>("POST", `/api/session/${id}/revert/commit`);
  }
  revertClear(id: string) {
    return this.request<void>("DELETE", `/api/session/${id}/revert`);
  }
  async inbox(id: string) {
    const r = await this.request<{ data: InboxItem[] }>("GET", `/api/session/${id}/inbox`);
    return r.data;
  }
  cancelInbox(id: string, inboxID: string) {
    return this.request<void>("DELETE", `/api/session/${id}/inbox/${inboxID}`);
  }
  setInboxDelivery(id: string, inboxID: string, delivery: "steer" | "queue") {
    return this.request<void>("PATCH", `/api/session/${id}/inbox/${inboxID}`, { body: { delivery } });
  }
  shell(id: string, command: string) {
    return this.request<unknown>("POST", `/api/session/${id}/shell`, { body: { command } });
  }
  async diff(id: string) {
    const r = await this.request<{ data: FileDiff[] }>("GET", `/api/session/${id}/diff`);
    return r.data;
  }
  switchModel(id: string, model: ModelRef) {
    return this.request<void>("POST", `/api/session/${id}/model`, { body: { model } });
  }
  switchAgent(id: string, agent: string) {
    return this.request<void>("POST", `/api/session/${id}/agent`, { body: { agent } });
  }
  replyPermission(sessionID: string, requestID: string, reply: PermissionReply) {
    return this.request<void>("POST", `/api/session/${sessionID}/permission/${requestID}/reply`, { body: { decision: reply } });
  }
  /** Ids of sessions with a run in progress. */
  async activeSessions(): Promise<string[]> {
    const r = await this.request<{ data: Record<string, unknown> }>("GET", "/api/session/active");
    return Object.keys(r?.data ?? {});
  }
  /** Questions waiting for an answer (the agent's `question` tool and others), across sessions. */
  async pendingForms<T = unknown>(): Promise<T[]> {
    const r = await this.request<{ data: T[] } | T[]>("GET", "/api/form");
    return Array.isArray(r) ? r : (r.data ?? []);
  }
  async pendingPermissions() {
    const r = await this.request<{ data: PermissionRequestLite[] } | PermissionRequestLite[]>("GET", "/api/permission/request");
    return Array.isArray(r) ? r : r.data;
  }
  replyForm(sessionID: string, formID: string, values: Record<string, unknown>) {
    return this.request<void>("POST", `/api/session/${sessionID}/form/${formID}/reply`, { body: { answer: values } });
  }
  cancelForm(sessionID: string, formID: string) {
    return this.request<void>("DELETE", `/api/session/${sessionID}/form/${formID}`);
  }

  // ---- filesystem -----------------------------------------------------
  async listDir(path: string, directory?: string) {
    const r = await this.request<{ data: FsEntry[] } | FsEntry[]>("GET", "/api/fs/list", { query: { path, ...locQuery(directory) } });
    return Array.isArray(r) ? r : r.data;
  }
  /**
   * Sub-folders of an absolute path, for the folder browser. Inside `home`
   * (a location) the fs API answers; elsewhere (or if it refuses) the shell does.
   */
  async listFolders(path: string, home?: string | null): Promise<{ name: string; path: string }[]> {
    const base = path.replace(/\/+$/, "") || "/";
    const join = (n: string) => `${base === "/" ? "" : base}/${n}`;
    const inside = home && (base === home.replace(/\/$/, "") || base.startsWith(home.replace(/\/$/, "") + "/"));
    if (inside) {
      try {
        const list = await this.listDir(base, home!);
        return list
          .filter((e) => e.type === "directory")
          .map((e) => {
            const name = e.path.replace(/\/$/, "").split("/").pop()!;
            return { name, path: join(name) };
          });
      } catch {
        /* fall through to the shell */
      }
    }
    const q = `'${base.replace(/'/g, `'\\''`)}'`;
    const r = await this.exec(`[ -d ${q} ] || { echo __OTTO_NOT_FOUND__; exit 44; }; find ${q} -mindepth 1 -maxdepth 1 -type d 2>/dev/null | head -n 2000`, { timeoutMs: 20_000 });
    if (r.exit === 44 || r.output.startsWith("__OTTO_NOT_FOUND__")) throw new OpenCodeError(404, "NotFound", `No folder at ${path}`);
    return r.output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((full) => ({ name: full.split("/").pop()!, path: full }));
  }

  /**
   * Read a file. Absolute paths are sent as-is (`/api/fs/read//abs/path`);
   * relative paths resolve against `directory` (or the server's cwd).
   */
  async readFile(path: string, directory?: string): Promise<string> {
    const abs = path.startsWith("/");
    const rel = abs && directory && path.startsWith(directory.replace(/\/$/, "") + "/");
    if (abs && !rel) return this.readViaShell(path);
    const r = await this.readFileBytes(path, directory);
    return new TextDecoder().decode(r.bytes ?? new Uint8Array());
  }

  /**
   * Read a file's raw bytes (images, PDFs, anything binary). `bytes` is null
   * when the file is bigger than `maxBytes` (only its size comes back then).
   * Outside a location it goes through the shell (base64), capped at ~140 KB.
   */
  async readFileBytes(path: string, directory?: string, opts: { maxBytes?: number } = {}): Promise<{ bytes: Uint8Array | null; mime: string; size: number; truncated?: boolean }> {
    const max = opts.maxBytes ?? Infinity;
    const abs = path.startsWith("/");
    const rel = abs && directory && path.startsWith(directory.replace(/\/$/, "") + "/") ? path.slice(directory.replace(/\/$/, "").length + 1) : null;
    // The fs API only serves files inside a location. Anything else (config
    // files, ~/.otto) is read through the shell, which doesn't boot a new
    // location (and its MCP servers) just to read one file.
    if (abs && !rel) return this.readBytesViaShell(path, max);
    const target = rel ?? (abs ? path : path.replace(/^\.\//, ""));
    const encoded = target.split("/").map(encodeURIComponent).join("/");
    // An absolute target keeps its leading "/", producing `/api/fs/read//abs/path`, which the server expects.
    const res = await httpFetch(this.url(`/api/fs/read/${encoded}`, rel || !abs ? locQuery(directory) : undefined), {
      headers: this.headers(),
    });
    if (res.status === 404) throw new OpenCodeError(404, "FileNotFound", `File not found: ${path}`);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let msg = "";
      try {
        msg = (JSON.parse(body) as { message?: string }).message ?? "";
      } catch {
        msg = body.slice(0, 160);
      }
      throw new OpenCodeError(res.status, "ReadError", msg || `Couldn't open ${path}`);
    }
    const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const length = Number(res.headers.get("content-length") ?? NaN);
    if (Number.isFinite(length) && length > max) {
      void res.body?.cancel().catch(() => {});
      return { bytes: null, mime, size: length };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, mime, size: bytes.byteLength };
  }

  private async readBytesViaShell(path: string, max: number) {
    const q = `'${path.replace(/'/g, `'\\''`)}'`;
    const cap = Math.min(max, 140_000);
    const r = await this.exec(`if [ -f ${q} ]; then wc -c < ${q}; head -c ${cap} < ${q} | base64 | tr -d '\\n'; else echo __OTTO_NOT_FOUND__; exit 44; fi`);
    if (r.exit === 44 || r.output.startsWith("__OTTO_NOT_FOUND__")) throw new OpenCodeError(404, "FileNotFound", `File not found: ${path}`);
    if (r.exit !== 0) throw new OpenCodeError(500, "ReadError", r.output.slice(0, 200) || `Couldn't read ${path}`);
    const [first, ...rest] = r.output.split("\n");
    const size = Number(first.trim()) || 0;
    if (size > max) return { bytes: null, mime: "", size };
    const bin = atob(rest.join("").trim());
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return { bytes, mime: "", size, truncated: bytes.byteLength < size };
  }

  private async readViaShell(path: string): Promise<string> {
    const q = `'${path.replace(/'/g, `'\\''`)}'`;
    const r = await this.exec(`if [ -f ${q} ]; then cat -- ${q}; else echo __OTTO_NOT_FOUND__; exit 44; fi`);
    if (r.exit === 44 || r.output.startsWith("__OTTO_NOT_FOUND__")) throw new OpenCodeError(404, "FileNotFound", `File not found: ${path}`);
    if (r.exit !== 0) throw new OpenCodeError(500, "ReadError", r.output.slice(0, 200) || `Couldn't read ${path}`);
    return r.output;
  }

  /** Write (create or replace) a file on the server. */
  async writeFile(path: string, content: string, directory?: string) {
    const res = await httpFetch(this.url("/api/experimental/fs/write", { path, ...locQuery(directory) }), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/octet-stream" }),
      body: content,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      let msg = t;
      try {
        msg = (JSON.parse(t) as { message?: string }).message ?? t;
      } catch {
        /* keep text */
      }
      throw new OpenCodeError(res.status, "WriteError", msg || `Couldn't write ${path}`);
    }
  }

  /**
   * Run a shell command on the server and wait for it. Used for small admin
   * tasks (scheduling, deleting skills). Output is capped by the server.
   */
  async exec(command: string, opts: { directory?: string; timeoutMs?: number } = {}): Promise<{ exit: number; output: string }> {
    const started = await this.request<{ data: { id: string } }>("POST", "/api/shell", { query: locQuery(opts.directory), body: { command } });
    const id = started.data.id;
    const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
    let info: { status: string; exit?: number } = { status: "running" };
    while (Date.now() < deadline) {
      info = (await this.request<{ data: { status: string; exit?: number } }>("GET", `/api/shell/${id}`)).data;
      if (info.status !== "running") break;
      await new Promise((r) => setTimeout(r, 300));
    }
    const out = await this.request<{ data: { output: string } }>("GET", `/api/shell/${id}/output`, { query: { limit: 200_000 } }).catch(() => ({ data: { output: "" } }));
    void this.request("DELETE", `/api/shell/${id}`).catch(() => {});
    if (info.status === "running") throw new OpenCodeError(408, "Timeout", "The command took too long.");
    return { exit: typeof info.exit === "number" ? info.exit : info.status === "exited" ? 0 : 1, output: out.data.output };
  }

  // ---- terminals ------------------------------------------------------
  async ptys(directory?: string): Promise<PtyInfo[]> {
    return (await this.request<{ data: PtyInfo[] }>("GET", "/api/pty", { query: locQuery(directory) })).data;
  }
  async createPty(opts: { cwd?: string; title?: string }, directory?: string): Promise<PtyInfo> {
    const env = { TERM: "xterm-256color", COLORTERM: "truecolor" };
    return (await this.request<{ data: PtyInfo }>("POST", "/api/pty", { query: locQuery(directory), body: { ...opts, env } })).data;
  }
  resizePty(id: string, size: { rows: number; cols: number }, directory?: string) {
    return this.request<unknown>("PUT", `/api/pty/${id}`, { query: locQuery(directory), body: { size } });
  }
  removePty(id: string, directory?: string) {
    return this.request<void>("DELETE", `/api/pty/${id}`, { query: locQuery(directory) });
  }
  /**
   * WebSocket URL for a terminal. A WebSocket can't send the Basic auth
   * header, so the server hands out a one-time ticket for it instead.
   */
  async ptySocketUrl(id: string, opts: { cursor?: number; directory?: string } = {}): Promise<string> {
    const r = await this.request<{ data: { ticket: string } }>("POST", `/api/pty/${id}/connect-token`, {
      query: locQuery(opts.directory),
      headers: { "x-opencode-ticket": "1" },
    });
    return this.url(`/api/pty/${id}/connect`, { ticket: r.data.ticket, cursor: opts.cursor ?? -1, ...locQuery(opts.directory) }).replace(/^http/, "ws");
  }
  /** Headers the provider's proxy needs on the terminal socket (gate token, preview-warning skip). */
  socketHeaders(): Record<string, string> {
    return {
      ...this.endpoint.extraHeaders,
      ...this.gateHeaders(),
    };
  }

  // ---- config / extensions --------------------------------------------
  configEntries() {
    return this.request<Array<{ type: "document"; path?: string; info?: Record<string, unknown> } | { type: "directory"; path: string }>>("GET", "/api/config");
  }
  reloadLocation() {
    return this.request<void>("POST", "/api/location/reload");
  }
  async mcpServers(): Promise<McpServer[]> {
    const r = await this.request<{ data: McpServer[] }>("GET", "/api/mcp");
    return r.data;
  }
  mcpConnect(name: string) {
    return this.request<void>("POST", `/api/experimental/mcp/${encodeURIComponent(name)}/connect`);
  }
  mcpDisconnect(name: string) {
    return this.request<void>("POST", `/api/experimental/mcp/${encodeURIComponent(name)}/disconnect`);
  }
  mcpPut(name: string, config: McpConfig) {
    return this.request<void>("PUT", `/api/experimental/mcp/${encodeURIComponent(name)}`, { body: { config } });
  }
  mcpRemove(name: string) {
    return this.request<void>("DELETE", `/api/experimental/mcp/${encodeURIComponent(name)}`);
  }
  /** Loaded plugins and how each is doing. */
  async plugins(): Promise<PluginInfo[]> {
    const r = await this.request<{ data: PluginInfo[] }>("GET", "/api/plugin");
    return r.data;
  }
  async skills(): Promise<SkillInfo[]> {
    const r = await this.request<{ data: SkillInfo[] }>("GET", "/api/skill");
    return r.data;
  }
  async findFiles(query: string, directory?: string, limit = 30) {
    const r = await this.request<{ data: FsEntry[] }>("GET", "/api/fs/find", { query: { query, type: "file", limit, ...locQuery(directory) } });
    return r.data;
  }

  // ---- shell ----------------------------------------------------------
  runShell(command: string, directory?: string) {
    return this.request<{ data: { id: string; status: string } }>("POST", "/api/shell", { query: locQuery(directory), body: { command } });
  }
  shellOutput(id: string) {
    return this.request<{ data: { output: string } } | { output: string }>("GET", `/api/shell/${id}/output`);
  }
  async shellInfo(id: string) {
    const r = await this.request<{ data: { id: string; status: string; exit?: number } }>("GET", `/api/shell/${id}`);
    return r.data;
  }
  /** Commands the server knows about in a location (the default one without a directory). */
  async shells(directory?: string) {
    const r = await this.request<{ data: ShellInfo[] }>("GET", "/api/shell", { query: locQuery(directory) });
    return r.data ?? [];
  }
  /** Output from byte `cursor` on; `cursor` in the reply is where the next read starts, `size` the whole file. */
  async shellOutputFrom(id: string, cursor: number, limit?: number) {
    const r = await this.request<{ data: { output: string; cursor: number; size: number } }>("GET", `/api/shell/${id}/output`, { query: { cursor, limit } });
    return r.data;
  }
  /** Kill a command and forget it. */
  removeShell(id: string) {
    return this.request<void>("DELETE", `/api/shell/${id}`);
  }
  /** Move whatever the session is blocked on (a long command, a subagent) to the background so the turn can go on. */
  background(sessionId: string) {
    return this.request<void>("POST", `/api/session/${sessionId}/background`);
  }
}

export interface ShellInfo {
  id: string;
  status: "running" | "exited" | "timeout" | "killed";
  command: string;
  cwd?: string;
  exit?: number;
  signal?: string;
  metadata?: { sessionID?: string; [k: string]: unknown };
  time: { started: number; completed?: number };
}

function locQuery(directory?: string): Query {
  // OpenCode encodes the `location` struct as deep-object query params.
  return directory ? { "location[directory]": directory } : {};
}

export interface PtyInfo {
  id: string;
  title: string;
  command: string;
  cwd: string;
  status: "running" | "exited";
  pid?: number;
}

export interface FsEntry {
  /** Relative to the location root (not the listed folder); directories end with "/". */
  path: string;
  type: "file" | "directory";
}

export interface PermissionRequestLite {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  message?: string;
  save?: string[];
  /** Tool-specific details, e.g. `command` for the shell tool. */
  metadata?: Record<string, unknown>;
}

export interface PluginInfo {
  id: string;
  source: { type: "builtin" | "package" | "local" | string; target?: string; version?: string; path?: string };
  state: { status: "active" | "failed" | string; error?: string; message?: string };
}

export interface McpServer {
  name: string;
  status: { status: "connected" | "pending" | "disabled" | "failed" | "needs_auth"; error?: string };
  integrationID?: string;
}

export type McpConfig =
  | { type: "local"; command: string[]; cwd?: string; environment?: Record<string, string>; disabled?: boolean }
  | { type: "remote"; url: string; headers?: Record<string, string>; disabled?: boolean };

export interface SkillInfo {
  id: string;
  name: string;
  description?: string;
  autoinvoke?: boolean;
  path: string;
  content: string;
}
