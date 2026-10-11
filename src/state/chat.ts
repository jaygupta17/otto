/**
 * Sessions, timelines, catalog (agents/models) and pending asks for the
 * connected server. Live events are batched per animation frame so a fast
 * token stream costs one React commit per frame, not one per token.
 */
import { create } from "zustand";
import type { AgentInfo, ModelInfo, SessionInfo, V2Event } from "@opencode/client";
import { OpenCode, type ModelRef, type PermissionRequestLite, type SessionRevert } from "../lib/opencode/client";
import { applyEvent, eventSessionID, projectHistory, type Delivery, type UIMessage } from "../lib/opencode/projection";
import { uid } from "../lib/id";
import { kv } from "../lib/kv";
import { useWorkspaces } from "./workspaces";
import { toast, useUI } from "./ui";
import { appInBackground, notify } from "../lib/notify";

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
  fields: Array<Record<string, unknown> & { key: string; type: string; title?: string; description?: string; options?: { value: string; label?: string }[]; required?: boolean; default?: unknown; placeholder?: string }>;
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
  agents: AgentInfo[];
  models: ModelInfo[];
  defaultModel: ModelRef | null;
  pickedModel: ModelRef | null;
  pickedAgent: string;
  homeDir: string | null;
  projectDir: string | null;
  /** Models the server rejected as deprecated/removed; hidden from pickers. */
  brokenModels: string[];
  /** Pinned session ids for this workspace (on-device). */
  pinned: string[];
  togglePin(id: string): void;
  refreshCatalog(): Promise<void>;
  activeId: string | null;
  drafts: Record<string, string>;

  reset(): void;
  bootstrap(client: OpenCode): Promise<void>;
  resync(): Promise<void>;
  loadSessions(): Promise<void>;
  open(id: string | null): void;
  loadTimeline(id: string, force?: boolean): Promise<void>;
  loadOlder(id: string): Promise<void>;
  send(text: string, opts?: { sessionId?: string | null }): Promise<string | null>;
  interrupt(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  setModel(ref: ModelRef, sessionId?: string | null): Promise<void>;
  setAgent(agent: string, sessionId?: string | null): Promise<void>;
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

let queue: V2Event[] = [];
let frame = 0;
let fallback: ReturnType<typeof setTimeout> | undefined;
/** Events that arrived while a timeline was loading; applied after the REST snapshot. */
const pendingWhileLoading = new Map<string, V2Event[]>();
const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
  agents: [],
  models: [],
  defaultModel: null,
  pickedModel: null,
  pickedAgent: "build",
  homeDir: null,
  projectDir: null,
  brokenModels: [],
  pinned: [],
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
    set({ client: null, sessions: {}, sessionsLoaded: false, sessionsError: undefined, busy: {}, retrying: {}, unread: {}, timelines: {}, permissions: {}, forms: {}, agents: [], models: [], defaultModel: null, homeDir: null, activeId: null });
  },

  async bootstrap(client) {
    set({ client });
    const prefs = await kv.get<{ model?: ModelRef; agent?: string; projectDir?: string | null }>(wsKey("chat.prefs"));
    if (prefs) set({ pickedModel: prefs.model ?? null, pickedAgent: prefs.agent ?? "build", projectDir: prefs.projectDir ?? null });
    set({ brokenModels: (await kv.get<string[]>(wsKey("chat.brokenModels"))) ?? [], pinned: (await kv.get<string[]>(wsKey("chat.pinned"))) ?? [], delivery: (await kv.get<Delivery>("chat.delivery")) ?? "steer" });

    const results = await Promise.allSettled([
      get().loadSessions(),
      client.location().then((l) => set({ homeDir: l.directory })),
      client.agents().then((agents) => set({ agents })),
      client.models().then((models) => set({ models })),
      client.defaultModel().then((m) => set({ defaultModel: m })),
      client.pendingPermissions().then((list) => set({ permissions: Object.fromEntries(list.map((p) => [p.id, p])) })),
      client.request<Record<string, unknown>>("GET", "/api/session/active").then((active) => {
        const busy: Record<string, boolean> = {};
        for (const k of Object.keys(active ?? {})) busy[k] = true;
        set({ busy });
      }),
    ]);
    const labels = ["sessions", "location", "agents", "models", "default model", "permissions", "active sessions"];
    results.forEach((r, i) => {
      if (r.status === "rejected") console.error(`bootstrap: ${labels[i]} failed`, r.reason);
    });
    const failed = results.map((r, i) => (r.status === "rejected" && (i === 2 || i === 3) ? labels[i] : null)).filter(Boolean);
    if (failed.length) toast({ tone: "error", title: `Couldn't load ${failed.join(" and ")}`, body: String((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason?.message ?? "") });
    if (import.meta.env.DEV) console.info(`bootstrap: ${Object.keys(get().sessions).length} sessions, ${get().agents.length} agents, ${get().models.length} models, home=${get().homeDir}`);
    const { pickedModel, models, defaultModel } = get();
    if (pickedModel && models.length && !models.some((m) => m.providerID === pickedModel.providerID && m.id === pickedModel.id)) set({ pickedModel: null });
    const defInfo = defaultModel && models.find((m) => m.providerID === defaultModel.providerID && m.id === defaultModel.id);
    if (models.length && (!defInfo || !defInfo.capabilities?.tools)) set({ defaultModel: fallbackModel(models, get().brokenModels) ?? defaultModel });
  },

  async refreshCatalog() {
    const client = get().client;
    if (!client) return;
    const [agents, models] = await Promise.allSettled([client.agents(), client.models()]);
    if (agents.status === "fulfilled") set({ agents: agents.value });
    if (models.status === "fulfilled") {
      set({ models: models.value });
      if (!get().defaultModel) set({ defaultModel: fallbackModel(models.value, get().brokenModels) });
    }
    if (agents.status === "rejected" || models.status === "rejected") {
      toast({ tone: "error", title: "Couldn't load models", body: String(((agents.status === "rejected" ? agents : models) as PromiseRejectedResult).reason?.message ?? "") });
    }
  },

  async resync() {
    const client = get().client;
    if (!client) return;
    await get().loadSessions();
    if (!get().agents.length || !get().models.length) void get().refreshCatalog();
    client
      .request<Record<string, unknown>>("GET", "/api/session/active")
      .then((active) => {
        const busy: Record<string, boolean> = {};
        for (const k of Object.keys(active ?? {})) busy[k] = true;
        set({ busy });
      })
      .catch(() => {});
    const id = get().activeId;
    if (id) await get().loadTimeline(id, true);
  },

  async loadSessions() {
    const client = get().client;
    if (!client) return;
    try {
      const r = await client.sessions({ limit: 150 });
      const sessions: Record<string, SessionInfo> = {};
      for (const s of r.data) if (!s.time.archived) sessions[s.id] = s;
      set({ sessions, sessionsLoaded: true, sessionsError: undefined });
    } catch (e) {
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
    pendingWhileLoading.set(id, []);
    set((s) => ({ timelines: { ...s.timelines, [id]: { ...(s.timelines[id] ?? empty()), loading: true, error: undefined } } }));
    try {
      const [r, inbox] = await Promise.all([client.messages(id, { limit: 120, order: "desc" }), client.inbox(id).catch(() => [])]);
      let messages = projectHistory([...r.data].reverse());
      // Messages sent during a run that the agent hasn't read yet.
      for (const it of inbox) if (it.type === "user") messages.push({ kind: "user", id: it.id, text: it.payload.text ?? "", time: it.time.created, pending: true, delivery: it.delivery });
      // Keep optimistic sends that the server hasn't echoed yet.
      const optimistic = (get().timelines[id]?.messages ?? []).filter((m) => m.kind === "user" && m.pending && m.id.startsWith("local_"));
      messages = [...messages, ...optimistic.filter((o) => !messages.some((m) => m.kind === "user" && m.text === (o as { text: string }).text))];
      for (const e of pendingWhileLoading.get(id) ?? []) {
        if (e.type.endsWith(".delta")) continue; // the snapshot already holds streamed text
        messages = applyEvent(messages, e);
      }
      pendingWhileLoading.delete(id);
      set((s) => ({ timelines: { ...s.timelines, [id]: { messages, loaded: true, loading: false, older: r.cursor.next ?? null } } }));
    } catch (e) {
      pendingWhileLoading.delete(id);
      set((s) => ({ timelines: { ...s.timelines, [id]: { ...(s.timelines[id] ?? empty()), loading: false, error: (e as Error).message } } }));
    }
  },

  async loadOlder(id) {
    const client = get().client;
    const t = get().timelines[id];
    if (!client || !t?.older || t.loading) return;
    set((s) => ({ timelines: { ...s.timelines, [id]: { ...t, loading: true } } }));
    try {
      const r = await client.messages(id, { cursor: t.older, limit: 120 });
      const older = projectHistory([...r.data].reverse());
      set((s) => {
        const cur = s.timelines[id] ?? t;
        const ids = new Set(cur.messages.map((m) => m.id));
        return { timelines: { ...s.timelines, [id]: { ...cur, loading: false, messages: [...older.filter((m) => !ids.has(m.id)), ...cur.messages], older: r.cursor.next ?? null } } };
      });
    } catch {
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
      if (prev) set((s) => ({ sessions: { ...s.sessions, [id]: prev } }));
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
      set((s) => ({ sessions: { ...s.sessions, [id]: prev } }));
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
        if (prev) set((s) => ({ sessions: { ...s.sessions, [sessionId]: prev } }));
        toast({ tone: "error", title: "Couldn't switch model", body: (e as Error).message });
      }
    }
  },

  async setAgent(agent, sessionId) {
    set({ pickedAgent: agent });
    void savePrefs();
    const client = get().client;
    if (client && sessionId) {
      const prev = get().sessions[sessionId];
      if (prev) set((s) => ({ sessions: { ...s.sessions, [sessionId]: { ...prev, agent } } }));
      try {
        await client.switchAgent(sessionId, agent);
      } catch (e) {
        if (prev) set((s) => ({ sessions: { ...s.sessions, [sessionId]: prev } }));
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
      set((s) => ({ permissions: { ...s.permissions, [req.id]: req } }));
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
      set((s) => ({ forms: { ...s.forms, [form.id]: form } }));
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
 * Per-workspace on-device key. Model lists, agents and folders differ per
 * server, so a choice made on one workspace must not leak into another.
 */
function wsKey(base: string) {
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
      if (t?.loaded) void useChat.getState().loadTimeline(id, true);
    }, 400),
  );
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
  let { sessions, busy, retrying, unread, timelines, permissions, forms } = st;
  const touched = { sessions: false, busy: false, retrying: false, unread: false, timelines: false, permissions: false, forms: false };
  const finished: string[] = [];
  const alerts: { title: string; body?: string }[] = [];
  const titleOf = (id?: string) => (id && sessions[id]?.title) || "Your session";

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
    }
  };

  for (const e of events) {
    const d = (e as { data?: Record<string, unknown> }).data ?? {};
    const sid = eventSessionID(e);
    switch (e.type) {
      case "session.created": {
        if (d.parentID) break; // subagent sessions stay out of the main list
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
          if (e.type !== "session.execution.interrupted") alerts.push({ title: e.type === "session.execution.succeeded" ? "Agent finished" : "Agent hit a problem", body: titleOf(sid) });
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
      case "permission.asked":
        alerts.push({ title: "Agent needs your approval", body: `${titleOf(d.sessionID as string)} · ${d.action as string}` });
        mut("permissions");
        permissions[d.id as string] = d as unknown as PermissionRequestLite;
        break;
      case "permission.replied":
        mut("permissions");
        delete permissions[d.requestID as string];
        break;
      case "form.created": {
        const f = d.form as FormLite;
        alerts.push({ title: "Agent has a question", body: f.title });
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
  useChat.setState(patch);
  for (const id of finished) scheduleReconcile(id);
  if (alerts.length && useUI.getState().notify && appInBackground()) {
    const a = alerts[alerts.length - 1];
    void notify(a.title, alerts.length > 1 ? `${a.body ?? ""} (+${alerts.length - 1} more)` : a.body);
  }
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

if (import.meta.env.DEV) (window as unknown as { __chat: typeof useChat }).__chat = useChat;
