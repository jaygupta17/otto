import { create } from "zustand";
import { ScheduleService, type RunRecord, type Schedule, type ServerEnv } from "../lib/schedules";
import { secrets } from "../lib/secrets";
import { useChat } from "./chat";
import { useConnection } from "./connection";
import { secretKeys } from "./workspaces";
import { toast } from "./ui";

interface State {
  list: Schedule[] | null;
  env: ServerEnv | null;
  runs: Record<string, RunRecord[]>;
  error: string | null;
  saving: boolean;
  load(): Promise<void>;
  loadRuns(id: string): Promise<void>;
  upsert(s: Schedule): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  setEnabled(id: string, enabled: boolean): Promise<boolean>;
  runNow(id: string): Promise<void>;
  reset(): void;
}

let service: ScheduleService | null = null;
function svc() {
  const c = useChat.getState().client;
  if (!c) throw new Error("Not connected to a workspace.");
  if (!service || service.client !== c) service = new ScheduleService(c);
  return service;
}

/** Address the runner uses on the server itself (loopback, not the public proxy). */
function localUrl() {
  const info = useConnection.getState().info;
  const raw = info?.urls?.[0] ?? "http://127.0.0.1:4096";
  try {
    const u = new URL(raw);
    return `http://127.0.0.1:${u.port || (u.protocol === "https:" ? 443 : 80)}`;
  } catch {
    return "http://127.0.0.1:4096";
  }
}

async function persist(list: Schedule[]) {
  const wsId = useConnection.getState().workspaceId;
  const password = wsId ? ((await secrets.get(secretKeys.password(wsId))) ?? "") : "";
  await svc().save(list, { password, localUrl: localUrl() });
}

export const useSchedules = create<State>((set, get) => ({
  list: null,
  env: null,
  runs: {},
  error: null,
  saving: false,

  async load() {
    try {
      set({ error: null });
      const s = svc();
      const [env, list] = await Promise.all([s.env(), s.list()]);
      set({ env, list });
      for (const sc of list) void get().loadRuns(sc.id);
    } catch (e) {
      set({ error: (e as Error).message, list: get().list ?? [] });
    }
  },

  async loadRuns(id) {
    try {
      const runs = await svc().runs(id);
      set((s) => ({ runs: { ...s.runs, [id]: runs } }));
    } catch {
      /* no runs yet */
    }
  },

  async upsert(sc) {
    const prev = get().list ?? [];
    const next = prev.some((x) => x.id === sc.id) ? prev.map((x) => (x.id === sc.id ? sc : x)) : [...prev, sc];
    set({ saving: true });
    try {
      await persist(next);
      set({ list: next, saving: false });
      toast({ tone: "ok", title: prev.some((x) => x.id === sc.id) ? "Schedule updated" : "Schedule created" });
      return true;
    } catch (e) {
      set({ saving: false });
      toast({ tone: "error", title: "Couldn't save schedule", body: (e as Error).message });
      return false;
    }
  },

  async remove(id) {
    const prev = get().list ?? [];
    const next = prev.filter((x) => x.id !== id);
    set({ list: next });
    try {
      await persist(next);
      toast({ tone: "ok", title: "Schedule deleted" });
      return true;
    } catch (e) {
      set({ list: prev });
      toast({ tone: "error", title: "Couldn't delete", body: (e as Error).message });
      return false;
    }
  },

  async setEnabled(id, enabled) {
    const prev = get().list ?? [];
    const next = prev.map((x) => (x.id === id ? { ...x, enabled } : x));
    set({ list: next });
    try {
      await persist(next);
      return true;
    } catch (e) {
      set({ list: prev });
      toast({ tone: "error", title: "Couldn't update", body: (e as Error).message });
      return false;
    }
  },

  async runNow(id) {
    try {
      // Make sure payloads/runner exist even if never saved from this device.
      if (get().list) await persist(get().list!);
      const r = await svc().runNow(id);
      await get().loadRuns(id);
      if (r?.ok && r.sessionID) {
        toast({ tone: "ok", title: "Started", body: "Opening the new session…" });
        await useChat.getState().loadSessions();
        useChat.getState().open(r.sessionID);
      } else toast({ tone: "error", title: "Run failed", body: r?.error ?? "No result" });
    } catch (e) {
      toast({ tone: "error", title: "Run failed", body: (e as Error).message });
    }
  },

  reset() {
    service = null;
    set({ list: null, env: null, runs: {}, error: null, saving: false });
  },
}));

useChat.subscribe((s, prev) => {
  if (s.client !== prev.client) useSchedules.getState().reset();
});

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
