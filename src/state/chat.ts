/**
 * Sessions, timelines, catalog (agents/models) and pending asks for the
 * connected server. Live events are batched per animation frame so a fast
 * token stream costs one React commit per frame, not one per token.
 */
import { create } from "zustand";
import type { AgentInfo, ModelInfo, SessionInfo, V2Event } from "@opencode/client";
import { OpenCode, OpenCodeError, type ModelRef, type PermissionRequestLite, type SessionRevert } from "../lib/opencode/client";
import { applyEvent, eventSessionID, projectHistory, type Delivery, type UIMessage } from "../lib/opencode/projection";
import { fetchTimelinePage, mergeTail, withTimeout } from "../lib/opencode/timeline";
import { uid } from "../lib/id";
import { kv } from "../lib/kv";
import { useWorkspaces } from "./workspaces";
import { toast, useUI } from "./ui";
import { isOfferedAgent } from "../lib/teammates";
import { dispatchAlerts } from "./notifications";
import { permissionLine } from "../lib/asks";
import { subagentOf, subagentStopNote, toolKind, type ToolBlock } from "../lib/opencode/tools";

export interface Timeline {
  messages: UIMessage[];
  loaded: boolean;
  loading: boolean;
  error?: string;
  older?: string | null;
}

export interface FormLite {
  id: string;
  sessionID: string;
  title: string;
  /** `kind: "question"` for the agent's question tool. */
  metadata?: Record<string, unknown>;
  fields: Array<Record<string, unknown> & { key: string; type: string; title?: string; description?: string; options?: { value: string; label?: string; description?: string }[]; required?: boolean; default?: unknown; placeholder?: string; custom?: boolean }>;
}

interface State {
  client: OpenCode | null;
  sessions: Record<string, SessionInfo>;
  sessionsLoaded: boolean;
  sessionsError?: string;
  busy: Record<string, boolean>;
  retrying: Record<string, { attempt: number; message: string; next: number } | undefined>;
  unread: Record<string, boolean>;
  timelines: Record<string, Timeline>;
  permissions: Record<string, PermissionRequestLite>;
  forms: Record<string, FormLite>;
  /** Subagent session → the session that spawned it. Their asks surface in the parent chat. */
  parents: Record<string, string>;
  /** Subagent session → the agent doing it, so a teammate shows as busy while it works for another. */
  delegated: Record<string, string>;
  agents: AgentInfo[];
  models: ModelInfo[];
  /** Why the last catalog refresh failed, if it did. Shown quietly; never toasted automatically. */
  catalogError?: string;
  defaultModel: ModelRef | null;
  pickedModel: ModelRef | null;
  /** The agent new sessions start with. null until a teammate exists. */
  pickedAgent: string | null;
  homeDir: string | null;
  projectDir: string | null;
  /** Models the server rejected as deprecated/removed; hidden from pickers. */
  brokenModels: string[];
  /** Pinned session ids for this workspace (on-device). */
  pinned: string[];
  togglePin(id: string): void;
  /** Agent rows open in the sidebar, by agent id. */
  agentRowsOpen: string[];
  toggleAgentRow(id: string, open?: boolean): void;
  /** Re-read agents and models. Silent by default: automatic refreshes must not toast during warmup. */
  refreshCatalog(opts?: { silent?: boolean }): Promise<void>;
  activeId: string | null;
  drafts: Record<string, string>;

