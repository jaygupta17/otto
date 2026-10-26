/**
 * What Otto shows for work that outlives a turn (background teammates and
 * commands), checked in the real UI against a real OpenCode server driven by
 * the scripted model in fake-llm.ts. Each scenario gets its own session.
 *
 * Run through scripts/e2e/run.sh, which starts everything. Or by hand, with
 * OpenCode, the fake model and `bun run dev` already up:
 *   node scripts/e2e/background.cjs [scenario ...]
 * Env: OC_URL (http://127.0.0.1:4917), OC_PASSWORD (pw), APP_URL (http://localhost:1420),
 *      SHOTS (where screenshots go, default .dev/e2e/shots).
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OC = process.env.OC_URL ?? "http://127.0.0.1:4917";
const APP = process.env.APP_URL ?? "http://localhost:1420";
const PASSWORD = process.env.OC_PASSWORD ?? "pw";
const SHOTS = process.env.SHOTS ?? path.join(__dirname, "../../.dev/e2e/shots");
const AUTH = "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, route, body) {
  const res = await fetch(OC + route, { method, headers: { authorization: AUTH, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text).data : undefined;
}
const active = async () => Object.keys((await api("GET", "/api/session/active")) ?? {});
const children = async (sid) => (await api("GET", `/api/session?parentID=${sid}`)).filter((s) => s.parentID === sid).map((s) => s.id);

async function until(what, fn, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(300);
  }
}

/** Send a prompt and wait for that session's turn to end (its background work may go on). */
async function say(sid, text) {
  await api("POST", `/api/session/${sid}/prompt`, { text });
  await until(`${sid} to start`, async () => (await active()).includes(sid) || (await messages(sid)).some((m) => m.type === "user" && JSON.stringify(m).includes(text)), 10000);
  await until(`${sid} to go idle`, async () => !(await active()).includes(sid), 60000);
}
const messages = async (sid) => (await api("GET", `/api/session/${sid}/message?limit=50&order=desc`)) ?? [];
const session = (title) => api("POST", "/api/session", { title }).then((s) => s.id);

// ---------------------------------------------------------------------------

async function open(browser, sid) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(
    ([sid, oc, pw]) => {
      const now = Date.now();
      localStorage.setItem("otto.kv.workspaces.v1", JSON.stringify({ workspaces: [{ id: "e2e", name: "E2E", provider: "custom", baseUrl: oc, createdAt: now, lastUsedAt: now }], activeId: "e2e" }));
      localStorage.setItem("otto.kv.secret.ws.e2e.password", JSON.stringify(pw));
      localStorage.setItem("otto.kv.chat.prefs.e2e", JSON.stringify({ activeId: sid }));
    },
    [sid, OC, PASSWORD],
  );
  const page = await context.newPage();
  await page.goto(APP);
  // Settled: its row in the sidebar, its conversation loaded, the shell list read.
  await page.locator('[aria-current="true"]').first().waitFor({ timeout: 30000 });
  await page.waitForFunction(
    async (sid) => {
      const { useChat } = await import("/src/state/chat.ts");
      return !!useChat.getState().timelines[sid]?.loaded;
    },
    sid,
    { timeout: 30000, polling: 250 },
  );
  await page.waitForTimeout(2500); // the strip waits SETTLE_MS before showing anything
  return { context, page };
}

/** What the composer's strip and the session's sidebar row say right now. */
async function look(page) {
  const strip = page.locator('[aria-label="Running in the background"]');
  // Several fold into a count; open it so every line is there to read.
  const fold = strip.locator("button[aria-expanded=false]");
  if (await fold.count()) await fold.first().click();
  await page.waitForTimeout(250);
  const teammates = await strip.locator('button[aria-label^="Stop "]:not([aria-label="Stop command"])').count();
  const commands = await strip.locator('button[aria-label="Stop command"]').count();
  const text = (await strip.count()) ? (await strip.innerText()).replace(/\s+/g, " ").trim() : "";
  const row = page.locator('[aria-current="true"]').first();
  const sidebar = (await row.count()) ? (await row.innerText()).replace(/\s+/g, " ").trim() : "";
  // The store, for the record: the same module instance the app runs (Vite serves it once).
  const state = await page.evaluate(async () => {
    const { useChat } = await import("/src/state/chat.ts");
    const { useShells } = await import("/src/state/shells.ts");
    const s = useChat.getState();
    return {
      busy: Object.keys(s.busy).filter((k) => s.busy[k]),
      parents: s.parents,
      loaded: Object.fromEntries(Object.entries(s.timelines).map(([k, t]) => [k, t.messages?.length ?? 0])),
      shells: Object.values(useShells.getState().byId).filter((x) => x.status === "running").map((x) => `${x.sessionID}: ${x.command}`),
    };
  });
  return { teammates, commands, text, sidebar, state };
}

