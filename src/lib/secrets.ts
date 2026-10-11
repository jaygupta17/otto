/**
 * Secrets (sandbox API keys, OpenCode server passwords, tunnel tokens).
 *
 * macOS / Windows: OS keychain via the Rust `secret_*` commands.
 * iOS / Android / Linux / browser: the app-private store. Secrets are never
 * logged and never placed in URLs we build ourselves except where the
 * sandbox provider's proxy requires it (Boat's `_token`).
 */
import { isTauri } from "./platform";
import { kv } from "./kv";

let backend: Promise<"keychain" | "store"> | null = null;

async function getBackend(): Promise<"keychain" | "store"> {
  if (!backend) {
    backend = (async () => {
      if (!isTauri) return "store";
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        return (await invoke<string>("secret_backend")) === "keychain" ? "keychain" : "store";
      } catch {
        return "store";
      }
    })();
  }
  return backend;
}

const cache = new Map<string, string | null>();

export const secrets = {
  async get(key: string): Promise<string | null> {
    if (cache.has(key)) return cache.get(key) ?? null;
    let value: string | null = null;
    if ((await getBackend()) === "keychain") {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        value = (await invoke<string | null>("secret_get", { key })) ?? null;
      } catch {
        value = (await kv.get<string>(`secret.${key}`)) ?? null;
      }
    } else {
      value = (await kv.get<string>(`secret.${key}`)) ?? null;
    }
    cache.set(key, value);
    return value;
  },
  async set(key: string, value: string) {
    cache.set(key, value);
    if ((await getBackend()) === "keychain") {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("secret_set", { key, value });
        return;
      } catch {
        // fall through to the store if the keychain refuses (e.g. locked)
      }
    }
    await kv.set(`secret.${key}`, value);
  },
  async delete(key: string) {
    cache.delete(key);
    if ((await getBackend()) === "keychain") {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("secret_delete", { key }).catch(() => {});
    }
    await kv.delete(`secret.${key}`);
  },
};

// Stores hold live connections; a hot swap would orphan them. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
