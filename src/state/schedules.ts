import { create } from "zustand";
import { ScheduleService, StaleScheduleError, type Credentials, type RunRecord, type Schedule, type ServerEnv } from "../lib/schedules";
import { secrets } from "../lib/secrets";
import { useChat } from "./chat";
import { useConnection } from "./connection";
import { secretKeys, useWorkspaces } from "./workspaces";
import { toast } from "./ui";

interface State {
  list: Schedule[] | null;
  /** The file revision the list came from; every write is based on it. */
  rev: number;
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

/** The runner's credentials, from the workspace this device is connected to. */
async function credentials(): Promise<Credentials> {
  // A stopped machine clears workspaceId; the active workspace still owns the key.
  const conn = useConnection.getState();
  const wsId = conn.workspaceId ?? useWorkspaces.getState().activeId;
  const password = wsId ? ((await secrets.get(secretKeys.password(wsId))) ?? "") : "";
  return { password, localUrl: localUrl() };
}

/** Someone else wrote first. Show what is there now and let the person retry. */
function changedElsewhere(e: StaleScheduleError) {
  useSchedules.setState({ list: e.schedules, rev: e.current, saving: false });
  toast({ tone: "info", title: "Changed elsewhere — reloaded", body: "Review the schedule and save again." });
}

export const useSchedules = create<State>((set, get) => ({
  list: null,
  rev: 0,
  env: null,
  runs: {},
  error: null,
  saving: false,

  async load() {
    try {
      set({ error: null });
      const s = svc();
      const [env, data] = await Promise.all([s.env(), s.load()]);
      set({ env, list: data.schedules, rev: data.rev });
      for (const sc of data.schedules) void get().loadRuns(sc.id);
      // Keep the runner, credentials, cron block and agent tool in step with
      // this machine. Everything it writes is derived; the file is untouched.
      void install(s);
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
    const s = svc();
    const editing = get().list?.some((x) => x.id === sc.id) ?? false;
    set({ saving: true });
    try {
      const out = await s.upsert(sc, get().rev, await credentials());
      set({ list: out.schedules, rev: out.rev, saving: false });
      toast({ tone: "ok", title: editing ? "Schedule updated" : "Schedule created" });
      return true;
    } catch (e) {
      set({ saving: false });
      if (e instanceof StaleScheduleError) {
        changedElsewhere(e);
        return false;
      }
      toast({ tone: "error", title: "Couldn't save schedule", body: (e as Error).message });
      return false;
    }
  },

  async remove(id) {
    set({ saving: true });
    try {
      const out = await svc().remove(id, get().rev, await credentials());
      set({ list: out.schedules, rev: out.rev, saving: false });
      toast({ tone: "ok", title: "Schedule deleted" });
      return true;
    } catch (e) {
      set({ saving: false });
      if (e instanceof StaleScheduleError) {
        changedElsewhere(e);
        return false;
      }
      toast({ tone: "error", title: "Couldn't delete", body: (e as Error).message });
      return false;
    }
  },

  async setEnabled(id, enabled) {
    try {
      const out = await svc().setEnabled(id, enabled, get().rev, await credentials());
      set({ list: out.schedules, rev: out.rev });
      return true;
    } catch (e) {
      if (e instanceof StaleScheduleError) {
        changedElsewhere(e);
        return false;
      }
      toast({ tone: "error", title: "Couldn't update", body: (e as Error).message });
      return false;
    }
  },

  async runNow(id) {
    try {
      const out = await svc().runNow(id, await credentials());
      set({ list: out.schedules, rev: out.rev });
      await get().loadRuns(id);
      const r = out.run;
      if (r?.ok && r.sessionID) {
        toast({ tone: "ok", title: "Started", body: "Opening the new session…" });
        await useChat.getState().loadSessions();
        useChat.getState().open(r.sessionID);
      } else toast({ tone: "error", title: "Run failed", body: r?.error ?? (r ? "No result" : "The runner left no result.") });
    } catch (e) {
      toast({ tone: "error", title: "Run failed", body: (e as Error).message });
    }
  },

  reset() {
    service = null;
    set({ list: null, rev: 0, env: null, runs: {}, error: null, saving: false });
  },
}));

/** Derived files + cron. Failures must not hide the list. */
async function install(s: ScheduleService) {
  try {
    const out = await s.install(await credentials());
    const state = useSchedules.getState();
    // A save may have landed while this was reading; never walk the list back.
    if (out.rev >= state.rev) {
      useSchedules.setState({ rev: out.rev, list: out.schedules, env: state.env ? { ...state.env, hasCron: !out.warnings.some((w) => w.startsWith("cron-")) } : state.env });
    }
  } catch {
    /* no credentials yet, or a machine that cannot take them */
  }
}

useChat.subscribe((s, prev) => {
  if (s.client !== prev.client) useSchedules.getState().reset();
});

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
