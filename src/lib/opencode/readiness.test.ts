import { afterEach, describe, expect, test } from "bun:test";
import { OpenCode } from "./client";
import { waitForCatalog } from "./readiness";

/**
 * These run against real HTTP servers in-process, so the client's own status
 * parsing (503 message, 401, empty bodies) is part of what is tested.
 */

type Reply = { status: number; body?: unknown; delayMs?: number };

const servers: Array<{ stop(force?: boolean): void }> = [];

afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true);
});

function serve(handler: (path: string, n: number) => Reply) {
  const calls = new Map<string, number>();
  const inFlight = new Map<string, number>();
  const maxInFlight = new Map<string, number>();
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const n = (calls.get(path) ?? 0) + 1;
      calls.set(path, n);
      const live = (inFlight.get(path) ?? 0) + 1;
      inFlight.set(path, live);
      maxInFlight.set(path, Math.max(maxInFlight.get(path) ?? 0, live));
      try {
        const reply = handler(path, n);
        if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
        return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
          status: reply.status,
          headers: { "content-type": "application/json" },
        });
      } finally {
        inFlight.set(path, live - 1);
      }
    },
  });
  servers.push(server);
  return {
    client: new OpenCode({ baseUrl: server.url.origin, password: "" }),
    calls: (path: string) => calls.get(path) ?? 0,
    maxInFlight: (path: string) => maxInFlight.get(path) ?? 0,
  };
}

/** Fake clock advanced by the injected sleep, so the poll schedule runs instantly. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const AGENTS = [{ id: "build", name: "Build", mode: "primary" }];
const MODELS = [{ providerID: "opencode", id: "big-pickle", name: "Big Pickle" }];

const ok = (data: unknown[]): Reply => ({ status: 200, body: { data } });
const activating: Reply = { status: 503, body: { message: "Location plugins did not finish activating" } };

describe("waitForCatalog", () => {
  test("503 while plugins activate, then ready", async () => {
    const srv = serve((path, n) =>
      path === "/api/model" ? (n < 3 ? activating : ok(MODELS)) : n < 3 ? ok([]) : ok(AGENTS),
    );
    const clock = fakeClock();
    const result = await waitForCatalog(srv.client, { budgetMs: 10_000, now: clock.now, sleep: clock.sleep });

    expect(result.phase).toBe("ready");
    expect(result.ok).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.agents).toHaveLength(1);
    expect(result.models).toHaveLength(1);
    expect(srv.calls("/api/model")).toBe(3);
  });

  test("two empty 200s under a second stay warming; populated wins", async () => {
    const srv = serve((path, n) => (n <= 2 ? ok([]) : path === "/api/model" ? ok(MODELS) : ok(AGENTS)));
    const clock = fakeClock();
    const phases: string[] = [];
    const result = await waitForCatalog(srv.client, {
      budgetMs: 10_000,
      now: clock.now,
      // 600ms between polls is under the 1s stability window.
      sleep: async (ms) => clock.advance(Math.max(ms, 600)),
      onPhase: (phase) => phases.push(phase),
    });

    expect(result.phase).toBe("ready");
    expect(result.agents.length + result.models.length).toBe(2);
    expect(phases.slice(0, 2)).toEqual(["warming", "warming"]);
  });

  test("a genuinely empty catalog is accepted after two stable reads", async () => {
    const srv = serve(() => ok([]));
    const clock = fakeClock();
    const result = await waitForCatalog(srv.client, {
      budgetMs: 10_000,
      now: clock.now,
      // Every gap clears the 1s stability window.
      sleep: async () => clock.advance(1_000),
    });

    expect(result.phase).toBe("ready");
    expect(result.ok).toBe(true);
    expect(result.agents).toHaveLength(0);
    expect(result.models).toHaveLength(0);
  });

  test("permanent 503 ends degraded when the budget runs out", async () => {
    const srv = serve(() => activating);
    const clock = fakeClock();
    const result = await waitForCatalog(srv.client, { budgetMs: 2_000, now: clock.now, sleep: clock.sleep });

    expect(result.phase).toBe("degraded");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("timeout");
    expect(result.timedOut).toBe(true);
    expect(srv.calls("/api/model")).toBeGreaterThan(1);
  });

  test("401 stops at once with an auth reason", async () => {
    const srv = serve((path) =>
      path === "/api/model" ? { status: 401, body: { message: "Unauthorized" } } : ok(AGENTS),
    );
    const clock = fakeClock();
    const result = await waitForCatalog(srv.client, { budgetMs: 10_000, now: clock.now, sleep: clock.sleep });

    expect(result.phase).toBe("degraded");
    expect(result.reason).toBe("auth");
    expect(result.timedOut).toBe(false);
    // The first round only; no retries.
    expect(srv.calls("/api/model")).toBe(1);
  });

  test("abort mid-wait returns aborted and never reports ready", async () => {
    const srv = serve(() => activating);
    const controller = new AbortController();
    const clock = fakeClock();
    const phases: string[] = [];
    const result = await waitForCatalog(srv.client, {
      budgetMs: 10_000,
      signal: controller.signal,
      now: clock.now,
      sleep: async () => controller.abort(),
      onPhase: (phase) => phases.push(phase),
    });

    expect(result.phase).toBe("aborted");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("aborted");
    expect(result.timedOut).toBe(false);
    expect(phases).not.toContain("ready");
  });

  test("does not overlap catalog calls while polling", async () => {
    const srv = serve((path) => (path === "/api/model" ? { ...ok(MODELS), delayMs: 25 } : { ...ok(AGENTS), delayMs: 25 }));
    const clock = fakeClock();
    const result = await waitForCatalog(srv.client, { budgetMs: 5_000, now: clock.now, sleep: clock.sleep });

    expect(result.phase).toBe("ready");
    expect(srv.calls("/api/model")).toBe(1);
    expect(srv.maxInFlight("/api/model")).toBe(1);
    expect(srv.maxInFlight("/api/agent")).toBe(1);
  });

  test("a workspace switch discards the stale wait", async () => {
    // This server would eventually answer ready.
    const stale = serve(() => ({ ...ok(MODELS), delayMs: 60 }));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const oldPhases: string[] = [];
    const old = await waitForCatalog(stale.client, {
      budgetMs: 10_000,
      signal: controller.signal,
      onPhase: (phase) => oldPhases.push(phase),
    });
    expect(old.phase).toBe("aborted");
    expect(oldPhases).not.toContain("ready");

    // The workspace now in front keeps its own client and gets its own result.
    const current = serve((path) => (path === "/api/model" ? ok(MODELS) : ok(AGENTS)));
    const next = await waitForCatalog(current.client, { budgetMs: 5_000 });
    expect(next.phase).toBe("ready");
    expect(current.calls("/api/model")).toBe(1);
  });
});
