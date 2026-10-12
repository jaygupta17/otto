/**
 * Workspaces = a sandbox, this computer, or any reachable OpenCode v2 server the app talks to.
 * Metadata lives in the app store; credentials live in `secrets`.
 */
import { create } from "zustand";
import { kv } from "../lib/kv";
import { secrets } from "../lib/secrets";

export type ProviderId = "boat" | "boxd" | "e2b" | "daytona" | "local" | "custom";

/** Providers whose API key Otto keeps (keychain) to create and wake machines. */
export type CloudId = Exclude<ProviderId, "custom" | "local">;

export const isCloud = (p: ProviderId): p is CloudId => p !== "custom" && p !== "local";

export interface Workspace {
  id: string;
  name: string;
  provider: ProviderId;
  /** The provider's sandbox / machine id */
  sandboxId?: string;
  /** E2B: seconds without the app before the sandbox pauses */
  sleepAfter?: number;
  baseUrl: string;
  createdAt: number;
  lastUsedAt: number;
  version?: string;
}

interface State {
  hydrated: boolean;
  workspaces: Workspace[];
  activeId: string | null;
  hydrate(): Promise<void>;
  add(ws: Workspace, creds: { password: string; gateToken?: string }): Promise<void>;
  update(id: string, patch: Partial<Workspace>, creds?: { password?: string; gateToken?: string | null }): Promise<void>;
  remove(id: string): Promise<void>;
  setActive(id: string | null): Promise<void>;
  /** Which provider keys are saved (for the Settings forms). */
  keys: Partial<Record<CloudId, boolean>>;
  setProviderKey(provider: CloudId, key: string | null): Promise<void>;
}

const KEY = "workspaces.v1";

export const secretKeys = {
  boat: "provider.boat.apiKey",
  boxd: "provider.boxd.apiKey",
  e2b: "provider.e2b.apiKey",
  daytona: "provider.daytona.apiKey",
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
  keys: {},

  async hydrate() {
    const saved = await kv.get<{ workspaces: Workspace[]; activeId: string | null }>(KEY);
    const workspaces = saved?.workspaces ?? [];
    const activeId = saved?.activeId && workspaces.some((w) => w.id === saved.activeId) ? saved.activeId : (workspaces[0]?.id ?? null);
    const keys: Partial<Record<CloudId, boolean>> = {};
    for (const c of ["boat", "boxd", "e2b", "daytona"] as const) keys[c] = !!(await secrets.get(secretKeys[c]));
    set({ hydrated: true, workspaces, activeId, keys });
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

  async setProviderKey(provider, key) {
    if (key) await secrets.set(secretKeys[provider], key);
    else await secrets.delete(secretKeys[provider]);
    set({ keys: { ...get().keys, [provider]: !!key } });
  },
}));

export function useActiveWorkspace() {
  return useWorkspaces((s) => s.workspaces.find((w) => w.id === s.activeId) ?? null);
}

// Stores hold live connections; a hot swap would orphan them. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
