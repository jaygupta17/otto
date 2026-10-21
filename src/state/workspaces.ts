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

/**
 * Write the whole workspaces snapshot. Serialized, and read from the store at
 * write time rather than passed in: a write queued before a removal (or a
 * switch) must not carry the old list back after the newer one lands.
 */
let writes: Promise<unknown> = Promise.resolve();

function persist() {
  const run = async () => {
    const { workspaces, activeId } = useWorkspaces.getState();
    await kv.set(KEY, { workspaces, activeId });
  };
  const p = writes.then(run, run);
  writes = p.catch(() => {});
  return p;
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
    await persist();
  },

  async update(id, patch, creds) {
    // Gone (removed while a connect was finishing): don't write its secrets back.
    if (!get().workspaces.some((w) => w.id === id)) return;
    if (creds?.password) await secrets.set(secretKeys.password(id), creds.password);
    if (creds?.gateToken) await secrets.set(secretKeys.gate(id), creds.gateToken);
    else if (creds?.gateToken === null) await secrets.delete(secretKeys.gate(id));
    const workspaces = get().workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w));
    set({ workspaces });
    await persist();
  },

  async remove(id) {
    const prev = get();
    const workspaces = prev.workspaces.filter((w) => w.id !== id);
    const activeId = prev.activeId === id ? (workspaces[0]?.id ?? null) : prev.activeId;
    // Take it off the list first: an orphaned keychain entry is harmless, but a
    // listed workspace whose credentials are gone can't ever connect.
    set({ workspaces, activeId });
    try {
      await persist();
    } catch (e) {
      set({ workspaces: prev.workspaces, activeId: prev.activeId });
      throw e;
    }
    // Cleanup only: failing here leaves a leftover secret, not a broken entry.
    const results = await Promise.allSettled([
      secrets.delete(secretKeys.password(id)),
      secrets.delete(secretKeys.gate(id)),
      kv.delete(`chat.prefs.${id}`),
      kv.delete(`chat.brokenModels.${id}`),
      kv.delete(`chat.pinned.${id}`),
      kv.delete(`chat.agentRowsOpen.${id}`),
    ]);
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length) console.warn("workspace cleanup:", failed.map((f) => f.reason));
  },

  async setActive(id) {
    if (id && !get().workspaces.some((w) => w.id === id)) return;
    const workspaces = get().workspaces.map((w) => (w.id === id ? { ...w, lastUsedAt: Date.now() } : w));
    set({ activeId: id, workspaces });
    await persist();
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
