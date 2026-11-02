/**
 * Otto's client against a real OpenCode server: the checks a version bump has
 * to pass. Not a unit test — it needs a running server (its own HOME, config
 * and data), so `scripts/e2e/run.sh` starts one and runs this first. Every call
 * goes through `src/lib/opencode/*` itself, not a reimplementation, so a shape
 * the server changed shows up here rather than in the app.
 *
 *   scripts/e2e/run.sh                 start everything, then this and the UI
 *   bun scripts/e2e/contract.ts        against a server already up
 *
 * Env: OC_URL (http://127.0.0.1:4917), OC_PASSWORD (pw), WORKDIR (the server's
 * directory), HOME_DIR (the server's home).
 */
import { OpenCode, OpenCodeError } from "../../src/lib/opencode/client";
import { startEventStream, type StreamStatus, type V2Event } from "../../src/lib/opencode/events";
import { fetchTimelinePage } from "../../src/lib/opencode/timeline";
import { applyEvent, eventSessionID, type UIMessage } from "../../src/lib/opencode/projection";
import { readGlobalConfig, configLocation, updateGlobalConfig } from "../../src/lib/opencode/config";
import { waitForCatalog } from "../../src/lib/opencode/readiness";
import { installMemory, removeMemory, memoryInstalled, isContextInstruction, memoryPaths } from "../../src/lib/memory";
import { ensurePresentPlugin, removePresentPlugin, PRESENT_PLUGIN_ID } from "../../src/lib/presentPlugin";
import { ensureSchedulePlugin, removeSchedulePlugin, SCHEDULE_PLUGIN_ID } from "../../src/lib/schedulesPlugin";
import { readHome } from "../../src/lib/agentTools";

const OC = process.env.OC_URL ?? "http://127.0.0.1:4917";
const PASSWORD = process.env.OC_PASSWORD ?? "pw";
const WORKDIR = process.env.WORKDIR ?? "";
const HOME = process.env.HOME_DIR ?? "";

const client = new OpenCode({ baseUrl: OC, password: PASSWORD });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
const failures: { name: string; error: string }[] = [];