  reset(): void;
  bootstrap(client: OpenCode): Promise<void>;
  resync(): Promise<void>;
  /** Cheap catch-up after the first stream connect, once bootstrap has settled. */
  syncOnConnect(): Promise<void>;
  loadSessions(): Promise<void>;
  open(id: string | null): void;
  loadTimeline(id: string, force?: boolean): Promise<void>;
  /** Refresh the last few messages in place, without a skeleton. */
  loadTail(id: string): Promise<void>;
  loadOlder(id: string): Promise<void>;
  send(text: string, opts?: { sessionId?: string | null }): Promise<string | null>;
  interrupt(id: string): Promise<void>;
  /** Move what the session is waiting on (a long command, a subagent) to the background; the turn goes on. */
  background(id: string): Promise<void>;
  /** Stop a subagent: tell the parent's agent it was the user (so it doesn't just retry), then interrupt the child. */
  stopSubagent(parent: string, child: string, description?: string): Promise<void>;
  remove(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  setModel(ref: ModelRef, sessionId?: string | null): Promise<void>;
  setAgent(agent: string | null, sessionId?: string | null): Promise<void>;
  setProjectDir(dir: string | null): void;
  setDraft(key: string, text: string): void;
  replyPermission(req: PermissionRequestLite, reply: "once" | "always" | "reject"): Promise<void>;
  replyForm(form: FormLite, values: Record<string, unknown> | null): Promise<void>;
  ingest(e: V2Event): void;
  /** How messages sent during a run are delivered: right after the current step, or after the run. */
  delivery: Delivery;
  setDeliveryMode(d: Delivery): void;
  fork(id: string, before?: string | null, draft?: string): Promise<string | null>;
  /** Undo the last exchange (or back to `messageID`), restoring files; its prompt returns to the composer. */
  undo(id: string, messageID?: string): Promise<void>;
  redo(id: string): Promise<void>;
  compact(id: string): Promise<void>;
  runShell(id: string, command: string): Promise<void>;
  cancelInbox(sid: string, inboxID: string): Promise<void>;
  setInboxDelivery(sid: string, inboxID: string, d: Delivery): Promise<void>;
}

const empty = (): Timeline => ({ messages: [], loaded: false, loading: false });

// A session's messages carry tool output and images inline: one long session
// can return tens of MB for a page of 120. Read small pages instead of the
// whole history, and refresh only the tail after a turn.
export const TIMELINE_PAGE = 12;
export const TIMELINE_OLDER = 12;
export const TIMELINE_TAIL = 4;
export const TIMELINE_TIMEOUT_MS = 12_000;
const TIMELINE_ERROR = "Couldn't load this conversation. It may be too large for this connection — try again.";

let queue: V2Event[] = [];
let frame = 0;
let fallback: ReturnType<typeof setTimeout> | undefined;
/** Events that arrived while a timeline was loading; applied after the REST snapshot. */
const pendingWhileLoading = new Map<string, V2Event[]>();
const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Bumped by every catalog request and every reset; only the newest may publish. */
let catalogGeneration = 0;
/** One in-flight catalog read per client + generation, however many callers ask. */
let catalogInFlight: { client: OpenCode; gen: number; promise: Promise<void> } | null = null;
/** Debounced silent refresh for provider/model/agent config events. */
let catalogEventTimer: ReturnType<typeof setTimeout> | undefined;
/** Bumped by every pending-ask resync and every reset; only the newest may publish. */
let askGeneration = 0;
/** Bumped by every session-list load and every reset; only the newest may publish. */
let sessionGeneration = 0;
/** Bumped whenever busy changes locally (a send, an event) and on reset; an older snapshot must not overwrite it. */
let busyGeneration = 0;
/** Bumped on reset; a timeline read still in flight must not land in a new workspace's store. */
let timelineGeneration = 0;

export const useChat = create<State>((set, get) => ({
  client: null,
  sessions: {},
  sessionsLoaded: false,
  busy: {},
  retrying: {},
  unread: {},
  timelines: {},
  permissions: {},
  forms: {},
  parents: {},
  delegated: {},
  agents: [],
  models: [],
  defaultModel: null,
  pickedModel: null,
  pickedAgent: null,
  homeDir: null,
  projectDir: null,
  brokenModels: [],
  pinned: [],
  agentRowsOpen: [],
  toggleAgentRow(id, open) {
    const cur = get().agentRowsOpen;
    const isOpen = cur.includes(id);
    const want = open ?? !isOpen;
    if (want === isOpen) return;
    const next = want ? [...cur, id] : cur.filter((x) => x !== id);
    set({ agentRowsOpen: next });
    void kv.set(wsKey("chat.agentRowsOpen"), next);
  },
  togglePin(id) {
    const pinned = get().pinned.includes(id) ? get().pinned.filter((p) => p !== id) : [id, ...get().pinned];
    set({ pinned });
    void kv.set(wsKey("chat.pinned"), pinned);
  },
  activeId: null,
  drafts: {},
  delivery: "steer",
  setDeliveryMode(d) {
    set({ delivery: d });
    void kv.set("chat.delivery", d);
  },

  async fork(id, before, draft) {
    const client = get().client;
    if (!client) return null;
    try {
      const s = await client.fork(id, before ?? null);
      set((st) => ({ sessions: { ...st.sessions, [s.id]: s }, drafts: draft ? { ...st.drafts, [s.id]: draft } : st.drafts }));
      get().open(s.id);
      toast({ tone: "ok", title: "Forked", body: s.title });
      return s.id;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't fork", body: (e as Error).message });
      return null;
    }
  },

  async undo(id, messageID) {
    const client = get().client;
    const t = get().timelines[id];
    if (!client || !t) return;
    const users = t.messages.filter((m): m is Extract<UIMessage, { kind: "user" }> => m.kind === "user" && !m.pending);
    const cut = revertIndex(t.messages, get().sessions[id]?.revert);
    const target = messageID ? users.find((u) => u.id === messageID) : [...users].reverse().find((u) => t.messages.indexOf(u) < cut);
    if (!target) {
      toast({ tone: "info", title: "Nothing to undo" });
      return;
    }
    if (get().busy[id]) {
      await client.interrupt(id).catch(() => {});
      // Staging is refused while the run is still winding down.
      for (let i = 0; i < 30 && get().busy[id]; i++) await new Promise((r) => setTimeout(r, 100));
    }
    try {
      const r = await client.revertStage(id, target.id);
      set((st) => ({ sessions: st.sessions[id] ? { ...st.sessions, [id]: { ...st.sessions[id], revert: r.data } } : st.sessions, drafts: { ...st.drafts, [id]: target.text } }));
    } catch (e) {
      toast({ tone: "error", title: "Couldn't undo", body: (e as Error).message });
    }
  },

  async redo(id) {
    const client = get().client;
    const t = get().timelines[id];
    const rev = get().sessions[id]?.revert;
    if (!client || !t || !rev) return;
    const cut = revertIndex(t.messages, rev);
    const next = t.messages.find((m, i) => i > cut && m.kind === "user" && !m.pending);
    try {
      if (next) {
        const r = await client.revertStage(id, next.id);
        set((st) => ({ sessions: { ...st.sessions, [id]: { ...st.sessions[id], revert: r.data } } }));
      } else {
        await client.revertClear(id);
        set((st) => ({ sessions: { ...st.sessions, [id]: { ...st.sessions[id], revert: undefined } }, drafts: { ...st.drafts, [id]: "" } }));
      }
    } catch (e) {
      toast({ tone: "error", title: "Couldn't redo", body: (e as Error).message });
    }
  },

  async compact(id) {
    const client = get().client;
    if (!client) return;
    try {
      await client.compact(id);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't compact", body: (e as Error).message });
    }
  },

  async runShell(id, command) {
    const client = get().client;
    if (!client) return;
    await commitRevert(id);
    await client.shell(id, command);
  },

  async cancelInbox(sid, inboxID) {
    const client = get().client;
    if (!client) return;
    try {
      await client.cancelInbox(sid, inboxID);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't cancel", body: (e as Error).message });
    }
  },

  async setInboxDelivery(sid, inboxID, d) {
    const client = get().client;
    if (!client) return;
    try {
      await client.setInboxDelivery(sid, inboxID, d);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't change", body: (e as Error).message });
    }
  },

  reset() {
    queue = [];
    pendingWhileLoading.clear();
    if (catalogEventTimer) clearTimeout(catalogEventTimer);
    catalogEventTimer = undefined;
    catalogGeneration++;
    askGeneration++;
    sessionGeneration++;
    busyGeneration++;
    timelineGeneration++;
    set({ client: null, sessions: {}, sessionsLoaded: false, sessionsError: undefined, busy: {}, retrying: {}, unread: {}, timelines: {}, permissions: {}, forms: {}, parents: {}, delegated: {}, agents: [], models: [], catalogError: undefined, defaultModel: null, homeDir: null, activeId: null, pickedModel: null, pickedAgent: null, projectDir: null });
  },

  async bootstrap(client) {
    // A newer connection already published its client: it owns the store now.
    if (get().client && get().client !== client) return;
    set({ client });
    // Every write below lands only while this is still the connected client: a
    // bootstrap still in flight when the workspace changed must not put its
    // prefs, catalog or asks into the new one.
    const live = () => get().client === client;
    const prefs = await kv.get<{ model?: ModelRef; agent?: string; projectDir?: string | null }>(wsKey("chat.prefs"));
    if (!live()) return;
    // Always set all three: a workspace with no saved choices must not inherit the last one's (a local path on a cloud machine).
    set({ pickedModel: prefs?.model ?? null, pickedAgent: prefs?.agent && isOfferedAgent(prefs.agent) ? prefs.agent : null, projectDir: prefs?.projectDir ?? null });
    const [brokenModels, pinned, agentRowsOpen, delivery] = await Promise.all([kv.get<string[]>(wsKey("chat.brokenModels")), kv.get<string[]>(wsKey("chat.pinned")), kv.get<string[]>(wsKey("chat.agentRowsOpen")), kv.get<Delivery>("chat.delivery")]);
    if (!live()) return;
    set({ brokenModels: brokenModels ?? [], pinned: pinned ?? [], agentRowsOpen: agentRowsOpen ?? [], delivery: delivery ?? "steer" });

    // Asks are fetched as soon as the session list lands, so they cover every
    // directory a known session works in (see syncAsks): a fresh connection's
    // only view of a project's pending approval or question.
    const busyGen = busyGeneration;
    const sessionsLoad = get().loadSessions().then(() => {
      if (live()) void syncAsks(client);
    });
    const results = await Promise.allSettled([
      sessionsLoad,
      client.location().then((l) => live() && set({ homeDir: l.directory })),
      client.agents().then((agents) => live() && set({ agents })),
      client.models().then((models) => live() && set({ models })),
      client.defaultModel().then((m) => live() && set({ defaultModel: m })),
      client.activeSessions().then((ids) => applyActiveSessions(client, busyGen, ids)),
    ]);
    if (!live()) return;
    const labels = ["sessions", "location", "agents", "models", "default model", "active sessions"];
    let problem: string | undefined;
    results.forEach((r, i) => {
      if (r.status !== "rejected") return;
      console.error(`bootstrap: ${labels[i]} failed`, r.reason);
      // Warmup is expected on a fresh connection and connection readiness owns
      // its retries. Record the reason; never toast from here.
      if ((i === 2 || i === 3) && !problem) problem = String((r.reason as Error | undefined)?.message ?? r.reason ?? "");
    });
    if (problem) set({ catalogError: problem });
    if (import.meta.env.DEV) console.info(`bootstrap: ${Object.keys(get().sessions).length} sessions, ${get().agents.length} agents, ${get().models.length} models, home=${get().homeDir}`);
    const { pickedModel, models, defaultModel } = get();
    if (pickedModel && models.length && !models.some((m) => m.providerID === pickedModel.providerID && m.id === pickedModel.id)) set({ pickedModel: null });
    const defInfo = defaultModel && models.find((m) => m.providerID === defaultModel.providerID && m.id === defaultModel.id);
    if (models.length && (!defInfo || !defInfo.capabilities?.tools)) set({ defaultModel: fallbackModel(models, get().brokenModels) ?? defaultModel });
    // A remembered folder that's gone (deleted, or the machine was rebuilt) would fail the first message: fall back to home.
    const dir = get().projectDir;
    if (dir && dir !== get().homeDir) {
      client.listFolders(dir, get().homeDir).catch((e) => {
        // Only when the machine says it isn't there; a network blip keeps the choice.
        if (e instanceof OpenCodeError && e.status === 404 && get().client === client && get().projectDir === dir) get().setProjectDir(null);
      });
    }
  },

  async refreshCatalog(opts) {
    const client = get().client;
    if (!client) return;
    // Automatic refreshes are quiet by default: the connection owns warmup, and
    // a toast here produced a storm on every reconnect. Only an explicit user
    // action opts into the toast.
    const silent = opts?.silent ?? true;
    // Single-flight: a save, a config event and a resync may all ask at once.
    if (catalogInFlight && catalogInFlight.client === client && catalogInFlight.gen === catalogGeneration) return catalogInFlight.promise;
    // Requests race (a save, a reconnect, a settings screen): an older reply
    // arriving last would put back agents deleted since. Newest wins only.
    const gen = ++catalogGeneration;
    let promise: Promise<void>;
    promise = (async () => {
      const [agents, models] = await Promise.allSettled([client.agents(), client.models()]);
      if (gen !== catalogGeneration || get().client !== client) return;
      // A server still loading its config answers with nothing (readiness owns
      // waiting for it): keep what we have rather than blanking the pickers.
      if (agents.status === "fulfilled" && (agents.value.length || !get().agents.length)) set({ agents: agents.value });
      if (models.status === "fulfilled" && (models.value.length || !get().models.length)) {
        set({ models: models.value });
        if (!get().defaultModel) set({ defaultModel: fallbackModel(models.value, get().brokenModels) });
      }
      const failure = agents.status === "rejected" ? agents : models.status === "rejected" ? models : null;
      if (failure) {
        const message = String((failure as PromiseRejectedResult).reason?.message ?? (failure as PromiseRejectedResult).reason ?? "");
        set({ catalogError: message });
        if (!silent) toast({ tone: "error", title: "Couldn't load models", body: message });
      } else {
        set({ catalogError: undefined });
      }
    })().finally(() => {
      if (catalogInFlight?.promise === promise) catalogInFlight = null;
    });
    catalogInFlight = { client, gen, promise };
    return promise;
  },

  async resync() {
    const client = get().client;
    if (!client) return;
    // Taken before anything else so a send, stop or event that lands anywhere
    // during the resync wins over a run snapshot from before it.
    const busyGen = busyGeneration;
    await get().loadSessions();
    if (get().client !== client) return;
    // The config may have changed while the stream was down (an agent or
    // teammate removed elsewhere); the generation guard keeps this ordered.
    void get().refreshCatalog();
    // Runs that started or ended while the stream was down. The snapshot is
    // dropped if a send or an event changes busy while it is in flight: that
    // local view is newer, and applying the snapshot would clear a run that
    // just started (or keep one that just finished) until the next resync.
    client
      .activeSessions()
      .then((ids) => applyActiveSessions(client, busyGen, ids))
      .catch(() => {});
    // Approvals and questions are location-scoped (the server defaults to its
    // own cwd), so ask for every directory a known session works in as well:
    // one fetch for the default location would miss a project's ask, and the
    // merge would drop it while the server still had it pending.
    void syncAsks(client);
    const id = get().activeId;
    if (id) await get().loadTimeline(id, true);
  },

  /**
   * The stream's first connect can land just after bootstrap. Catch anything
   * that changed between the bootstrap snapshot and the stream going live:
   * asks, running sessions, and the timeline the user has open. Cheap on
   * purpose; a real `resync` is only for reconnects.
   */
  async syncOnConnect() {
    const client = get().client;
    if (!client) return;
    const busyGen = busyGeneration;
    void syncAsks(client);
    try {
      const ids = await client.activeSessions();
      applyActiveSessions(client, busyGen, ids);
    } catch {
      /* bootstrap already reported a failure; this is a catch-up */
    }
    if (get().client !== client) return;
    const id = get().activeId;
    if (!id) return;
    // Already on screen: refresh the last few messages only. A forced full
    // reload here re-downloaded the whole page on every stream connect.
    if (get().timelines[id]?.loaded) await get().loadTail(id);
    else await get().loadTimeline(id);
  },

  async loadSessions() {
    const client = get().client;
    if (!client) return;
    // Overlapping loads (a resync and a bootstrap, two reconnects) must not
    // publish out of order: an older snapshot arriving last would put back a
    // session deleted since, or drop one created meanwhile.
    const gen = ++sessionGeneration;
    const before = get().sessions;
    try {
      const r = await client.sessions({ limit: 150 });
      if (gen !== sessionGeneration || get().client !== client) return;
      const sessions: Record<string, SessionInfo> = {};
      for (const s of r.data) if (!s.time.archived) sessions[s.id] = s;
      // An SSE create, rename or delete may have landed while the snapshot was
      // in flight. Every local change replaces the row, so an untouched row is
      // the same object it was at request time: only those follow the snapshot.
      const now = get().sessions;
      for (const [id, cur] of Object.entries(now)) if (cur !== before[id]) sessions[id] = cur;
      for (const id of Object.keys(before)) if (!now[id]) delete sessions[id];
      set({ sessions, sessionsLoaded: true, sessionsError: undefined });
    } catch (e) {
      if (gen !== sessionGeneration || get().client !== client) return;
      set({ sessionsLoaded: true, sessionsError: (e as Error).message });
    }
  },

  open(id) {
    set((s) => ({ activeId: id, unread: id ? { ...s.unread, [id]: false } : s.unread }));
    if (useUI.getState().view !== "chat") useUI.getState().setView("chat");
    if (id) {
      const t = get().timelines[id];
      if (!t || (!t.loaded && !t.loading)) void get().loadTimeline(id);
      const client = get().client;
      if (client) void client.request("POST", `/api/session/${id}/view`).catch(() => {});
    }
  },

  async loadTimeline(id, force) {
    const client = get().client;
    if (!client) return;
    const cur = get().timelines[id];
    if (cur?.loading) return;
    if (cur?.loaded && !force) return;
    const gen = timelineGeneration;
    pendingWhileLoading.set(id, []);
    set((s) => ({ timelines: { ...s.timelines, [id]: { ...(s.timelines[id] ?? empty()), loading: true, error: undefined } } }));
    try {
      const page = await fetchTimelinePage(client, id, { limit: TIMELINE_PAGE, retryLimit: TIMELINE_TAIL, timeoutMs: TIMELINE_TIMEOUT_MS, order: "desc" });
      if (get().client !== client || gen !== timelineGeneration) return;
      let messages = page.messages;
      // Keep optimistic sends that the server hasn't echoed yet.
      const optimistic = (get().timelines[id]?.messages ?? []).filter((m) => m.kind === "user" && m.pending && m.id.startsWith("local_"));
      messages = [...messages, ...optimistic.filter((o) => !messages.some((m) => m.kind === "user" && m.text === (o as { text: string }).text))];
      for (const e of pendingWhileLoading.get(id) ?? []) {
        if (e.type.endsWith(".delta")) continue; // the snapshot already holds streamed text
        messages = applyEvent(messages, e);
      }
      pendingWhileLoading.delete(id);
      const kids = childSessions(id, messages);
      const doers = childAgents(messages);
      set((s) => ({
        timelines: { ...s.timelines, [id]: { messages, loaded: true, loading: false, older: page.older } },
        parents: Object.keys(kids).every((k) => s.parents[k] === kids[k]) ? s.parents : { ...s.parents, ...kids },
        delegated: Object.keys(doers).every((k) => s.delegated[k] === doers[k]) ? s.delegated : { ...s.delegated, ...doers },
      }));
      void inferChildren(id);
    } catch (e) {
      if (gen === timelineGeneration) pendingWhileLoading.delete(id);
      if (get().client !== client || gen !== timelineGeneration) return;
      // The raw failure (timeout, network, HTTP) is for the console; the user
      // sees something they can act on and a Try again button.
      console.warn(`loadTimeline(${id}) failed`, e);
      set((s) => ({ timelines: { ...s.timelines, [id]: { ...(s.timelines[id] ?? empty()), loading: false, error: TIMELINE_ERROR } } }));
    }
  },

  async loadTail(id) {
    const client = get().client;
    if (!client) return;
    const cur = get().timelines[id];
    // Nothing on screen to merge into yet: this is an initial load.
    if (!cur?.loaded) return get().loadTimeline(id);
    const gen = timelineGeneration;
    try {
      const page = await fetchTimelinePage(client, id, { limit: TIMELINE_TAIL, retryLimit: TIMELINE_TAIL, timeoutMs: TIMELINE_TIMEOUT_MS, order: "desc" });
      // A reconnect or workspace switch while this was in flight: never merge
      // one client's (or session's) tail into another's timeline.
      if (get().client !== client || gen !== timelineGeneration) return;
      // A new turn started while this read was in flight: its live events are
      // newer than the snapshot, so don't replace what is streaming.
      if (get().busy[id]) return;
      const t = get().timelines[id];
      if (!t?.loaded) return;
      const messages = mergeTail(t.messages, page.messages);
      if (messages === t.messages) return;
      const kids = childSessions(id, messages);
      const doers = childAgents(messages);
      set((s) => ({
        timelines: { ...s.timelines, [id]: { ...(s.timelines[id] ?? t), messages } },
        parents: Object.keys(kids).every((k) => s.parents[k] === kids[k]) ? s.parents : { ...s.parents, ...kids },
        delegated: Object.keys(doers).every((k) => s.delegated[k] === doers[k]) ? s.delegated : { ...s.delegated, ...doers },
      }));
      void inferChildren(id);
    } catch {
      // Silent: the conversation is already on screen and events keep it live.
      // A failed refresh is not a failed load.
    }
  },

  async loadOlder(id) {
    const client = get().client;
    const t = get().timelines[id];
    if (!client || !t?.older || t.loading) return;
    const gen = timelineGeneration;
    const cursor = t.older;
    set((s) => ({ timelines: { ...s.timelines, [id]: { ...t, loading: true } } }));
    try {
      const r = await withTimeout((signal) => client.messages(id, { cursor, limit: TIMELINE_OLDER, signal }), TIMELINE_TIMEOUT_MS);
      if (get().client !== client || gen !== timelineGeneration) return;
      const older = projectHistory([...r.data].reverse());
      set((s) => {
        const cur = s.timelines[id] ?? t;
        const ids = new Set(cur.messages.map((m) => m.id));
        return { timelines: { ...s.timelines, [id]: { ...cur, loading: false, messages: [...older.filter((m) => !ids.has(m.id)), ...cur.messages], older: r.cursor?.next ?? null } } };
      });
    } catch {
      if (get().client !== client || gen !== timelineGeneration) return;
      set((s) => ({ timelines: { ...s.timelines, [id]: { ...(s.timelines[id] ?? t), loading: false } } }));
    }
  },

  async send(text, opts) {
    const client = get().client;
    if (!client || !text.trim()) return null;
    let sid = opts?.sessionId ?? null;
    const localId = uid("local_");
    try {
      if (!sid) {
        const model = get().pickedModel ?? get().defaultModel;
        const dir = get().projectDir ?? undefined;
        const s = await client.createSession({ directory: dir, model, agent: get().pickedAgent || undefined });
        sid = s.id;
        set((st) => ({ sessions: { ...st.sessions, [s.id]: s }, timelines: { ...st.timelines, [s.id]: { messages: [], loaded: true, loading: false, older: null } }, activeId: s.id }));
      }
      const id = sid;
      await commitRevert(id);
      if (get().busy[id]) {
        // Mid-run: the server holds it in the inbox (shown above the composer) until the agent reads it.
        await client.prompt(id, { text, delivery: get().delivery });
        return id;
      }
      busyGeneration++;
      set((st) => {
        const t = st.timelines[id] ?? { ...empty(), loaded: true };
        return {
          busy: { ...st.busy, [id]: true },
          timelines: { ...st.timelines, [id]: { ...t, messages: [...t.messages, { kind: "user", id: localId, text, time: Date.now(), pending: true }] } },
        };
      });
      const r = await client.prompt(id, { text });
      const realId = r?.data?.id;
      set((st) => {
        const t = st.timelines[id];
        if (!t) return {};
        // The SSE echo may already have inserted the real message.
        const hasReal = realId && t.messages.some((m) => m.id === realId);
        const messages = hasReal ? t.messages.filter((m) => m.id !== localId) : t.messages.map((m) => (m.id === localId && realId ? { ...m, id: realId } : m));
        return { timelines: { ...st.timelines, [id]: { ...t, messages } } };
      });
      return id;
    } catch (e) {
      const id = sid;
      if (id) {
        busyGeneration++;
        set((st) => {
          const t = st.timelines[id];
          return {
            busy: { ...st.busy, [id]: false },
            timelines: t ? { ...st.timelines, [id]: { ...t, messages: t.messages.filter((m) => m.id !== localId) } } : st.timelines,
          };
        });
      }
      toast({ tone: "error", title: "Message not sent", body: (e as Error).message });
      throw e;
    }
  },

  async interrupt(id) {
    const client = get().client;
    if (!client) return;
    try {
      await client.interrupt(id);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't stop", body: (e as Error).message });
    }
  },

  async background(id) {
    const client = get().client;
    if (!client) return;
    try {
      await client.background(id);
    } catch (e) {
      toast({ tone: "error", title: "Couldn't move it to the background", body: (e as Error).message });
    }
  },

  async stopSubagent(parent, child, description) {
    const client = get().client;
    if (!client) return;
    const note = subagentStopNote(child, description);
    // The note waits for the agent's next turn (resume: false). If the server
    // can't take it (older OpenCode), stop anyway: the user asked to.
    await client.synthetic(parent, { ...note, resume: false }).catch(() => {});
    await get().interrupt(child);
  },

  async remove(id) {
    const client = get().client;
    if (!client) return;
    const prev = get().sessions[id];
    set((s) => {
      const sessions = { ...s.sessions };
      delete sessions[id];
      return { sessions, activeId: s.activeId === id ? null : s.activeId };
    });
    try {
      await client.deleteSession(id);
    } catch (e) {
      // The workspace may have changed while the request was in flight: never
      // put the old row back into the new workspace's list.
      if (prev && get().client === client) set((s) => ({ sessions: { ...s.sessions, [id]: prev } }));
      toast({ tone: "error", title: "Couldn't delete session", body: (e as Error).message });
    }
  },

  async rename(id, title) {
    const client = get().client;
    const prev = get().sessions[id];
    if (!client || !prev) return;
    set((s) => ({ sessions: { ...s.sessions, [id]: { ...prev, title } } }));
    try {
      await client.renameSession(id, title);
    } catch (e) {
      if (get().client === client) set((s) => ({ sessions: { ...s.sessions, [id]: prev } }));
      toast({ tone: "error", title: "Couldn't rename", body: (e as Error).message });
    }
  },

  async setModel(ref, sessionId) {
    set({ pickedModel: ref });
    void savePrefs();
    const client = get().client;
    if (client && sessionId) {
      const prev = get().sessions[sessionId];
      if (prev) set((s) => ({ sessions: { ...s.sessions, [sessionId]: { ...prev, model: ref } } }));
      try {
        await client.switchModel(sessionId, ref);
      } catch (e) {
        if (prev && get().client === client) set((s) => ({ sessions: { ...s.sessions, [sessionId]: prev } }));
        toast({ tone: "error", title: "Couldn't switch model", body: (e as Error).message });
      }
    }
  },

  async setAgent(agent, sessionId) {
    set({ pickedAgent: agent });
    void savePrefs();
    const client = get().client;
    // No agent (null) is only the new-draft state: there's no session to switch.
    if (client && sessionId && agent) {
      const prev = get().sessions[sessionId];
      if (prev) set((s) => ({ sessions: { ...s.sessions, [sessionId]: { ...prev, agent } } }));
      try {
        await client.switchAgent(sessionId, agent);
      } catch (e) {
        if (prev && get().client === client) set((s) => ({ sessions: { ...s.sessions, [sessionId]: prev } }));
        toast({ tone: "error", title: "Couldn't switch agent", body: (e as Error).message });
      }
    }
  },

  setProjectDir(dir) {
    set({ projectDir: dir });
    void savePrefs();
  },

  setDraft(key, text) {
    set((s) => ({ drafts: { ...s.drafts, [key]: text } }));
  },

  async replyPermission(req, reply) {
    const client = get().client;
    if (!client) return;
    set((s) => {
      const permissions = { ...s.permissions };
      delete permissions[req.id];
      return { permissions };
    });
    try {
      await client.replyPermission(req.sessionID, req.id, reply);
    } catch (e) {
      // Already answered: from another window, or a rule you just saved covered it.
      if (e instanceof OpenCodeError && e.status === 404) return;
      if (get().client === client) set((s) => ({ permissions: { ...s.permissions, [req.id]: req } }));
      toast({ tone: "error", title: "Couldn't answer", body: (e as Error).message });
    }
  },

  async replyForm(form, values) {
    const client = get().client;
    if (!client) return;
    set((s) => {
      const forms = { ...s.forms };
      delete forms[form.id];
      return { forms };
    });
    try {
      if (values) await client.replyForm(form.sessionID, form.id, values);
      else await client.cancelForm(form.sessionID, form.id);
    } catch (e) {
      if (get().client === client) set((s) => ({ forms: { ...s.forms, [form.id]: form } }));
      toast({ tone: "error", title: "Couldn't send answer", body: (e as Error).message });
    }
  },

  ingest(e) {
    queue.push(e);
    if (!frame) {
      // rAF pauses while the window is hidden; the timer keeps events (and
      // background notifications) flowing then. Whichever fires first wins.
      frame = requestAnimationFrame(flush);
      fallback = setTimeout(flush, 120);
    }
  },
}));

/**
 * Re-read the server's pending approvals and questions and merge them into the
 * maps, for the default location and every directory a known session works in.
 * Shared by bootstrap (a handoff's question only arrives here) and resync, so
 * both find a project's ask and neither drops one delivered by SSE meanwhile.
 */
function syncAsks(client: OpenCode) {
  const st = useChat.getState();
  const dirs = new Set<string | undefined>([undefined]);
  const dirOf: Record<string, string> = {};
  for (const s of Object.values(st.sessions)) {
    dirOf[s.id] = s.location?.directory ?? "";
    if (s.location?.directory) dirs.add(s.location.directory);
  }
  const before = { permissions: new Set(Object.keys(st.permissions)), forms: new Set(Object.keys(st.forms)) };
  const gen = ++askGeneration;
  const allDirs = [...dirs];
  return Promise.all([fetchAsks(allDirs, (d) => client.pendingPermissions(d)), fetchAsks(allDirs, (d) => client.pendingForms<FormLite>(d))])
    .then(([perms, formAsks]) => {
      if (gen !== askGeneration || useChat.getState().client !== client) return;
      const now = useChat.getState();
      const permissions = mergeAsks(before.permissions, now.permissions, perms, dirOf);
      const forms = mergeAsks(before.forms, now.forms, formAsks, dirOf);
      const patch: Partial<State> = {};
      if (permissions) patch.permissions = permissions;
      if (forms) patch.forms = forms;
      if (patch.permissions || patch.forms) useChat.setState(patch);
      // One entry per ask: a merge keyed by id can't duplicate them.
      learnParents([...(permissions ? Object.values(permissions) : []), ...(forms ? Object.values(forms) : [])].map((a) => a.sessionID));
    })
    .catch(() => {});
}

/** Apply an active-run snapshot unless a send or event changed busy since it was requested. */
function applyActiveSessions(client: OpenCode, gen: number, ids: string[]) {
  if (gen !== busyGeneration || useChat.getState().client !== client) return;
  useChat.setState({ busy: Object.fromEntries(ids.map((id) => [id, true])) });
}

/**
 * Fetch pending asks for each location in parallel. A location whose request
 * failed is left out of `replaced`, so its entries are kept rather than pruned.
 */
async function fetchAsks<T>(dirs: Array<string | undefined>, fetch: (directory?: string) => Promise<T[]>) {
  const results = await Promise.allSettled(dirs.map((d) => fetch(d)));
  const items: T[] = [];
  const replaced = new Set<string>();
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    replaced.add(dirs[i] ?? "");
    items.push(...r.value);
  });
  return { items, replaced };
}

