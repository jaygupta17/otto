/**
 * Server-side configuration the settings screens edit: global config
 * (agents, commands, MCP, defaults), installed skills and live MCP status.
 * Loaded lazily when a settings page opens; reset when the connection changes.
 */
import { create } from "zustand";
import type { McpServer, SkillInfo } from "../lib/opencode/client";
import { configLocation, readGlobalConfig, updateGlobalConfig, sh, type ConfigLocation, type GlobalConfig } from "../lib/opencode/config";
import { useChat } from "./chat";
import { toast } from "./ui";

interface State {
  loc: ConfigLocation | null;
  config: GlobalConfig | null;
  skills: SkillInfo[] | null;
  mcp: McpServer[] | null;
  error: string | null;
  loading: boolean;
  load(force?: boolean): Promise<void>;
  loadSkills(): Promise<void>;
  loadMcp(): Promise<void>;
  /** Read → mutate → write the global config, then refresh dependent catalogs. */
  update(mutate: (cfg: GlobalConfig) => GlobalConfig | void, opts?: { success?: string }): Promise<boolean>;
  writeSkill(name: string, content: string, existingPath?: string): Promise<boolean>;
  deleteSkill(skill: SkillInfo): Promise<boolean>;
  reset(): void;
}

function client() {
  const c = useChat.getState().client;
  if (!c) throw new Error("Not connected to a workspace.");
  return c;
}

/** Bumped by every load/update/reset so a slower, older read can't land last. */
let generation = 0;

/**
 * After a reload the server rediscovers skills asynchronously; poll briefly
 * until the change is visible so the list never flashes a partial result.
 */
async function settleSkills(done: (list: SkillInfo[]) => boolean) {
  const c = client();
  let list: SkillInfo[] = [];
  for (let i = 0; i < 12; i++) {
    list = await c.skills().catch(() => list);
    if (done(list) && (list.length > 2 || i >= 4)) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  useExtensions.setState({ skills: list });
}

export const useExtensions = create<State>((set, get) => ({
  loc: null,
  config: null,
  skills: null,
  mcp: null,
  error: null,
  loading: false,

  async load(force) {
    // A forced load starts a new read even if one is in flight: the caller
    // knows the config changed, and the older read must not win.
    if (!force && (get().loading || get().config)) return;
    const gen = ++generation;
    set({ loading: true, error: null });
    try {
      const c = client();
      const [loc, config] = await Promise.all([configLocation(c), readGlobalConfig(c)]);
      if (gen !== generation) return;
      set({ loc, config, loading: false });
    } catch (e) {
      if (gen !== generation) return;
      set({ loading: false, error: (e as Error).message });
    }
  },

  async loadSkills() {
    try {
      set({ skills: await client().skills() });
    } catch (e) {
      set({ skills: [] });
      toast({ tone: "error", title: "Couldn't load skills", body: (e as Error).message });
    }
  },

  async loadMcp() {
    try {
      set({ mcp: await client().mcpServers() });
    } catch (e) {
      set({ mcp: [] });
      toast({ tone: "error", title: "Couldn't load MCP servers", body: (e as Error).message });
    }
  },

  async update(mutate, opts) {
    try {
      const next = await updateGlobalConfig(client(), mutate);
      // This write is newer than any read still in flight.
      generation++;
      set({ config: next, loading: false });
      if (opts?.success) toast({ tone: "ok", title: opts.success });
      // Agents/commands/models derive from config; refresh before returning so
      // the caller never lists or re-selects something the server dropped.
      await useChat.getState().refreshCatalog();
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save", body: (e as Error).message });
      return false;
    }
  },

  async writeSkill(name, content, existingPath) {
    try {
      const c = client();
      const loc = get().loc ?? (await configLocation(c));
      const path = existingPath ?? `${loc.dir}/skills/${name}/SKILL.md`;
      await c.writeFile(path, content);
      await c.reloadLocation().catch(() => {});
      await settleSkills((list) => list.some((x) => x.path === path || x.name === name));
      toast({ tone: "ok", title: existingPath ? "Skill saved" : `Skill “${name}” added` });
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save skill", body: (e as Error).message });
      return false;
    }
  },

  async deleteSkill(skill) {
    try {
      const c = client();
      const loc = get().loc ?? (await configLocation(c));
      const dir = skill.path.replace(/\/SKILL\.md$/i, "");
      // Only delete inside the config directory we manage.
      if (!dir.startsWith(loc.dir + "/")) throw new Error("This skill lives outside the config folder; remove it on the server.");
      const r = await c.exec(`rm -rf ${sh(dir)}`);
      if (r.exit !== 0) throw new Error(r.output || "Delete failed");
      await c.reloadLocation().catch(() => {});
      await settleSkills((list) => !list.some((x) => x.path === skill.path));
      toast({ tone: "ok", title: `Removed “${skill.name}”` });
      return true;
    } catch (e) {
      toast({ tone: "error", title: "Couldn't remove skill", body: (e as Error).message });
      return false;
    }
  },

  reset() {
    generation++;
    set({ loc: null, config: null, skills: null, mcp: null, error: null, loading: false });
  },
}));

// Drop cached server config whenever the chat store binds a different client.
useChat.subscribe((s, prev) => {
  if (s.client !== prev.client) useExtensions.getState().reset();
});

if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
