/**
 * "Use an existing sandbox": attach Otto to a machine the provider already
 * has, instead of provisioning a new one. Every cloud's revive* already
 * handles waking, repairing the agent server and building the endpoint, so
 * adopting is exactly reviving with an id from the key's own account.
 *
 * Attaching keeps the agent server's password when it can read it from the
 * machine, so a healthy server isn't restarted and other devices stay signed
 * in. When it can't, revive* restarts the server with a fresh password.
 */
import type { CloudId } from "../../state/workspaces";
import { BoatClient, RUNNING_STATES, readPasswordScript, wrapScript } from "./boat";
import { E2BClient, reviveE2B } from "./e2b";
import { DaytonaClient, reviveDaytona } from "./daytona";
import { waitUntilRunning, reviveBoat, type SetupStepId, type StepUpdate } from "./provision";
import { RUNNING as DAYTONA_RUNNING, waitRunning } from "./daytona";
import { boxdClient, reviveBoxd, wake as wakeBoxd } from "./boxd";
import { OpenCode, type ServerEndpoint } from "../opencode/client";

export interface SandboxEntry {
  id: string;
  name: string;
  state: string;
}

/** True when the sandbox exists at all; the message on false is user-facing. */
export async function sandboxExists(cloud: CloudId, apiKey: string, id: string): Promise<boolean> {
  if (cloud === "boat") return !!(await new BoatClient(apiKey).get(id).catch(() => null));
  if (cloud === "e2b") {
    const s = await new E2BClient(apiKey).get(id).catch(() => null);
    return !!s && !("state" in s && s.state === "not_found");
  }
  if (cloud === "daytona") {
    const s = await new DaytonaClient(apiKey).get(id).catch(() => null);
    return !!s && !("state" in s && (s.state === "destroyed" || s.state === "error"));
  }
  return !!(await boxdClient(apiKey).machines.get(id).catch(() => null));
}

/** Machines this key can see, ready to attach. */
export async function listSandboxes(cloud: CloudId, apiKey: string): Promise<SandboxEntry[]> {
  if (cloud === "boat") {
    const all = await new BoatClient(apiKey).list();
    return all
      .filter((s: { state: string }) => !["cancelled", "archived"].includes(s.state))
      .map((s) => ({ id: s.id, name: s.name || s.id, state: s.state }));
  }
  if (cloud === "e2b") {
    const list = await new E2BClient(apiKey).list();
    return list.map((s) => ({ id: s.sandboxID, name: s.sandboxID.slice(0, 12), state: s.state ?? "running" }));
  }
  if (cloud === "daytona") {
    // list() filters on labels: { app: "otto" } — the same stamps create() writes,
    // so a key shared with other tooling only ever shows Otto's machines.
    const list = await new DaytonaClient(apiKey).list();
    return list.map((s) => ({ id: s.id, name: s.name || s.id.slice(0, 12), state: s.state }));
  }
  const made = await boxdClient(apiKey).machines.list();
  return made.map((m) => ({ id: m.id, name: m.name || m.id, state: m.status }));
}

/** One revive per cloud, behind a table so the caller never switches on ids. */
export async function attachExisting(opts: {
  cloud: CloudId;
  apiKey: string;
  sandboxId: string;
  /** Fallback password, written if the machine has none stored. */
  password: string;
  /** E2B only: how long it keeps resuming. */
  sleepAfter?: number;
  report: (u: StepUpdate) => void;
  signal: AbortSignal;
}): Promise<{ endpoint: ServerEndpoint; sandboxId: string; version?: string }> {
  const { cloud, apiKey, sandboxId, sleepAfter, report, signal } = opts;
  const step = (id: SetupStepId, state: StepUpdate["state"], detail?: string) => report({ step: id, state, detail });
  // "machine" covers the wake; "install"/"server" are the repair internals.
  const wires = (phase: "waking" | "repairing", detail?: string) =>
    step(phase === "waking" ? "machine" : "server", "active", detail);

  step("verify", "done");
  step("machine", "active", "Waking your machine");
  const stored = await readStoredPassword(cloud, apiKey, sandboxId, signal, wires);
  step("machine", "done");
  const password = stored || opts.password;

  step("install", "active", "Checking the agent server");
  const endpoint =
    cloud === "e2b"
      ? await reviveE2B(apiKey, sandboxId, password, sleepAfter ?? 1800, wires, signal)
      : cloud === "daytona"
        ? await reviveDaytona(apiKey, sandboxId, password, wires, signal)
        : cloud === "boxd"
          ? await reviveBoxd(apiKey, sandboxId, password, wires, signal)
          : await reviveBoat(apiKey, sandboxId, password, wires, signal);
  step("install", "done");
  step("server", "done");
  step("tunnel", "done");
  step("hello", "active");
  const info = await new OpenCode(endpoint).info(signal).catch(() => null);
  step("hello", "done");
  return { endpoint, sandboxId, version: info?.version };
}

/** Wake the machine just enough to read its env file. */
async function readStoredPassword(
  cloud: CloudId,
  apiKey: string,
  id: string,
  signal: AbortSignal,
  report: (phase: "waking" | "repairing", detail?: string) => void,
): Promise<string | null> {
  try {
    if (cloud === "boat") {
      const boat = new BoatClient(apiKey);
      let sb = await boat.get(id, signal);
      if (!RUNNING_STATES.includes(sb.state)) {
        report("waking", "Resuming from snapshot");
        if (sb.state === "archived" || sb.state === "error") await boat.resume(id);
        sb = await waitUntilRunning(boat, id, signal, (d) => report("waking", d));
      }
      const r = await boat.command(id, wrapScript(readPasswordScript()), 30, signal);
      return r.success ? (r.stdout.trim() || null) : null;
    }
    if (cloud === "e2b") {
      const e2b = new E2BClient(apiKey);
      const ref = await e2b.connect(id, 1800, signal);
      const r = await e2b.exec(ref, readPasswordScript(), 30, signal);
      return r.exitCode === 0 ? (r.stdout.trim() || null) : null;
    }
    if (cloud === "daytona") {
      const day = new DaytonaClient(apiKey);
      let sb = await day.get(id, signal);
      if (!DAYTONA_RUNNING.includes(sb.state)) {
        report("waking", "Starting your sandbox");
        if (["stopped", "archived", "paused"].includes(sb.state)) await day.start(id);
        sb = await waitRunning(day, id, signal, (d) => report("waking", d));
      }
      const r = await day.exec(sb, readPasswordScript(), 30, signal);
      return r.exitCode === 0 ? (r.stdout.trim() || null) : null;
    }
    const boxd = boxdClient(apiKey);
    let m = await boxd.machines.get(id);
    if (m.status !== "running") {
      report("waking", "Waking your machine");
      m = await wakeBoxd(boxd, m, signal, (d) => report("waking", d));
    }
    const r = await boxd.machines.exec(id, { command: ["bash", "-lc", wrapScript(readPasswordScript())], timeout: 30_000 });
    return r.exitCode === 0 ? ((r as { stdout?: string }).stdout?.trim() || null) : null;
  } catch {
    // Reading failed — the caller rotates instead, and revive* will restart the daemon.
    return null;
  }
}