/**
 * Merge freshly fetched asks into the map. An entry is dropped only when a
 * fetch for its directory succeeded and no longer lists it; entries whose
 * directory we don't know (or couldn't fetch) are kept. An ask that arrived
 * while the fetch was in flight survives, and one answered meanwhile isn't
 * put back. Returns null when no fetch succeeded: keep the map untouched.
 */
function mergeAsks<T extends { id: string; sessionID: string }>(
  before: Set<string>,
  now: Record<string, T>,
  fresh: { items: T[]; replaced: Set<string> },
  dirOf: Record<string, string>,
): Record<string, T> | null {
  if (!fresh.replaced.size) return null;
  const next: Record<string, T> = {};
  const listed = new Map(fresh.items.map((a) => [a.id, a]));
  for (const [id, ask] of Object.entries(now)) {
    if (listed.has(id)) continue;
    // Arrived while the fetch was in flight: the snapshot can predate it.
    if (!before.has(id)) {
      next[id] = ask;
      continue;
    }
    const dir = dirOf[ask.sessionID];
    if (dir !== undefined && fresh.replaced.has(dir)) continue;
    next[id] = ask;
  }
  for (const [id, ask] of listed) {
    if (!now[id] && before.has(id)) continue;
    next[id] = ask;
  }
  return next;
}

