/**
 * The handful of provider operations Settings needs, behind one table so the
 * UI doesn't special-case each cloud: check a key, read a machine's state,
 * put it to sleep, wake it.
 */
import type { CloudId } from "../../state/workspaces";
import { BoatClient } from "./boat";
import { boxdHibernate, boxdMachine, boxdWake, humanizeBoxd, verifyBoxdKey } from "./boxd";
import { E2BClient } from "./e2b";
import { DaytonaClient } from "./daytona";

export interface CloudOps {
  name: string;
  dashboard: string;
  verify(key: string): Promise<unknown>;
  status(key: string, id: string): Promise<string>;
  sleep(key: string, id: string): Promise<unknown>;
  wake(key: string, id: string): Promise<unknown>;
  isAsleep(status: string): boolean;
  /** Toast after putting it to sleep. */
  sleptNote: string;
  errorText?(e: unknown): string;
}

export const CLOUD_OPS: Record<CloudId, CloudOps> = {
  boat: {
    name: "Boat",
    dashboard: "https://boat.dev/dashboard",
    verify: (k) => new BoatClient(k).me(),
    status: async (k, id) => (await new BoatClient(k).get(id)).state,
    sleep: (k, id) => new BoatClient(k).stop(id),
    wake: (k, id) => new BoatClient(k).resume(id),
    isAsleep: (s) => s === "archived" || s === "archiving",
    sleptNote: "It costs nothing while asleep.",
  },
  boxd: {
    name: "boxd",
    dashboard: "https://app.boxd.sh",
    verify: verifyBoxdKey,
    status: async (k, id) => (await boxdMachine(k, id)).status,
    sleep: boxdHibernate,
    wake: boxdWake,
    isAsleep: (s) => s === "hibernated" || s === "suspended" || s === "stopped",
    sleptNote: "You only pay for its disk while it sleeps.",
    errorText: (e) => humanizeBoxd(e).message,
  },
  e2b: {
    name: "E2B",
    dashboard: "https://e2b.dev/dashboard",
    verify: (k) => new E2BClient(k).verify(),
    status: async (k, id) => (await new E2BClient(k).get(id)).state,
    sleep: (k, id) => new E2BClient(k).pause(id),
    wake: (k, id) => new E2BClient(k).connect(id, 1800),
    isAsleep: (s) => s === "paused",
    sleptNote: "Paused with everything kept. It resumes when you open it.",
  },
  daytona: {
    name: "Daytona",
    dashboard: "https://app.daytona.io/dashboard",
    verify: (k) => new DaytonaClient(k).verify(),
    status: async (k, id) => (await new DaytonaClient(k).get(id)).state,
    sleep: (k, id) => new DaytonaClient(k).stop(id),
    wake: (k, id) => new DaytonaClient(k).start(id),
    isAsleep: (s) => s === "stopped" || s === "archived" || s === "paused",
    sleptNote: "Stopped. Files are kept; Otto restarts the agent when you come back.",
  },
};
