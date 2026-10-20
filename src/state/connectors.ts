/**
 * Apps through Composio (see lib/composio). The key lives on this device; each
 * agent machine gets it as a file beside opencode.json plus the
 * opencode-composio plugin that reads it, set up on its own whenever we
 * connect to a machine that doesn't have it yet (machines set up by older
 * builds swap their Composio MCP server for the plugin).
 */
import { create } from "zustand";
import { addAccount, APPS, appName, checkKey, COMPOSIO_PLUGIN, COMPOSIO_SECRET, composioInstalled, listAccounts, removeAccount, withComposio, withoutComposio, type Account } from "../lib/composio";
import { configLocation, readGlobalConfig, sh, updateGlobalConfig } from "../lib/opencode/config";
import type { OpenCode } from "../lib/opencode/client";
import { openExternal } from "../lib/platform";
import { secrets } from "../lib/secrets";
import { useChat } from "./chat";
import { toast } from "./ui";

/** A link is good for 10 minutes; stop watching a little before Composio forgets it. */
const LINK_LIFE = 10 * 60_000;
const POLL = 2500;

type Machine = "checking" | "ready" | "missing" | "installing" | "error";

interface State {
  /** undefined while reading the keychain. */
  key: string | null | undefined;
  /** Connected accounts by app; null until the first list. */
  accounts: Record<string, Account[]> | null;
  error: string | null;
  /** Apps waiting on you in the browser. */
  pending: Record<string, { url: string; accountId?: string; known: string[]; until: number }>;
  /** How each connect link went, for the cards in chat. */
  links: Record<string, "waiting" | "connected" | "failed">;
  /** Whether the connected machine has the apps server. */
  machine: Machine;
  init(): Promise<void>;
  saveKey(key: string): Promise<boolean>;
  forgetKey(): Promise<void>;
  load(): Promise<void>;
  connect(slug: string): Promise<void>;
  /** Open a connect link the agent handed you, and watch it like one started here. */
  follow(slug: string | null, url: string): Promise<void>;
  cancel(slug: string): void;
  disconnect(slug: string, accountId: string): Promise<void>;
  /** Make sure the connected machine has the key file and the plugin. */
  install(force?: boolean): Promise<void>;
}

const keyPath = async (c: OpenCode) => `${(await configLocation(c)).dir}/otto/composio.key`;
/** OpenCode has the plugin running. Older servers without the plugin list count as yes: the config is right, nothing more to check. */
const loaded = (c: OpenCode) =>
  c.plugins().then(
    (list) => list.some((p) => p.id === COMPOSIO_PLUGIN && p.state.status === "active"),
    () => true,
  );
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let started = false;

