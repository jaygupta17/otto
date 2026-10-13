/**
 * Alerts from agents: finished, failed, waiting on approval or an answer.
 *
 * Where one goes depends on where you are:
 *   - looking at that session        nothing (you can see it)
 *   - in Otto, somewhere else        a toast with "Open", and the inbox
 *   - Otto in the background         a system notification, and the inbox
 *
 * Alerts come from the event stream, so a phone only gets them while Otto
 * is running (in the foreground or recently backgrounded). Push while the
 * app is closed would need a server to send them.
 */
import { create } from "zustand";
import { kv } from "../lib/kv";
import { appInBackground, initNotifications, notify, notifyPermission, requestNotifyPermission } from "../lib/notify";
import { useChat } from "./chat";
import { useUI } from "./ui";

export type AlertKind = "finished" | "failed" | "permission" | "question";

export interface AgentAlert {
  id: string;
  kind: AlertKind;
  sessionId?: string;
  title: string;
  body?: string;
  time: number;
  read: boolean;
}

export interface NotifyPrefs {
  /** System notifications while Otto is in the background. */
  system: boolean;
  /** In-app toasts for other sessions. */
  toasts: boolean;
  kinds: Record<AlertKind, boolean>;
}

const DEFAULT_PREFS: NotifyPrefs = { system: true, toasts: true, kinds: { finished: true, failed: true, permission: true, question: true } };
const MAX = 50;

interface State {
  items: AgentAlert[];
  prefs: NotifyPrefs;
  setPrefs(p: Partial<NotifyPrefs>): void;
  markRead(sessionId?: string): void;
  clear(): void;
}

export const useNotifications = create<State>((set, get) => ({
  items: [],
  prefs: DEFAULT_PREFS,
  setPrefs(p) {
    const prefs = { ...get().prefs, ...p, kinds: { ...get().prefs.kinds, ...p.kinds } };
    set({ prefs });
    void kv.set("notify.prefs", prefs);
  },
  markRead(sessionId) {
    const items = get().items;
    if (!items.some((a) => !a.read && (!sessionId || a.sessionId === sessionId))) return;
    set({ items: items.map((a) => (!sessionId || a.sessionId === sessionId ? { ...a, read: true } : a)) });
  },
  clear() {
    set({ items: [] });
  },
}));

export const unreadCount = (s: State) => s.items.reduce((n, a) => n + (a.read ? 0 : 1), 0);

let seq = 0;
let asked = false;

/** Called by the event stream with the alerts from one batch of events. */
export function dispatchAlerts(alerts: Omit<AgentAlert, "id" | "time" | "read">[]) {
  const { prefs } = useNotifications.getState();
  const wanted = alerts.filter((a) => prefs.kinds[a.kind]);
  if (!wanted.length) return;

  const chat = useChat.getState();
  const ui = useUI.getState();
  const background = appInBackground();
  const watching = (sid?: string) => !background && !!sid && chat.activeId === sid && ui.view === "chat";

  const fresh = wanted.filter((a) => !watching(a.sessionId));
  if (!fresh.length) return;
  const now = Date.now();
  useNotifications.setState((s) => ({
    items: [...fresh.map((a) => ({ ...a, id: `al_${now}_${seq++}`, time: now, read: false })).reverse(), ...s.items].slice(0, MAX),
  }));

  // One notification per batch: the one that needs the user most.
  const rank: Record<AlertKind, number> = { permission: 3, question: 3, failed: 2, finished: 1 };
  const last = fresh.reduce((a, b) => (rank[b.kind] >= rank[a.kind] ? b : a));
  const more = fresh.length > 1 ? ` · ${fresh.length - 1} more in the inbox` : "";
  const waiting = last.kind === "permission" || last.kind === "question";
  if (background) {
    if (prefs.system) void sendSystem(last.title, (last.body ?? "") + more, last.sessionId);
  } else if (prefs.toasts) {
    const sid = last.sessionId;
    ui.pushToast({
      tone: last.kind === "failed" ? "error" : last.kind === "finished" ? "ok" : "info",
      kind: last.kind,
      sticky: waiting,
      title: last.title,
      body: (last.body ?? "") + more,
      action: sid ? { label: waiting ? "Review" : "Open", run: () => openFromAlert(sid) } : undefined,
    });
  }
}

async function sendSystem(title: string, body: string, sessionId?: string) {
  // Ask the first time an alert would show, not at launch.
  if (!asked && (await notifyPermission()) === "default") {
    asked = true;
    if (!(await requestNotifyPermission())) return;
  }
  await notify(title, body || undefined, sessionId);
}

export function openFromAlert(sessionId: string) {
  const ui = useUI.getState();
  if (ui.view !== "chat") ui.setView("chat");
  useChat.getState().open(sessionId);
  useNotifications.getState().markRead(sessionId);
}

export async function initNotificationCenter() {
  const saved = await kv.get<NotifyPrefs>("notify.prefs");
  if (saved) useNotifications.setState({ prefs: { ...DEFAULT_PREFS, ...saved, kinds: { ...DEFAULT_PREFS.kinds, ...saved.kinds } } });
  else if ((await kv.get<boolean>("ui.notify")) === false) useNotifications.setState({ prefs: { ...DEFAULT_PREFS, system: false } });
  initNotifications(openFromAlert);

  // Opening a session reads its alerts.
  useChat.subscribe((s, prev) => {
    if (s.activeId && s.activeId !== prev.activeId) useNotifications.getState().markRead(s.activeId);
    // Another workspace: different sessions.
    if (s.client !== prev.client) useNotifications.getState().clear();
  });
  // Coming back to the session you were alerted about.
  document.addEventListener("visibilitychange", () => {
    const id = useChat.getState().activeId;
    if (document.visibilityState === "visible" && id) useNotifications.getState().markRead(id);
  });
}
