/**
 * Small persistent key/value store.
 * Tauri: plugin-store (app data dir, private to the app).
 * Browser: localStorage.
 */
import { isTauri } from "./platform";

type StoreLike = {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<boolean>;
  save(): Promise<void>;
};

let storePromise: Promise<StoreLike> | null = null;

function getStore(): Promise<StoreLike> {
  if (!storePromise) {
    storePromise = (async () => {
      if (isTauri) {
        const { load } = await import("@tauri-apps/plugin-store");
        const s = await load("otto.json", { autoSave: 200, defaults: {} });
        return s as unknown as StoreLike;
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
        async save() {},
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
  async flush() {
    await (await getStore()).save();
  },
};

// Stores hold live connections; a hot swap would orphan them. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
