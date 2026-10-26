/**
 * Installing the `present` tool on a connection.
 *
 * The tool is what makes the artifact surface useful: without it the agent has
 * nothing to call and every session's list stays empty. It is read-only (the
 * call carries a source; the app decides what to draw), so unlike the schedule
 * tool there is no toggle and no permission to set: every connection installs
 * it.
 */
import type { OpenCode } from "./opencode/client";
import { ensurePresentPlugin, removePresentPlugin } from "./presentPlugin";

const prepared = new WeakSet<OpenCode>();

/** Install the `present` plugin once per connection. */
export async function preparePresent(client: OpenCode): Promise<void> {
  if (prepared.has(client)) return;
  await ensurePresentPlugin(client);
  prepared.add(client);
}

/** Stop offering the tool (the files stay on the machine). */
export async function removePresentTools(client: OpenCode): Promise<void> {
  prepared.delete(client);
  await removePresentPlugin(client);
}
