/**
 * Copies the opencode-composio plugin's permissions.json (every featured app
 * action's permission name, title and kind) into src/lib, from the commit
 * Otto pins, and checks it's the version Otto expects. Run after bumping
 * COMPOSIO_PLUGIN_COMMIT.
 *
 *   bun run composio:sync [path to a plugin checkout]   (default: the pinned commit on GitHub)
 */
import { readFile, writeFile } from "node:fs/promises";
import { COMPOSIO_PLUGIN_COMMIT, COMPOSIO_PLUGIN_REPO, COMPOSIO_PLUGIN_VERSION } from "../src/lib/composio";

if (!process.argv[2] && !/^[0-9a-f]{40}$/.test(COMPOSIO_PLUGIN_COMMIT)) throw new Error(`COMPOSIO_PLUGIN_COMMIT is "${COMPOSIO_PLUGIN_COMMIT}"; pin a full 40-character commit hash, since OpenCode only leaves those alone.`);
const from = process.argv[2] ? `${process.argv[2].replace(/\/$/, "")}/permissions.json` : `https://raw.githubusercontent.com/${COMPOSIO_PLUGIN_REPO}/${COMPOSIO_PLUGIN_COMMIT}/permissions.json`;
const res = from.startsWith("https:") ? await fetch(from) : null;
if (res && !res.ok) throw new Error(`${from} answered ${res.status}. Is the commit pushed?`);
const text = res ? await res.text() : await readFile(from, "utf8");
const { version } = JSON.parse(text) as { version: string };
if (version !== COMPOSIO_PLUGIN_VERSION) throw new Error(`${from} is ${version}; Otto expects ${COMPOSIO_PLUGIN_VERSION}. Bump one of them.`);
await writeFile(new URL("../src/lib/composio-permissions.json", import.meta.url), text);
console.log(`composio-permissions.json ← ${COMPOSIO_PLUGIN_REPO}@${process.argv[2] ? "local" : COMPOSIO_PLUGIN_COMMIT.slice(0, 7)} (${version})`);