/**
 * Per-workspace on-device key. Model lists, agents and folders differ per
 * server, so a choice made on one workspace must not leak into another.
 */
export function wsKey(base: string) {
  return `${base}.${useWorkspaces.getState().activeId ?? "none"}`;
}

async function savePrefs() {
  const s = useChat.getState();
  await kv.set(wsKey("chat.prefs"), { model: s.pickedModel, agent: s.pickedAgent, projectDir: s.projectDir });
}

function markBroken(model: { providerID: string; id: string }) {
  const key = modelKey(model);
  const st = useChat.getState();
  if (st.brokenModels.includes(key)) return;
  const brokenModels = [...st.brokenModels, key];
  const patch: Partial<State> = { brokenModels };
  if (st.defaultModel && modelKey(st.defaultModel) === key) patch.defaultModel = fallbackModel(st.models, brokenModels);
  if (st.pickedModel && modelKey(st.pickedModel) === key) patch.pickedModel = null;
  useChat.setState(patch);
  void kv.set(wsKey("chat.brokenModels"), brokenModels);
  toast({ tone: "info", title: "That model is no longer available", body: "Pick another model from the model menu — it's been hidden." });
}

function scheduleReconcile(id: string) {
  const prev = reconcileTimers.get(id);
  if (prev) clearTimeout(prev);
  reconcileTimers.set(
    id,
    setTimeout(() => {
      reconcileTimers.delete(id);
      const t = useChat.getState().timelines[id];
      // The finished turn is already on screen from its events; only the tail
      // can have drifted. Re-reading the whole page here cost tens of MB.
      if (t?.loaded) void useChat.getState().loadTail(id);
    }, 400),
  );
}

