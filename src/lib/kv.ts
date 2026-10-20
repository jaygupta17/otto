/**
 * Small persistent key/value store.
 * Tauri: the Rust `kv_*` commands (app data dir, private to the app). Each change
 * is on disk, written so a killed app keeps the last good copy, before `set` resolves.
 * Browser: localStorage.
 */
import { isTauri } from "./platform";

type StoreLike = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
};

let storePromise: Promise<StoreLike> | null = null;

function getStore(): Promise<StoreLike> {
  if (!storePromise) {
    storePromise = (async () => {
      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        return {
          async get<T>(key: string) {
            return ((await invoke<T | null>("kv_get", { key })) ?? undefined) as T | undefined;
          },
          set: (key, value) => invoke<void>("kv_set", { key, value }),
          delete: (key) => invoke<boolean>("kv_delete", { key }),
        };
      }
      const prefix = "otto.kv.";
      return {
        async get<T>(key: string) {
          const raw = localStorage.getItem(prefix + key);
          return raw == null ? undefined : (JSON.parse(raw) as T);
        },
        async set(key: string, value: unknown) {
          localStorage.setItem(prefix + key, JSON.stringify(value));
        },
        async delete(key: string) {
          const had = localStorage.getItem(prefix + key) != null;
          localStorage.removeItem(prefix + key);
          return had;
        },
      };
    })();
  }
  return storePromise;
}

export const kv = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await getStore()).get<T>(key);
  },
  async set(key: string, value: unknown) {
    const s = await getStore();
    await s.set(key, value);
  },
  async delete(key: string) {
    const s = await getStore();
    await s.delete(key);
  },
};

// Stores hold live connections; a hot swap would orphan them. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
