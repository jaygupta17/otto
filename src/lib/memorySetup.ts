/**
 * Keeping per-agent memory injection current on a connection.
 *
 * `context.md` needs nothing on the machine beyond the config entry, but the
 * per-agent files are injected by a plugin whose memory root lives in its
 * config entry. A machine that turned memory on with an older build has the
 * instruction and no plugin, and its agents would never see their own notes;
 * this brings such a machine up to date on connect, without touching a
 * machine where memory is off. Cheap: the plugin install is cached per
 * connection and rewrites nothing when it is already in place.
 */
import type { OpenCode } from "./opencode/client";
import { memoryInstalled, memoryPaths } from "./memory";
import { ensureMemoryPlugin } from "./memoryPlugin";
import { readGlobalConfig } from "./opencode/config";

/** Install the memory plugin when memory is on for this machine. */
export async function prepareMemory(client: OpenCode): Promise<void> {
  if (!memoryInstalled(await readGlobalConfig(client))) return;
  await ensureMemoryPlugin(client, (await memoryPaths(client)).root);
}