/**
 * A provider/model/agent config event arrives in bursts. Refresh once, quietly,
 * and only for the client that was connected when the event landed: a
 * workspace switch during the debounce must not pull one machine's catalog
 * into another.
 */
function scheduleCatalogRefresh(client: OpenCode | null) {
  if (!client) return;
  if (catalogEventTimer) clearTimeout(catalogEventTimer);
  catalogEventTimer = setTimeout(() => {
    catalogEventTimer = undefined;
    const st = useChat.getState();
    if (st.client !== client) return;
    void st.refreshCatalog({ silent: true });
  }, 400);
}

/** Index of the first hidden message when an undo is staged (messages.length when none). */
export function revertIndex(messages: UIMessage[], revert?: SessionRevert | { messageID: string }): number {
  if (!revert) return messages.length;
  const i = messages.findIndex((m) => m.id === revert.messageID);
  return i < 0 ? messages.length : i;
}

/** Sending after an undo makes it permanent (like OpenCode's TUI). */
async function commitRevert(id: string) {
  const st = useChat.getState();
  if (!st.client || !st.sessions[id]?.revert) return;
  // Local state can lag behind (e.g. right after interrupting a run); only commit what the server has staged.
  const live = await st.client.session(id).catch(() => null);
  if (!live?.revert) {
    useChat.setState((x) => ({ sessions: { ...x.sessions, [id]: { ...x.sessions[id], revert: undefined } } }));
    return;
  }
  await st.client.revertCommit(id).catch(() => {});
  useChat.setState((x) => ({ sessions: { ...x.sessions, [id]: { ...x.sessions[id], revert: undefined } } }));
  void useChat.getState().loadTimeline(id, true);
}