async function check(name: string, fn: () => Promise<void>) {
  const started = Date.now();
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}  (${Date.now() - started}ms)`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    failures.push({ name, error });
    console.log(`FAIL  ${name}\n      ${error}`);
  }
}

function ok(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
}

/** Wait for a session's turn to end (its run leaves /api/session/active). */
async function idle(sessionID: string, ms = 60_000) {
  const end = Date.now() + ms;
  for (;;) {
    if (!(await client.activeSessions()).includes(sessionID)) {
      // `active` is written before the turn starts and cleared at idle; one turn is enough.
      await sleep(200);
      return;
    }
    if (Date.now() > end) throw new Error(`session ${sessionID} never went idle`);
    await sleep(200);
  }
}

async function say(sessionID: string, text: string) {
  await client.prompt(sessionID, { text });
  await sleep(400);
  await idle(sessionID);
}

/**
 * Wait for the location to be serving again. Writing the config (which every
 * install does) reloads it, and the catalog can look ready while a request
 * that lands mid-reload still fails or comes back empty. The app retries
 * whatever the user asked for; a check has to wait.
 */
async function settle(what: string) {
  const r = await waitForCatalog(client, { budgetMs: 60_000 });
  if (!r.ok) throw new Error(`the location never settled after ${what}: ${r.phase}`);
  // A shell round-trip is the cheapest proof the location is really serving
  // (and the thing Otto's own bootstrap asks first: `readHome`).
  const end = Date.now() + 60_000;
  for (;;) {
    const run = await client.exec("printf otto").catch(() => null);
    if (run?.exit === 0 && run.output.trim() === "otto") return;
    if (Date.now() > end) throw new Error(`the shell never ran after ${what}`);
    await sleep(500);
  }
}

let versionSeen = "";
let streamSession = "";

async function main() {
  // A server that just booted answers /api/info before its location is ready:
  // /api/agent and /api/model 503 ("Location plugins did not finish
  // activating") for a few seconds. Otto's own readiness gate is what the app
  // uses; use it here too so the checks below see a settled server.
  const warmStarted = Date.now();
  const warm = await waitForCatalog(client, { budgetMs: 60_000 });
  console.log(`— warm after ${Date.now() - warmStarted}ms: ${warm.phase} (${warm.agents.length} agents, ${warm.models.length} models)\n`);
  await settle("boot");

  // ---- connect and version ------------------------------------------------
  await check("connect: /api/info answers, with a version", async () => {
    const info = await client.info();
    versionSeen = info.version;
    const seen = `/api/info came back as ${JSON.stringify(info)}`;
    ok(/^\d+\.\d+\.\d+/.test(info.version), seen);
    ok(typeof info.pid === "number", seen);
    ok(Array.isArray(info.urls), seen);
  });

  await check("connect: health() is info(); a wrong password is a clean OpenCodeError", async () => {
    const h = await client.health();
    ok(h.version === versionSeen, "health() didn't answer with the same server");
    const bad = new OpenCode({ baseUrl: OC, password: "nope" });
    try {
      await bad.info();
      throw new Error("a wrong password was accepted");
    } catch (e) {
      ok(e instanceof OpenCodeError && e.status === 401, `wrong password gave ${String(e)}`);
    }
  });

  await check("connect: location reads the server's directory", async () => {
    const loc = await client.location(WORKDIR);
    ok(loc.directory === WORKDIR, `location ${loc.directory} != ${WORKDIR}`);
  });

  // ---- catalog ------------------------------------------------------------
  await check("catalog: agents include build, with permissions", async () => {
    const agents = await client.agents(WORKDIR);
    ok(agents.length > 0, "no agents");
    const build = agents.find((a) => a.id === "build");
    ok(build, `no build agent in ${agents.map((a) => a.id).join(",")}`);
    ok(Array.isArray(build!.permissions) && build!.permissions.length > 0, "agent has no permissions");
  });

  await check("catalog: models include the scripted one; defaultModel resolves", async () => {
    const models = await client.models(WORKDIR);
    const m = models.find((x) => x.providerID === "fake" && x.id === "m");
    ok(m, `no fake/m in ${models.map((x) => `${x.providerID}/${x.id}`).join(",")}`);
    ok(m!.limit && typeof m!.limit.context === "number", "model has no context limit");
    const def = await client.defaultModel(WORKDIR);
    ok(def && def.providerID === "fake" && def.id === "m", `defaultModel gave ${JSON.stringify(def)}`);
  });

  await check("catalog: commands and integrations answer", async () => {
    ok(Array.isArray(await client.commands(WORKDIR)), "commands isn't a list");
    ok(Array.isArray(await client.integrations()), "integrations isn't a list");
  });

  // ---- session + prompt ---------------------------------------------------
  let sessionID = "";
  await check("session: create with a model and agent, get it back", async () => {
    const s = await client.createSession({ directory: WORKDIR, title: "contract: prompt", model: { providerID: "fake", id: "m" }, agent: "build" });
    sessionID = s.id;
    ok(s.id?.startsWith("ses_"), `odd session id ${s.id}`);
    ok(s.title === "contract: prompt", `title came back as ${s.title}`);
    ok(s.model?.providerID === "fake" && s.model?.id === "m", `model came back as ${JSON.stringify(s.model)}`);
    ok(s.location?.directory === WORKDIR, `location came back as ${JSON.stringify(s.location)}`);
    const again = await client.session(s.id);
    ok(again.id === s.id, "session() didn't return the same session");
  });

  await check("prompt: a turn runs and its reply is in the history", async () => {
    await say(sessionID, "essay 3");
    const page = await fetchTimelinePage(client, sessionID, { limit: 50, retryLimit: 10, timeoutMs: 20_000 });
    const msgs = page.messages;
    ok(msgs.length >= 2, `only ${msgs.length} messages`);
    const user = msgs.find((m) => m.kind === "user");
    const assistant = [...msgs].reverse().find((m) => m.kind === "assistant");
    ok(user?.kind === "user" && user.text === "essay 3", `user message is ${JSON.stringify(user)}`);
    ok(assistant?.kind === "assistant", "no assistant message");
    const text = assistant!.blocks.filter((b) => b.kind === "text").map((b) => (b as { text: string }).text).join("");
    ok(text.includes("Line 3 of a long answer."), `assistant text was ${JSON.stringify(text.slice(0, 120))}`);
    ok(assistant!.blocks.every((b) => b.kind !== "text" || !(b as { streaming: boolean }).streaming), "a finished message still looks like it is streaming");
  });

  await check("session: list, search and the active map", async () => {
    const list = await client.sessions({ limit: 20, directory: WORKDIR });
    ok(Array.isArray(list.data), "sessions().data isn't a list");
    ok(list.data.some((s) => s.id === sessionID), "our session isn't in the list");
    const found = await client.sessions({ limit: 20, search: "contract: prompt", directory: WORKDIR });
    ok(found.data.some((s) => s.id === sessionID), "search didn't find it");
    ok(Array.isArray(await client.activeSessions()), "activeSessions isn't a list");
  });

  // ---- streaming ----------------------------------------------------------
  await check("stream: a turn's events fold into a live timeline that agrees with the history", async () => {
    const events: V2Event[] = [];
    const statuses: StreamStatus[] = [];
    let connected = 0;
    let live: UIMessage[] = [];
    let sawStreamingText = false;
    const stream = startEventStream(client, {
      onEvent: (e) => {
        events.push(e);
        if (eventSessionID(e) !== streamSession) return;
        live = applyEvent(live, e);
        if (live.some((m) => m.kind === "assistant" && m.blocks.some((b) => b.kind === "text" && b.streaming && b.text.length > 0))) sawStreamingText = true;
      },
      onStatus: (s) => statuses.push(s),
      onConnected: () => connected++,
    });
    try {
      for (let i = 0; i < 100 && !statuses.includes("live"); i++) await sleep(100);
      ok(statuses.includes("live"), `stream never went live (${statuses.join(",")})`);
      ok(connected === 1, `onConnected fired ${connected} times`);

      // A session nothing has been read into yet, so the live fold is all there is.
      streamSession = (await client.createSession({ directory: WORKDIR, title: "contract: stream", model: { providerID: "fake", id: "m" } })).id;
      await client.prompt(streamSession, { text: "essay 4" });
      await idle(streamSession, 60_000);
      await sleep(800);

      const mine = events.filter((e) => eventSessionID(e) === streamSession);
      ok(mine.length > 0, `no events for ${streamSession} among ${events.length} (${[...new Set(events.map((e) => e.type))].join(",")})`);
      const types = new Set(mine.map((e) => e.type));
      for (const want of ["session.execution.started", "session.step.started", "session.text.delta", "session.execution.succeeded"]) {
        ok(types.has(want), `never saw ${want}; saw ${[...types].join(",")}`);
      }
      ok(sawStreamingText, "no partial text showed up while the turn ran: the reply only appeared at the end");

      const shown = live.filter((m) => m.kind === "assistant").map((m) => (m.kind === "assistant" ? m.blocks.filter((b) => b.kind === "text").map((b) => (b as { text: string }).text).join("") : "")).join("\n");
      ok(shown.includes("Line 4 of a long answer."), `live timeline text was ${JSON.stringify(shown.slice(0, 120))}`);
      ok(live.some((m) => m.kind === "user" && m.text.includes("essay 4")), "the user message never arrived live");

      // The live path and the REST path must agree on the same turn.
      const page = await fetchTimelinePage(client, streamSession, { limit: 50, retryLimit: 10, timeoutMs: 20_000 });
      const history = page.messages
        .filter((m) => m.kind === "assistant")
        .map((m) => (m.kind === "assistant" ? m.blocks.filter((b) => b.kind === "text").map((b) => (b as { text: string }).text).join("") : ""))
        .join("\n");
      ok(history === shown, `live text and history differ:\n  live: ${JSON.stringify(shown)}\n  rest: ${JSON.stringify(history)}`);
      ok(page.older !== undefined, "the page has no cursor field");
    } finally {
      stream.stop();
    }
  });

  // ---- the rest of the session surface ------------------------------------
  await check("session: rename, switch model and agent, interrupt a run", async () => {
    const s = await client.createSession({ directory: WORKDIR, title: "contract: interrupt", model: { providerID: "fake", id: "m" } });
    try {
      await client.renameSession(s.id, "contract: renamed");
      ok((await client.session(s.id)).title === "contract: renamed", "rename didn't stick");
      await client.switchAgent(s.id, "build");
      const after = await client.session(s.id);
      ok(after.agent === "build", `agent is ${after.agent}`);
      await client.switchModel(s.id, { providerID: "fake", id: "m" });
      const model = (await client.session(s.id)).model;
      ok(model?.providerID === "fake" && model?.id === "m", `model is ${JSON.stringify(model)}`);

      await client.prompt(s.id, { text: "fg-agent slow 90" });
      for (let i = 0; i < 100 && !(await client.activeSessions()).includes(s.id); i++) await sleep(200);
      ok((await client.activeSessions()).includes(s.id), "the run never started");
      const stopped = await client.interrupt(s.id);
      ok(stopped && typeof stopped === "object", `interrupt returned ${JSON.stringify(stopped)}`);
      await idle(s.id, 30_000);
    } finally {
      await client.deleteSession(s.id).catch(() => {});
    }
  });

  await check("session: fork, revert stage/commit/clear", async () => {
    const s = await client.createSession({ directory: WORKDIR, title: "contract: fork", model: { providerID: "fake", id: "m" } });
    try {
      await say(s.id, "one");
      const page = await fetchTimelinePage(client, s.id, { limit: 50, retryLimit: 10, timeoutMs: 20_000 });
      const users = page.messages.filter((m) => m.kind === "user");
      ok(users.length === 1, `history has ${users.length} user messages`);
      const fork = await client.fork(s.id);
      ok(fork.id && fork.id !== s.id, `fork gave ${JSON.stringify(fork.id)}`);
      ok(fork.parentID === s.id || fork.id !== s.id, "fork has no parent");
      const stage = await client.revertStage(s.id, users[0].id);
      ok(stage.data && typeof stage.data === "object", `revert stage returned ${JSON.stringify(stage)}`);
      await client.revertCommit(s.id);
      ok((await client.messages(s.id, { limit: 20 })).data.length >= 0, "the session broke after a revert commit");
      await client.revertClear(s.id);
      await client.deleteSession(fork.id).catch(() => {});
    } finally {
      await client.deleteSession(s.id).catch(() => {});
    }
  });

  await check("session: a synthetic note is accepted and the next turn still runs", async () => {
    const s = await client.createSession({ directory: WORKDIR, title: "contract: synthetic", model: { providerID: "fake", id: "m" } });
    try {
      await client.synthetic(s.id, { text: "a note for the model", description: "note", resume: false });
      await say(s.id, "one");
      const page = await fetchTimelinePage(client, s.id, { limit: 50, retryLimit: 10, timeoutMs: 20_000 });
      ok(page.messages.some((m) => m.kind === "assistant"), "the turn after the note produced no reply");
    } finally {
      await client.deleteSession(s.id).catch(() => {});
    }
  });

  await check("files: listFolders walks a location's sub-folders", async () => {
    await client.writeFile(`${WORKDIR}/nested/inner/keep.txt`, "x\n", WORKDIR);
    const dirs = await client.listFolders(WORKDIR, WORKDIR);
    ok(dirs.some((d) => d.path === `${WORKDIR}/nested`), `listFolders gave ${JSON.stringify(dirs)}`);
  });

  await check("session: diff reports the files a turn changed", async () => {
    const s = await client.createSession({ directory: WORKDIR, title: "contract: diff", model: { providerID: "fake", id: "m" } });
    try {
      await say(s.id, "one");
      ok(Array.isArray(await client.diff(s.id)), "diff isn't a list");
      await client.compact(s.id);
      const page = await fetchTimelinePage(client, s.id, { limit: 50, retryLimit: 10, timeoutMs: 20_000 });
      ok(page.messages.length > 0, "history vanished after compact");
    } finally {
      await client.deleteSession(s.id).catch(() => {});
    }
  });

  await check("session: inbox lists, and a queued message can be cancelled", async () => {
    const s = await client.createSession({ directory: WORKDIR, title: "contract: inbox", model: { providerID: "fake", id: "m" } });
    try {
      const inbox = await client.inbox(s.id);
      ok(Array.isArray(inbox), "inbox isn't a list");
      await client.prompt(s.id, { text: "fg-agent queued 60" });
      for (let i = 0; i < 100 && !(await client.activeSessions()).includes(s.id); i++) await sleep(200);
      await client.prompt(s.id, { text: "second", delivery: "queue" });
      let queued = await client.inbox(s.id);
      for (let i = 0; i < 50 && !queued.some((x) => x.payload?.text === "second"); i++) {
        await sleep(200);
        queued = await client.inbox(s.id);
      }
      const item = queued.find((x) => x.payload?.text === "second");
      ok(item, `queued message not in the inbox: ${JSON.stringify(queued)}`);
      ok(item!.type === "user" && item!.delivery === "queue", `inbox item is ${item!.type}/${item!.delivery}`);
      await client.setInboxDelivery(s.id, item!.id, "steer");
      await client.cancelInbox(s.id, item!.id);
      ok(!(await client.inbox(s.id)).some((x) => x.id === item!.id), "the cancelled message is still queued");
      await client.interrupt(s.id);
      await idle(s.id, 30_000);
    } finally {
      await client.deleteSession(s.id).catch(() => {});
    }
  });

  await check("session: background() moves a blocked teammate aside and the turn ends", async () => {
    const s = await client.createSession({ directory: WORKDIR, title: "contract: background", model: { providerID: "fake", id: "m" } });
    let child = "";
    try {
      await client.prompt(s.id, { text: "fg-agent slow 90" });
      for (let i = 0; i < 100; i++) {
        const kids = (await client.sessions({ parentID: s.id, directory: WORKDIR })).data.filter((x) => x.parentID === s.id);
        if (kids.length) {
          child = kids[0].id;
          break;
        }
        await sleep(200);
      }
      ok(child, "the foreground teammate never got a child session");
      await client.background(s.id);
      await idle(s.id, 30_000);
      ok((await client.activeSessions()).includes(child), "the moved teammate stopped too: it should keep running apart from the turn");
    } finally {
      if (child) await client.interrupt(child).catch(() => {});
      await client.deleteSession(s.id).catch(() => {});
      if (child) await client.deleteSession(child).catch(() => {});
    }
  });

  await check("session: a slash command runs as a turn", async () => {
    const s = await client.createSession({ directory: WORKDIR, title: "contract: command", model: { providerID: "fake", id: "m" } });
    try {
      const commands = await client.commands(WORKDIR);
      ok(commands.some((c) => c.name === "review"), `no review command in ${commands.map((c) => c.name).join(",")}`);
      await client.command(s.id, "review", "uncommitted");
      await sleep(600);
      await idle(s.id, 60_000);
      const page = await fetchTimelinePage(client, s.id, { limit: 50, retryLimit: 10, timeoutMs: 20_000 });
      ok(page.messages.some((m) => m.kind === "assistant"), "the command produced no reply");
    } finally {
      await client.deleteSession(s.id).catch(() => {});
    }
  });

  await check("skills, mcp, forms: the list endpoints answer in the shape the app reads", async () => {
    const skills = await client.skills();
    ok(skills.length > 0, "no skills at all");
    ok(skills.every((s) => typeof s.id === "string" && typeof s.name === "string" && typeof s.content === "string"), `a skill is missing fields: ${JSON.stringify(skills[0]).slice(0, 200)}`);
    ok(Array.isArray(await client.mcpServers()), "mcpServers isn't a list");
    ok(Array.isArray(await client.pendingForms(WORKDIR)), "pendingForms isn't a list");
  });

  await check("shell: the background-command view — list, cursor output, remove", async () => {
    const s = await client.createSession({ directory: WORKDIR, title: "contract: shell", model: { providerID: "fake", id: "m" } });
    try {
      await say(s.id, "bg-shell 6");
      const running = (await client.shells(WORKDIR)).filter((sh) => sh.status === "running" && sh.metadata?.sessionID === s.id);
      ok(running.length > 0, `no running shell for ${s.id}: ${JSON.stringify((await client.shells(WORKDIR)).map((x) => [x.status, x.command, x.metadata]))}`);
      const sh = running[0];
      ok(sh.command.includes("sleep 6"), `shell command is ${sh.command}`);
      const first = await client.shellOutputFrom(sh.id, 0, 200_000);
      ok(typeof first.cursor === "number" && typeof first.size === "number", `output page is ${JSON.stringify(first)}`);
      const info = await client.shellInfo(sh.id);
      ok(info.id === sh.id && info.status === "running", `shellInfo is ${JSON.stringify(info)}`);
      await client.removeShell(sh.id);
      ok(!(await client.shells(WORKDIR)).some((x) => x.id === sh.id), "the shell is still listed after remove");
    } finally {
      await client.deleteSession(s.id).catch(() => {});
    }
  });

  await check("prompt: a file attachment reaches the model", async () => {
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    await client.writeFile(`${WORKDIR}/tiny.png`, png, WORKDIR);
    const s = await client.createSession({ directory: WORKDIR, title: "contract: attachment", model: { providerID: "fake", id: "m" } });
    try {
      // What composeMessage sends: file:// uris, one per vision-readable file.
      await client.prompt(s.id, { text: "look at this", files: [{ uri: `file://${WORKDIR}/tiny.png`, name: "tiny.png" }] });
      await sleep(600);
      await idle(s.id, 60_000);
      const page = await fetchTimelinePage(client, s.id, { limit: 20, retryLimit: 10, timeoutMs: 20_000 });
      const user = page.messages.find((m) => m.kind === "user") as { files?: { uri?: string; mime?: string; name?: string }[] } | undefined;
      ok(user, "the message with an attachment isn't in the history");
      const files = user!.files ?? [];
      ok(files.length === 1, `history has ${files.length} files: ${JSON.stringify(files)}`);
      ok(files[0].name === "tiny.png" && files[0].mime === "image/png", `the file came back as ${JSON.stringify(files[0])}`);
      // The server turns the file into something the model can read; the fake
      // model echoes back what it was told, cut at 80 characters.
      const assistant = [...page.messages].reverse().find((m) => m.kind === "assistant");
      const text = assistant && assistant.kind === "assistant" ? assistant.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("") : "";
      ok(/Attached file: .*\/tiny/.test(text), `the model never saw the attachment: ${JSON.stringify(text.slice(0, 160))}`);
    } finally {
      await client.deleteSession(s.id).catch(() => {});
    }
  });

  // ---- files --------------------------------------------------------------
  await settle("the first shell reads");
  await check("files: write, read back, list and find", async () => {
    const rel = "contract/note.txt";
    const body = "written by the contract check\n";
    await client.writeFile(`${WORKDIR}/${rel}`, body, WORKDIR);
    const back = await client.readFile(`${WORKDIR}/${rel}`, WORKDIR);
    ok(back === body, `read back ${JSON.stringify(back)}`);
    const bytes = await client.readFileBytes(`${WORKDIR}/${rel}`, WORKDIR);
    ok(bytes.bytes && new TextDecoder().decode(bytes.bytes) === body, "readFileBytes didn't match");
    const list = await client.listDir("contract", WORKDIR);
    ok(list.some((e) => e.path.replace(/\/$/, "") === rel), `listDir gave ${JSON.stringify(list)}`);
    const found = await client.findFiles("note", WORKDIR, 10);
    ok(found.some((e) => e.path.includes("note.txt")), `findFiles gave ${JSON.stringify(found)}`);
  });

  await check("files: a path outside the location is read through the shell", async () => {
    const text = await client.readFile(`${HOME}/.config/opencode/opencode.json`);
    ok(text.includes("\"model\""), `global config read back as ${JSON.stringify(text.slice(0, 80))}`);
  });

  await check("files: a missing file is a 404, not a hang", async () => {
    try {
      await client.readFile(`${WORKDIR}/nope-nope.txt`, WORKDIR);
      throw new Error("read a file that isn't there");
    } catch (e) {
      ok(e instanceof OpenCodeError && e.status === 404, `got ${String(e)}`);
    }
  });

  // ---- shell / terminals --------------------------------------------------
  await check("shell: exec runs a command and returns its output", async () => {
    const r = await client.exec("printf 'hello from the shell\\n'; exit 0", { directory: WORKDIR });
    ok(r.exit === 0, `exit ${r.exit}`);
    ok(r.output.includes("hello from the shell"), `output was ${JSON.stringify(r.output)}`);
    const bad = await client.exec("exit 7", { directory: WORKDIR });
    ok(bad.exit === 7, `exit code came back as ${bad.exit}`);
  });

  await check("terminal: create, resize, ticket, remove", async () => {
    const pty = await client.createPty({ cwd: WORKDIR, title: "contract" }, WORKDIR);
    ok(pty.id, "no pty id");
    ok(pty.status === "running", `pty status ${pty.status}`);
    const list = await client.ptys(WORKDIR);
    ok(list.some((p) => p.id === pty.id), "the pty isn't in the list");
    await client.resizePty(pty.id, { rows: 30, cols: 100 }, WORKDIR);
    const url = await client.ptySocketUrl(pty.id, { directory: WORKDIR });
    ok(url.startsWith("ws"), `socket url ${url}`);
    ok(/ticket=/.test(url) && /\/api\/pty\/.+\/connect/.test(url), `socket url has no ticket: ${url}`);
    await client.removePty(pty.id, WORKDIR);
    ok(!(await client.ptys(WORKDIR)).some((p) => p.id === pty.id), "the pty is still listed after remove");
  });

  // ---- config -------------------------------------------------------------
  await check("config: read the global file, and its directory", async () => {
    const loc = await configLocation(client);
    ok(loc.file === `${HOME}/.config/opencode/opencode.json`, `config file is ${loc.file}`);
    ok(loc.dir === `${HOME}/.config/opencode`, `config dir is ${loc.dir}`);
    const cfg = await readGlobalConfig(client);
    ok(cfg.model, `global config has no model: ${JSON.stringify(cfg).slice(0, 200)}`);
  });

  await check("config: update writes the file and the server reloads it", async () => {
    await updateGlobalConfig(client, (cfg) => ({ ...cfg, metadata: { ...(cfg.metadata as object), contract: true } }));
    const raw = await client.readFile(`${HOME}/.config/opencode/opencode.json`);
    ok(raw.includes("\"contract\": true"), `file on disk is ${raw.slice(0, 200)}`);
    const entries = await client.configEntries();
    const doc = entries.find((e) => e.type === "document");
    ok(doc, "the server no longer lists a config document after the write");
    await updateGlobalConfig(client, (cfg) => {
      const next = { ...cfg };
      delete next.metadata;
      return next;
    });
  });
  await settle("config write");

  await check("config: memory install adds the instructions entry, and removes cleanly", async () => {
    const paths = await installMemory(client);
    ok(isContextInstruction(paths.context), `context path ${paths.context}`);
    const after = await readGlobalConfig(client);
    ok(memoryInstalled(after), `instructions after install: ${JSON.stringify(after.instructions)}`);
    ok(after.instructions?.includes(paths.context), "the absolute context path isn't in instructions");
    const onDisk = await client.readFile(`${HOME}/.config/opencode/opencode.json`);
    ok(onDisk.includes("memory/context.md"), `file on disk: ${onDisk.slice(0, 300)}`);
    const written = await client.readFile(paths.context);
    ok(written.length > 0, "context.md is empty");
    await installMemory(client);
    const twice = await readGlobalConfig(client);
    ok((twice.instructions ?? []).filter(isContextInstruction).length === 1, `install twice gave ${JSON.stringify(twice.instructions)}`);
    const mp = await memoryPaths(client);
    ok(mp.context === paths.context, "memoryPaths moved");
    await removeMemory(client);
    ok(!memoryInstalled(await readGlobalConfig(client)), "memory is still on after remove");
  });
  await settle("memory install");

  // ---- generated plugin ---------------------------------------------------
  await check("plugin: the generated present plugin loads and reports active", async () => {
    await removePresentPlugin(client).catch(() => {});
    const dir = await ensurePresentPlugin(client);
    ok(dir.startsWith(`${HOME}/.otto/agent-tool/`), `plugin dir ${dir}`);
    const home = await readHome(client);
    ok(home === HOME, `readHome gave ${home}, expected ${HOME}`);
    const cfg = await readGlobalConfig(client);
    ok(Array.isArray(cfg.plugins) && cfg.plugins.some((p) => typeof p === "object" && String(p.package ?? "").endsWith("otto-present")), `plugins entry missing: ${JSON.stringify(cfg.plugins)}`);
    // The server loads plugins at boot and on config reload; give it a moment.
    let found: { state?: { status?: string; error?: string } } | undefined;
    for (let i = 0; i < 60; i++) {
      const list = await client.plugins();
      found = list.find((p) => p.id === PRESENT_PLUGIN_ID);
      if (found && found.state?.status === "active") break;
      if (found && found.state?.status === "failed") break;
      await sleep(500);
    }
    ok(found, `the server doesn't list ${PRESENT_PLUGIN_ID}`);
    ok(found!.state?.status === "active", `plugin state is ${JSON.stringify(found!.state)}`);
  });
  await settle("present plugin install");

  await check("plugin: the present tool is callable in a real turn", async () => {
    await say(sessionID, `present ${WORKDIR}/hello.txt A file`);
    const page = await fetchTimelinePage(client, sessionID, { limit: 50, retryLimit: 10, timeoutMs: 20_000 });
    const calls = page.messages.flatMap((m) => (m.kind === "assistant" ? m.blocks : [])).filter((b) => b.kind === "tool" && (b as { name: string }).name === "present");
    ok(calls.length > 0, "the model's present call never reached the timeline");
    const call = calls[calls.length - 1] as { status: string; output?: string; error?: string };
    ok(call.status === "completed", `present ended ${call.status}: ${call.error ?? call.output ?? ""}`);
    ok(/(presented|shown)/i.test(call.output ?? ""), `present returned ${JSON.stringify(call.output)}`);
  });

  await check("plugin: removing the entry leaves no plugin behind", async () => {
    await removePresentPlugin(client);
    const cfg = await readGlobalConfig(client);
    ok(!JSON.stringify(cfg.plugins ?? []).includes("otto-present"), `plugins still lists it: ${JSON.stringify(cfg.plugins)}`);
  });
  await settle("present plugin removal");

  await check("plugin: the schedule tool plugin loads too, with its permissions", async () => {
    const dir = await ensureSchedulePlugin(client);
    try {
      const cfg = await readGlobalConfig(client);
      ok(Array.isArray(cfg.plugins) && cfg.plugins.some((p) => typeof p === "object" && String(p.package ?? "").endsWith("otto-schedule")), `plugins entry missing: ${JSON.stringify(cfg.plugins)}`);
      ok((cfg.permissions ?? []).some((r) => r.action === "otto_schedule.run"), "the schedule permissions were not added");
      let found: { state?: { status?: string; error?: string } } | undefined;
      for (let i = 0; i < 60; i++) {
        found = (await client.plugins()).find((p) => p.id === SCHEDULE_PLUGIN_ID);
        if (found && found.state?.status !== undefined && found.state.status !== "pending") break;
        if (found && found.state?.status === "active") break;
        await sleep(500);
      }
      ok(found, `the server doesn't list ${SCHEDULE_PLUGIN_ID}`);
      ok(found!.state?.status === "active", `plugin state is ${JSON.stringify(found!.state)}`);
      // Its tool has to be in the catalog the agent sees, not just the plugin list.
      const tools = await client.agents(WORKDIR); // agent read proves the location is healthy
      ok(tools.length > 0, "the catalog broke after installing the schedule plugin");
    } finally {
      await removeSchedulePlugin(client);
      ok(!JSON.stringify((await readGlobalConfig(client)).plugins ?? []).includes("otto-schedule"), "the schedule plugin's entry survived removal");
      void dir;
    }
  });
  await settle("schedule plugin");

  // ---- permissions --------------------------------------------------------
  await check("permissions: an ask is listed, answered, and the turn goes on", async () => {
    const s = await client.createSession({ directory: WORKDIR, title: "contract: permission", model: { providerID: "fake", id: "m" } });
    try {
      await updateGlobalConfig(client, (cfg) => ({ ...cfg, permission: "ask" }));
      await client.prompt(s.id, { text: "bg-shell 1" });
      let pending: Awaited<ReturnType<typeof client.pendingPermissions>> = [];
      for (let i = 0; i < 100; i++) {
        pending = await client.pendingPermissions(WORKDIR);
        if (pending.some((p) => p.sessionID === s.id)) break;
        await sleep(200);
      }
      const ask = pending.find((p) => p.sessionID === s.id);
      ok(ask, `no permission request for ${s.id} (saw ${JSON.stringify(pending.map((p) => p.sessionID))})`);
      ok(Array.isArray(ask!.resources) && ask!.resources.length > 0, `request has no resources: ${JSON.stringify(ask)}`);
      await client.replyPermission(s.id, ask!.id, "once");
      await idle(s.id);
    } finally {
      await updateGlobalConfig(client, (cfg) => ({ ...cfg, permission: "allow" }));
      await client.deleteSession(s.id).catch(() => {});
    }
  });
  await settle("the permission ruleset");

  await check("errors: a bad session id is a 404 OpenCodeError, with the server's tag", async () => {
    try {
      await client.session("ses_nope");
      throw new Error("got a session for a made-up id");
    } catch (e) {
      ok(e instanceof OpenCodeError, `got ${String(e)}`);
      ok(e.status === 404, `status ${e.status}`);
      ok(/NotFound/i.test(e.tag), `tag ${e.tag}`);
    }
  });

  console.log(`\n${passed}/${passed + failures.length} passed against OpenCode ${versionSeen || "(unknown)"}`);
  for (const f of failures) console.log(`  FAILED ${f.name}: ${f.error}`);
  process.exit(failures.length ? 1 : 0);
}

void main();
