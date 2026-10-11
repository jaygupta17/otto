/**
 * Workspaces = a sandbox (or any reachable OpenCode v2 server) the app talks to.
 * Metadata lives in the app store; credentials live in `secrets`.
 */
import { create } from "zustand";
import { kv } from "../lib/kv";
import { secrets } from "../lib/secrets";

export type ProviderId = "boat" | "boxd" | "custom";

export interface Workspace {
  id: string;
  name: string;
  provider: ProviderId;
  /** Boat sandbox id (bx_…) or boxd machine id */
  sandboxId?: string;
  baseUrl: string;
  createdAt: number;
  lastUsedAt: number;
  version?: string;
}

interface State {
  hydrated: boolean;
  workspaces: Workspace[];
  activeId: string | null;
  hasBoatKey: boolean;
  hasBoxdKey: boolean;
  hydrate(): Promise<void>;
  add(ws: Workspace, creds: { password: string; gateToken?: string }): Promise<void>;
  update(id: string, patch: Partial<Workspace>, creds?: { password?: string; gateToken?: string | null }): Promise<void>;
  remove(id: string): Promise<void>;
  setActive(id: string | null): Promise<void>;
  setBoatKey(key: string | null): Promise<void>;
  setBoxdKey(key: string | null): Promise<void>;
}

const KEY = "workspaces.v1";

export const secretKeys = {
  boat: "provider.boat.apiKey",
  boxd: "provider.boxd.apiKey",
  password: (id: string) => `ws.${id}.password`,
  gate: (id: string) => `ws.${id}.gate`,
};

async function persist(s: Pick<State, "workspaces" | "activeId">) {
  await kv.set(KEY, { workspaces: s.workspaces, activeId: s.activeId });
}

export const useWorkspaces = create<State>((set, get) => ({
  hydrated: false,
  workspaces: [],
  activeId: null,
  hasBoatKey: false,
  hasBoxdKey: false,

  async hydrate() {
    const saved = await kv.get<{ workspaces: Workspace[]; activeId: string | null }>(KEY);
    const hasBoatKey = !!(await secrets.get(secretKeys.boat));
    const hasBoxdKey = !!(await secrets.get(secretKeys.boxd));
    const workspaces = saved?.workspaces ?? [];
    const activeId = saved?.activeId && workspaces.some((w) => w.id === saved.activeId) ? saved.activeId : (workspaces[0]?.id ?? null);
    set({ hydrated: true, workspaces, activeId, hasBoatKey, hasBoxdKey });
  },

  async add(ws, creds) {
    await secrets.set(secretKeys.password(ws.id), creds.password);
    if (creds.gateToken) await secrets.set(secretKeys.gate(ws.id), creds.gateToken);
    const workspaces = [...get().workspaces.filter((w) => w.id !== ws.id), ws];
    set({ workspaces, activeId: ws.id });
    await persist({ workspaces, activeId: ws.id });
  },

  async update(id, patch, creds) {
    if (creds?.password) await secrets.set(secretKeys.password(id), creds.password);
    if (creds?.gateToken) await secrets.set(secretKeys.gate(id), creds.gateToken);
    else if (creds?.gateToken === null) await secrets.delete(secretKeys.gate(id));
    const workspaces = get().workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w));
    set({ workspaces });
    await persist({ workspaces, activeId: get().activeId });
  },

  async remove(id) {
    await secrets.delete(secretKeys.password(id));
    await secrets.delete(secretKeys.gate(id));
    await kv.delete(`chat.prefs.${id}`);
    await kv.delete(`chat.brokenModels.${id}`);
    await kv.delete(`chat.pinned.${id}`);
    const workspaces = get().workspaces.filter((w) => w.id !== id);
    const activeId = get().activeId === id ? (workspaces[0]?.id ?? null) : get().activeId;
    set({ workspaces, activeId });
    await persist({ workspaces, activeId });
  },

  async setActive(id) {
    const workspaces = get().workspaces.map((w) => (w.id === id ? { ...w, lastUsedAt: Date.now() } : w));
    set({ activeId: id, workspaces });
    await persist({ workspaces, activeId: id });
  },

  async setBoatKey(key) {
    if (key) await secrets.set(secretKeys.boat, key);
    else await secrets.delete(secretKeys.boat);
    set({ hasBoatKey: !!key });
  },

  async setBoxdKey(key) {
    if (key) await secrets.set(secretKeys.boxd, key);
    else await secrets.delete(secretKeys.boxd);
    set({ hasBoxdKey: !!key });
  },
}));

export function useActiveWorkspace() {
  return useWorkspaces((s) => s.workspaces.find((w) => w.id === s.activeId) ?? null);
}

// Stores hold live connections; a hot swap would orphan them. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