function flush() {
  if (frame) cancelAnimationFrame(frame);
  clearTimeout(fallback);
  frame = 0;
  const events = queue;
  queue = [];
  if (!events.length) return;
  const st = useChat.getState();
  let { sessions, busy, retrying, unread, timelines, permissions, forms, parents, delegated } = st;
  const touched = { sessions: false, busy: false, retrying: false, unread: false, timelines: false, permissions: false, forms: false, parents: false, delegated: false };
  const finished: string[] = [];
  const alerts: Parameters<typeof dispatchAlerts>[0] = [];
  // Alerts for a subagent's asks open (and are named after) the chat the user started.
  const rootID = (id: string) => rootSession(parents, id);
  const titleOf = (id?: string) => (id && sessions[rootID(id)]?.title) || "Untitled session";
  const unknown: string[] = [];

  const mut = <K extends keyof typeof touched>(k: K) => {
    if (!touched[k]) {
      touched[k] = true;
      if (k === "sessions") sessions = { ...sessions };
      if (k === "busy") busy = { ...busy };
      if (k === "retrying") retrying = { ...retrying };
      if (k === "unread") unread = { ...unread };
      if (k === "timelines") timelines = { ...timelines };
      if (k === "permissions") permissions = { ...permissions };
      if (k === "forms") forms = { ...forms };
      if (k === "parents") parents = { ...parents };
      if (k === "delegated") delegated = { ...delegated };
    }
  };

  const settled: ToolSettled[] = [];
  for (const e of events) {
    // Provider keys, model availability and agent definitions changed: the
    // catalog is stale. One quiet refresh after a burst (a save writes several).
    if (e.type === "model.updated" || e.type === "provider.updated" || e.type === "agent.updated") scheduleCatalogRefresh(st.client);
    const d = (e as { data?: Record<string, unknown> }).data ?? {};
    const sid = eventSessionID(e);
    if (e.type === "session.tool.success" && sid && toolListeners.size) {
      const block = timelines[sid]?.messages.flatMap((m) => ("blocks" in m ? m.blocks : [])).find((b) => b.kind === "tool" && b.id === d.id);
      settled.push({ sessionId: sid, name: block?.kind === "tool" ? block.name : undefined, metadata: d.metadata as Record<string, unknown> | undefined });
    }
    switch (e.type) {
      case "session.created": {
        if (d.parentID) {
          // Subagent sessions stay out of the main list; remember whose they are.
          mut("parents");
          parents[d.sessionID as string] = d.parentID as string;
          if (typeof d.agent === "string") {
            mut("delegated");
            delegated[d.sessionID as string] = d.agent;
          }
          break;
        }
        mut("sessions");
        const id = d.sessionID as string;
        sessions[id] = sessions[id] ?? ({
          id,
          projectID: d.projectID as string,
          title: d.title as string | undefined,
          agent: d.agent as string | undefined,
          model: d.model as SessionInfo["model"],
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: e.created ?? Date.now(), updated: e.created ?? Date.now() },
          location: { directory: (d.location as { directory?: string })?.directory ?? "" },
        } as SessionInfo);
        break;
      }
      case "session.renamed":
        if (sid && sessions[sid]) {
          mut("sessions");
          sessions[sid] = { ...sessions[sid], title: d.title as string };
        }
        break;
      case "session.deleted":
        if (sid && sessions[sid]) {
          mut("sessions");
          delete sessions[sid];
        }
        break;
      case "session.revert.staged":
        if (sid && sessions[sid]) {
          mut("sessions");
          sessions[sid] = { ...sessions[sid], revert: d.revert as SessionInfo["revert"] };
        }
        break;
      case "session.revert.cleared":
      case "session.revert.committed":
        if (sid && sessions[sid]) {
          mut("sessions");
          sessions[sid] = { ...sessions[sid], revert: undefined };
          if (e.type === "session.revert.committed") finished.push(sid);
        }
        break;
      case "session.forked": {
        const id = d.sessionID as string;
        if (id && !sessions[id]) void st.client?.session(id).then((s) => useChat.setState((x) => ({ sessions: { ...x.sessions, [s.id]: s } }))).catch(() => {});
        break;
      }
      case "session.usage.updated":
        if (sid && sessions[sid]) {
          mut("sessions");
          sessions[sid] = { ...sessions[sid], cost: d.cost as number, tokens: d.tokens as SessionInfo["tokens"] };
        }
        break;
      case "session.model.selected":
        if (sid && sessions[sid]) {
          mut("sessions");
          sessions[sid] = { ...sessions[sid], model: d.model as SessionInfo["model"] };
        }
        break;
      case "session.agent.selected":
        if (sid && sessions[sid]) {
          mut("sessions");
          sessions[sid] = { ...sessions[sid], agent: d.agent as string };
        }
        break;
      case "session.execution.started":
        if (sid) {
          mut("busy");
          busy[sid] = true;
          if (sessions[sid]) {
            mut("sessions");
            sessions[sid] = { ...sessions[sid], time: { ...sessions[sid].time, updated: e.created ?? Date.now() } };
          }
        }
        break;
      case "session.execution.succeeded":
      case "session.execution.failed":
      case "session.execution.interrupted":
        if (sid) {
          mut("busy");
          busy[sid] = false;
          mut("retrying");
          retrying[sid] = undefined;
          finished.push(sid);
          if (sid !== st.activeId) {
            mut("unread");
            unread[sid] = true;
          }
          if (sessions[sid]) {
            mut("sessions");
            sessions[sid] = {
              ...sessions[sid],
              outcome: e.type === "session.execution.succeeded" ? "succeeded" : e.type === "session.execution.failed" ? "failed" : "interrupted",
              time: { ...sessions[sid].time, updated: e.created ?? Date.now() },
            };
          }
          // A delegated part finishing isn't your turn: the lead carries on and reports for it.
          if (!parents[sid] && e.type === "session.execution.succeeded") alerts.push({ kind: "finished", sessionId: sid, title: titleOf(sid), body: "Finished. Your turn." });
          else if (!parents[sid] && e.type === "session.execution.failed") {
            const msg = ((d.error as { message?: string } | undefined)?.message ?? "").split("\n")[0].trim();
            alerts.push({ kind: "failed", sessionId: sid, title: titleOf(sid), body: msg ? `Stopped: ${msg.length > 120 ? `${msg.slice(0, 118)}…` : msg}` : "Stopped with an error." });
          }
          if (e.type === "session.execution.failed") {
            const err = d.error as { status?: number; message?: string } | undefined;
            const model = sessions[sid]?.model;
            if (model && (err?.status === 410 || /deprecated|no longer (available|supported)/i.test(err?.message ?? ""))) markBroken(model);
          }
          if (e.type === "session.execution.failed" && timelines[sid]?.loaded) {
            const err = (d.error as { message?: string })?.message;
            const t = timelines[sid];
            const last = [...t.messages].reverse().find((m) => m.kind === "assistant");
            if (err && !(last && last.kind === "assistant" && last.error)) {
              mut("timelines");
              timelines[sid] = { ...t, messages: [...t.messages, { kind: "notice", id: (e as { id: string }).id, tone: "error", text: err, time: e.created ?? Date.now() }] };
            }
          }
        }
        break;
      case "session.status":
        if (sid) {
          const status = d.status as { type: string; attempt?: number; message?: string; next?: number };
          mut("retrying");
          retrying[sid] = status.type === "retry" ? { attempt: status.attempt ?? 1, message: status.message ?? "", next: status.next ?? 0 } : undefined;
          if (status.type === "busy" || status.type === "retry") {
            mut("busy");
            busy[sid] = true;
          }
        }
        break;
      case "session.tool.called":
      case "session.tool.progress":
      case "session.tool.success": {
        // A subagent call names its child session in its metadata.
        const child = (d.metadata as { sessionID?: unknown } | undefined)?.sessionID;
        if (sid && typeof child === "string" && child !== sid && parents[child] !== sid) {
          mut("parents");
          parents[child] = sid;
        }
        if (sid && typeof child === "string" && child !== sid && !delegated[child]) {
          const block = timelines[sid]?.messages.flatMap((m) => ("blocks" in m ? m.blocks : [])).find((b) => b.kind === "tool" && b.id === d.id);
          const agent = block?.kind === "tool" ? (block.input as { agent?: unknown } | undefined)?.agent : undefined;
          if (typeof agent === "string") {
            mut("delegated");
            delegated[child] = agent;
          }
        }
        break;
      }
      case "permission.asked":
        if (!sessions[d.sessionID as string] && !parents[d.sessionID as string]) unknown.push(d.sessionID as string);
        alerts.push({ kind: "permission", sessionId: rootID(d.sessionID as string), title: titleOf(d.sessionID as string), body: `Waiting for approval · ${permissionLine(d as unknown as PermissionRequestLite)}` });
        mut("permissions");
        permissions[d.id as string] = d as unknown as PermissionRequestLite;
        break;
      case "permission.replied":
        mut("permissions");
        delete permissions[d.requestID as string];
        break;
      case "form.created": {
        const f = d.form as FormLite;
        if (!sessions[f.sessionID] && !parents[f.sessionID]) unknown.push(f.sessionID);
        alerts.push({ kind: "question", sessionId: rootID(f.sessionID), title: titleOf(f.sessionID), body: `Has a question · ${f.title}` });
        mut("forms");
        forms[f.id] = f;
        break;
      }
      case "form.replied":
      case "form.cancelled":
        mut("forms");
        delete forms[d.id as string];
        break;
    }

    // Timeline projection
    if (sid) {
      const pending = pendingWhileLoading.get(sid);
      if (pending) pending.push(e);
      const t = timelines[sid];
      if (t?.loaded) {
        const next = applyEvent(t.messages, e);
        if (next !== t.messages) {
          mut("timelines");
          timelines[sid] = { ...t, messages: next };
        }
      }
    }
  }

  const patch: Partial<State> = {};
  if (touched.sessions) patch.sessions = sessions;
  if (touched.busy) patch.busy = busy;
  if (touched.retrying) patch.retrying = retrying;
  if (touched.unread) patch.unread = unread;
  if (touched.timelines) patch.timelines = timelines;
  if (touched.permissions) patch.permissions = permissions;
  if (touched.forms) patch.forms = forms;
  if (touched.parents) patch.parents = parents;
  if (touched.delegated) patch.delegated = delegated;
  useChat.setState(patch);
  // A run snapshot requested before this event must not override it.
  if (touched.busy) busyGeneration++;
  if (unknown.length) learnParents(unknown);
  for (const id of finished) scheduleReconcile(id);
  if (alerts.length) dispatchAlerts(alerts);
  for (const t of settled) for (const fn of toolListeners) fn(t);
}