export const useConnectors = create<State>((set, get) => ({
  key: undefined,
  accounts: null,
  error: null,
  pending: {},
  links: {},
  machine: "checking",

  async init() {
    if (started) return;
    started = true;
    const key = await secrets.get(COMPOSIO_SECRET);
    set({ key });
    if (key) {
      void get().load();
      void get().install();
    }
  },

  async saveKey(raw) {
    const key = raw.trim();
    try {
      await checkKey(key);
    } catch (e) {
      set({ error: (e as Error).message });
      return false;
    }
    await secrets.set(COMPOSIO_SECRET, key);
    set({ key, error: null, accounts: null });
    void get().load();
    await get().install(true);
    return true;
  },

  async forgetKey() {
    const c = useChat.getState().client;
    // Plugin first, then the file it reads.
    if (c) {
      try {
        await updateGlobalConfig(c, withoutComposio);
        await c.exec(`rm -f ${sh(await keyPath(c))}`).catch(() => {});
      } catch {
        /* the machine may be gone; the key still leaves this device */
      }
    }
    await secrets.delete(COMPOSIO_SECRET);
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    set({ key: null, accounts: null, pending: {}, links: {}, error: null, machine: "missing" });
  },

  async load() {
    const key = get().key;
    if (!key) return;
    try {
      set({ accounts: await listAccounts(key, APPS.map((a) => a.slug)), error: null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  async connect(slug) {
    const key = get().key;
    if (!key) return;
    try {
      const { url, accountId } = await addAccount(key, slug);
      begin(slug, url, accountId);
      await openExternal(url);
    } catch (e) {
      toast({ tone: "error", title: `Couldn't connect ${appName(slug)}`, body: (e as Error).message });
    }
  },

  async follow(slug, url) {
    await openExternal(url);
    // Without the key here (or knowing the app) there's nothing to watch: the agent checks for itself.
    if (slug && get().key) begin(slug, url);
  },

  cancel(slug) {
    const p = get().pending[slug];
    clearTimeout(timers.get(slug));
    timers.delete(slug);
    set((s) => {
      const pending = { ...s.pending };
      delete pending[slug];
      const links = { ...s.links };
      if (p) delete links[p.url];
      return { pending, links };
    });
    // Tidy the half-made account so it doesn't linger in Composio.
    const key = get().key;
    if (key && p?.accountId) void removeAccount(key, slug, p.accountId).catch(() => {});
  },

  async disconnect(slug, accountId) {
    const key = get().key;
    if (!key) return;
    try {
      await removeAccount(key, slug, accountId);
      set((s) => ({ accounts: { ...(s.accounts ?? {}), [slug]: (s.accounts?.[slug] ?? []).filter((a) => a.id !== accountId) } }));
      toast({ tone: "ok", title: `Disconnected ${appName(slug)}` });
    } catch (e) {
      toast({ tone: "error", title: `Couldn't disconnect ${appName(slug)}`, body: (e as Error).message });
    }
  },

  async install(force) {
    const c = useChat.getState().client;
    const key = get().key;
    if (!c || !key) return set({ machine: key ? "checking" : "missing" });
    set({ machine: force ? "installing" : "checking" });
    try {
      const path = await keyPath(c);
      const current = await c.readFile(path).catch(() => "");
      const fileOk = current.trim() === key;
      const configOk = composioInstalled(await readGlobalConfig(c), path);
      if (fileOk && configOk && !force) return set({ machine: (await loaded(c)) ? "ready" : "error" });
      if (c !== useChat.getState().client) return;
      set({ machine: "installing" });
      // The key file before the plugin that reads it: without it, apps stay off until the next start.
      if (!fileOk) {
        await c.writeFile(path, key);
        await c.exec(`chmod 600 ${sh(path)}`).catch(() => {});
      }
      if (!configOk || force) await updateGlobalConfig(c, (cfg) => withComposio(cfg, path));
      if (c !== useChat.getState().client) return;
      // The first start downloads the plugin: give it a moment.
      let ok = await loaded(c);
      for (let i = 0; !ok && i < 10 && c === useChat.getState().client; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        ok = await loaded(c);
      }
      if (c !== useChat.getState().client) return;
      set({ machine: ok ? "ready" : "error" });
      if (!ok) toast({ tone: "error", title: "Your apps didn't start on this machine", body: "OpenCode couldn't load the apps plugin. Check the machine is online, then try again from Settings → Apps." });
    } catch (e) {
      if (c !== useChat.getState().client) return;
      set({ machine: "error" });
      toast({ tone: "error", title: "Couldn't add your apps to this machine", body: (e as Error).message });
    }
  },
}));

/** Note what's already connected, then watch for the new account. */
function begin(slug: string, url: string, accountId?: string) {
  const st = useConnectors.getState();
  const known = (st.accounts?.[slug] ?? []).filter((a) => a.status === "active").map((a) => a.id);
  useConnectors.setState((s) => ({ pending: { ...s.pending, [slug]: { url, accountId, known, until: Date.now() + LINK_LIFE } }, links: { ...s.links, [url]: "waiting" } }));
  watch(slug);
}

/** Watch an app until its account turns active, fails, or the link runs out. */
function watch(slug: string, now = false) {
  clearTimeout(timers.get(slug));
  const tick = async () => {
    const st = useConnectors.getState();
    const p = st.pending[slug];
    if (!p || !st.key) return;
    if (Date.now() > p.until) return st.cancel(slug);
    try {
      const accounts = (await listAccounts(st.key, [slug]))[slug];
      const mine = p.accountId ? accounts.find((a) => a.id === p.accountId) : accounts.find((a) => a.status === "active" && !p.known.includes(a.id));
      if (mine?.status === "active" || mine?.status === "failed") {
        timers.delete(slug);
        useConnectors.setState((s) => {
          const pending = { ...s.pending };
          delete pending[slug];
          // Abandoned attempts stay "initiated" in Composio; only show real accounts.
          return { pending, accounts: { ...(s.accounts ?? {}), [slug]: accounts }, links: { ...s.links, [p.url]: mine.status === "active" ? "connected" : "failed" } };
        });
        if (mine.status === "active") toast({ tone: "ok", title: `${appName(slug)} connected` });
        else toast({ tone: "error", title: `${appName(slug)} didn't connect`, body: "Try again, and approve access when the app asks." });
        return;
      }
    } catch {
      /* a blip; keep watching */
    }
    timers.set(slug, setTimeout(tick, POLL));
  };
  timers.set(slug, setTimeout(tick, now ? 0 : POLL));
}

// Coming back from the browser: check at once instead of waiting for the next tick.
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    for (const slug of Object.keys(useConnectors.getState().pending)) watch(slug, true);
  });
}

// Follow the connection: a new machine gets the apps plugin if it lacks one.
useChat.subscribe((s, prev) => {
  if (s.client === prev.client || !s.client) return;
  const st = useConnectors.getState();
  if (st.key === undefined) void st.init();
  else if (st.key) void st.install();
});
if (useChat.getState().client) void useConnectors.getState().init();

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