const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

// ---------------------------------------------------------------------------
// Scenarios. Each returns { ok, saw, ... }; `expect` says what right looks like.

const scenarios = {
  async "s1-background-teammate"(browser) {
    const sid = await session("s1 background teammate");
    await say(sid, "bg-agent research 60");
    const { context, page } = await open(browser, sid);
    const saw = await look(page);
    await shot(page, "s1");
    await context.close();
    return { expect: "1 teammate line (research), nothing else", ok: saw.teammates === 1 && saw.commands === 0, saw };
  },

  async "s2-old-teammate-after-lazy-load"(browser) {
    const sid = await session("s2 old teammate");
    await say(sid, "bg-agent archaeology 120");
    // Long answers, so the first page fills the screen and nothing older loads on its own.
    for (let i = 1; i <= 5; i++) await say(sid, "essay 40");
    const { context, page } = await open(browser, sid);
    const saw = await look(page);
    await shot(page, "s2");
    await context.close();
    return { expect: "the teammate started 5 turns ago still has its line", ok: saw.teammates === 1, saw };
  },

  async "s3-teammate-foreground-command"(browser) {
    // The teammate's own `sleep` is a call it waits on, not something left running.
    const sid = await session("s3 teammate's own command");
    await say(sid, "bg-agent digger 60");
    const { context, page } = await open(browser, sid);
    const saw = await look(page);
    await shot(page, "s3");
    await context.close();
    return { expect: "no command line for the teammate's foreground sleep; sidebar doesn't say '2 running'", ok: saw.commands === 0 && !/2 running/.test(saw.sidebar), saw };
  },

  async "s4-teammate-finishes-while-watching"(browser) {
    const sid = await session("s4 short teammate");
    await say(sid, "bg-agent quick 20");
    const { context, page } = await open(browser, sid);
    const before = await look(page);
    const [kid] = await children(sid);
    await until("the teammate to finish on the server", async () => !(await active()).includes(kid), 30000);
    await page.waitForTimeout(3000);
    const saw = await look(page);
    await shot(page, "s4");
    await context.close();
    return { expect: "line while it runs, gone once it's done", ok: before.teammates === 1 && saw.teammates === 0 && saw.commands === 0 && !/background/.test(saw.sidebar), before, saw };
  },

  async "s5-teammate-finishes-while-offline"(browser) {
    const sid = await session("s5 offline");
    await say(sid, "bg-agent offline 20");
    const { context, page } = await open(browser, sid);
    const before = await look(page);
    await context.setOffline(true);
    const [kid] = await children(sid);
    await until("the teammate to finish on the server", async () => !(await active()).includes(kid), 30000);
    await page.waitForTimeout(2000);
    await context.setOffline(false);
    await page.waitForTimeout(12000); // reconnect + resync
    const saw = await look(page);
    await shot(page, "s5");
    await context.close();
    return { expect: "after reconnecting, nothing is left claiming to run", ok: before.teammates === 1 && saw.teammates === 0 && saw.commands === 0 && !/background/.test(saw.sidebar), before, saw };
  },

  async "s6-background-command"(browser) {
    const sid = await session("s6 background command");
    await say(sid, "bg-shell 12");
    const { context, page } = await open(browser, sid);
    const before = await look(page);
    await page.waitForTimeout(14000);
    const saw = await look(page);
    await shot(page, "s6");
    await context.close();
    return { expect: "a `sleep 12` line, gone once it exits", ok: before.commands === 1 && saw.commands === 0 && saw.teammates === 0, before, saw };
  },

  async "s7-nested-background-teammate"(browser) {
    // A foreground teammate hands a part to its own background teammate, then finishes.
    const sid = await session("s7 nested");
    await say(sid, "nest-agent grandkid 60");
    const { context, page } = await open(browser, sid);
    const saw = await look(page);
    await shot(page, "s7");
    await context.close();
    return { expect: "the grandchild teammate shows as a teammate (not as a bare `sleep` command)", ok: saw.teammates === 1 && saw.commands === 0, saw };
  },

  async "s8-old-teammate-stopped-note"(browser) {
    // Stop a background teammate from the strip, push it out of the loaded page with chat, reload: it must stay stopped-looking.
    const sid = await session("s8 stopped then old");
    await say(sid, "bg-agent stubborn 120");
    let { context, page } = await open(browser, sid);
    const before = await look(page);
    const stop = page.locator('[aria-label="Running in the background"] button[aria-label^="Stop "]:not([aria-label="Stop command"])');
    if (await stop.count()) await stop.first().click();
    await page.waitForTimeout(4000);
    const after = await look(page);
    await context.close();
    for (let i = 1; i <= 5; i++) await say(sid, "essay 40");
    ({ context, page } = await open(browser, sid));
    const saw = await look(page);
    await shot(page, "s8");
    await context.close();
    return { expect: "stopped teammate gone, and still gone after it scrolls out of the loaded page", ok: before.teammates === 1 && after.teammates === 0 && saw.teammates === 0 && !/background/.test(saw.sidebar), before, after, saw };
  },

  async "s9-old-teammate-after-reconnect"(browser) {
    // Watching live the whole time, so the teammate's call is in memory; then the connection drops (sleep, wifi, phone backgrounded).
    const sid = await session("s9 reconnect");
    const { context, page } = await open(browser, sid);
    await say(sid, "bg-agent survivor 150");
    for (let i = 1; i <= 4; i++) await say(sid, "essay 40");
    await page.waitForTimeout(2500);
    const before = await look(page);
    // What coming back to the app after a while does (App.tsx: visibilitychange -> wake(true)): drop the stream and reconnect.
    await page.evaluate(async () => (await import("/src/state/connection.ts")).useConnection.getState().wake(true));
    await page.waitForTimeout(6000);
    const saw = await look(page);
    await shot(page, "s9");
    await context.close();
    return { expect: "the teammate's line is there before and after a reconnect", ok: before.teammates === 1 && saw.teammates === 1, before, saw };
  },

  async "s10-old-teammate-other-session"(browser) {
    // Open another session and come back: does the strip survive the round trip?
    const sid = await session("s10 round trip");
    const other = await session("s10 elsewhere");
    await say(other, "hello");
    const { context, page } = await open(browser, sid);
    await say(sid, "bg-agent wanderer 150");
    for (let i = 1; i <= 4; i++) await say(sid, "essay 40");
    await page.waitForTimeout(2500);
    const before = await look(page);
    await page.getByText("s10 elsewhere").first().click();
    await page.waitForTimeout(2000);
    await page.getByText("s10 round trip").first().click();
    await page.waitForTimeout(3000);
    const saw = await look(page);
    await shot(page, "s10");
    await context.close();
    return { expect: "the teammate's line is still there after switching away and back", ok: before.teammates === 1 && saw.teammates === 1, before, saw };
  },
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const want = process.argv.slice(2);
  const names = Object.keys(scenarios).filter((n) => !want.length || want.some((w) => n.startsWith(w)));
  const browser = await chromium.launch();
  // Independent sessions, so a few can run side by side; more and a dev-mode page load gets slow enough to skew the timings.
  const results = [];
  const queue = [...names];
  const worker = async () => {
    for (let name; (name = queue.shift()); ) {
      try {
        results.push({ name, ...(await scenarios[name](browser)) });
      } catch (e) {
        results.push({ name, ok: false, error: String(e?.message ?? e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Number(process.env.PARALLEL ?? 3) }, worker));
  results.sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
  await browser.close();
  for (const r of results) {
    console.log(`\n${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.expect ? `  (want: ${r.expect})` : ""}`);
    if (r.error) console.log(`  error: ${r.error}`);
    for (const k of ["before", "after", "saw"]) {
      const v = r[k];
      if (!v) continue;
      console.log(`  ${k}: strip=${JSON.stringify(v.text)} teammates=${v.teammates} commands=${v.commands} sidebar=${JSON.stringify(v.sidebar)}`);
      if (k === "saw") console.log(`  state: ${JSON.stringify(v.state)}`);
    }
  }
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed; screenshots in ${SHOTS}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