export interface ToolSettled {
  sessionId: string;
  /** Unknown when the session's timeline isn't loaded. */
  name?: string;
  metadata?: Record<string, unknown>;
}
const toolListeners = new Set<(t: ToolSettled) => void>();
/** Hear about every tool call that finishes, in any session. Returns an unsubscribe. */
export function onToolSettled(fn: (t: ToolSettled) => void) {
  toolListeners.add(fn);
  return () => void toolListeners.delete(fn);
}

/**
 * When the server has no default model yet (fresh sandbox, no keys), pick a
 * free tool-capable model so the very first prompt just works.
 */
function fallbackModel(models: ModelInfo[], broken: string[] = []): ModelRef | null {
  const usable = models.filter((m) => m.status !== "deprecated" && m.enabled !== false && m.capabilities?.tools && !broken.includes(modelKey(m)));
  const free = usable.filter((m) => m.providerID === "opencode" && /-free$/.test(m.id)).sort((a, b) => b.time.released - a.time.released);
  const pick = free[0] ?? usable.sort((a, b) => b.time.released - a.time.released)[0];
  return pick ? { providerID: pick.providerID, id: pick.id } : null;
}

// ---------------------------------------------------------------------------
// Subagent sessions
// ---------------------------------------------------------------------------

/** Child sessions a timeline's subagent calls point at. */
function childSessions(parent: string, messages: UIMessage[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of messages) {
    if (m.kind === "subagent" && m.childID) out[m.childID] = parent;
    if (m.kind !== "assistant") continue;
    for (const b of m.blocks) {
      const child = b.kind === "tool" ? b.metadata?.sessionID ?? b.metadata?.sessionId : undefined;
      if (typeof child === "string" && child !== parent) out[child] = parent;
    }
  }
  return out;
}

