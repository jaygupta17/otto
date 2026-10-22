/**
 * Installing the schedule tool on a connection, not on a panel visit.
 *
 * The agent-facing `otto_schedule` tool used to appear only after someone
 * opened Schedules. A new user asking an agent to schedule something on a
 * fresh machine had no tool, so every connection now prepares the runner and
 * credentials and installs the plugin. Cron is not written here: with no
 * schedules there is nothing to run, and `ScheduleStore.install` leaves the
 * crontab alone until the first schedule exists.
 *
 * Preparing is cached per connection (a WeakSet), so reconnects and panel
 * opens don't rewrite the same files. A failed attempt leaves no cache entry,
 * so the next connection tries again.
 */
import type { OpenCode, ServerInfo } from "./opencode/client";
import { ScheduleService, type Credentials } from "./schedules";
import { ensureSchedulePlugin, removeSchedulePlugin } from "./schedulesPlugin";

/**
 * The address the runner uses on the server itself: loopback, not the public
 * proxy the app talks to. Same port, so a machine behind Boat/Daytona works.
 */
export function scheduleLocalUrl(info?: ServerInfo | null): string {
  try {
    const u = new URL(info?.urls?.[0] ?? "");
    return `http://127.0.0.1:${u.port || (u.protocol === "https:" ? 443 : 80)}`;
  } catch {
    return "http://127.0.0.1:4096";
  }
}

const prepared = new WeakSet<OpenCode>();

/** Runner, credentials, payloads and the `otto_schedule` plugin for this connection. */
export async function prepareSchedules(client: OpenCode, creds: Credentials): Promise<void> {
  if (prepared.has(client)) return;
  await new ScheduleService(client).prepare(creds);
  await ensureSchedulePlugin(client);
  prepared.add(client);
}

/** Stop offering the tool: drop the config entry. Files, schedules and cron stay. */
export async function removeScheduleTools(client: OpenCode): Promise<void> {
  prepared.delete(client);
  await removeSchedulePlugin(client);
}