/** Child session → the agent its subagent call went to. */
function childAgents(messages: UIMessage[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of messages) {
    if (m.kind === "subagent" && m.childID && m.agent) out[m.childID] = m.agent;
    if (m.kind !== "assistant") continue;
    for (const b of m.blocks) {
      if (b.kind !== "tool") continue;
      const child = b.metadata?.sessionID ?? b.metadata?.sessionId;
      const agent = (b.input as { agent?: unknown } | undefined)?.agent;
      if (typeof child === "string" && typeof agent === "string") out[child] = agent;
    }
  }
  return out;
}

/**
 * A running subagent call names its child session only in live progress
 * events, so a snapshot taken mid-run (reload, reconnect) lacks it. Find it
 * among the session's children: created after the call started, by the same
 * agent, titled with the call's description, and not claimed by another call.
 */
async function inferChildren(parent: string) {
  const { client, timelines } = useChat.getState();
  const open: ToolBlock[] = [];
  const claimed = new Set<string>();
  for (const m of timelines[parent]?.messages ?? []) {
    if (m.kind !== "assistant") continue;
    for (const b of m.blocks) {
      if (b.kind !== "tool" || toolKind(b.name) !== "subagent") continue;
      const s = subagentOf(b);
      if (s.childID) claimed.add(s.childID);
      else if (b.status === "running" || b.status === "streaming") open.push(b);
    }
  }
  if (!client || !open.length) return;
  const kids = await client.sessions({ parentID: parent, limit: 50 }).then((r) => r.data).catch(() => []);
  const found: Record<string, string> = {};
  for (const b of open) {
    const s = subagentOf(b);
    const match = kids
      .filter((k) => !claimed.has(k.id) && k.time.created >= b.started - 2000 && (!s.agent || !k.agent || k.agent === s.agent) && (!s.description || !k.title || k.title === s.description))
      .sort((x, y) => x.time.created - y.time.created)[0];
    if (!match) continue;
    claimed.add(match.id);
    found[b.id] = match.id;
  }
  if (!Object.keys(found).length) return;
  useChat.setState((st) => {
    const t = st.timelines[parent];
    if (!t) return {};
    const messages = t.messages.map((m) =>
      m.kind !== "assistant" || !m.blocks.some((b) => b.kind === "tool" && found[b.id])
        ? m
        : { ...m, blocks: m.blocks.map((b) => (b.kind === "tool" && found[b.id] && !b.metadata?.sessionID ? { ...b, metadata: { ...(b.metadata ?? {}), sessionID: found[b.id] } } : b)) },
    );
    const parents = { ...st.parents };
    for (const c of Object.values(found)) parents[c] = parent;
    const delegated = { ...st.delegated };
    for (const k of kids) if (k.agent && Object.values(found).includes(k.id)) delegated[k.id] = k.agent;
    return { timelines: { ...st.timelines, [parent]: { ...t, messages } }, parents, delegated };
  });
}

const asked = new Set<string>();

/** Ask the server who owns sessions we only know from an ask (e.g. after a restart mid-subagent). */
function learnParents(ids: string[]) {
  const { client, sessions, parents } = useChat.getState();
  if (!client) return;
  for (const id of new Set(ids)) {
    if (!id || sessions[id] || parents[id] || asked.has(id)) continue;
    asked.add(id);
    void client
      .session(id)
      .then((s) => {
        if (s.parentID) useChat.setState((x) => ({ parents: { ...x.parents, [id]: s.parentID! } }));
      })
      .catch(() => asked.delete(id));
  }
}

/** The top-level session a (possibly nested) subagent session belongs to. */
export function rootSession(parents: Record<string, string>, id: string): string {
  let cur = id;
  for (let i = 0; i < 8 && parents[cur]; i++) cur = parents[cur];
  return cur;
}

/** Whether an ask from `askSession` belongs in `sessionId`'s chat (its own, or one of its subagents'). */
export function asksFor(parents: Record<string, string>, askSession: string, sessionId: string) {
  let cur: string | undefined = askSession;
  for (let i = 0; i < 9 && cur; i++, cur = parents[cur]) if (cur === sessionId) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function sortedSessions(sessions: Record<string, SessionInfo>): SessionInfo[] {
  return Object.values(sessions).sort((a, b) => b.time.updated - a.time.updated);
}

function modelKey(m: { providerID: string; id: string }) {
  return `${m.providerID}/${m.id}`;
}

// Stores hold live connections; a hot swap would orphan them. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());

