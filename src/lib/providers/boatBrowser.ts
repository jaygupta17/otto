/**
 * The agent's browser on a Boat machine.
 *
 * Boat ships the Cua Driver as an MCP server named `computer`. Its typed
 * browser tools read the page as text with refs, so any model can drive
 * them, but they refuse until Chrome has an owned DevTools endpoint and the
 * profile is approved through `browser_prepare`. Boat turns that tool off in
 * OpenCode (its schema breaks the Anthropic API), and a grant made outside
 * the MCP connection can't be used through it ("session is not available to
 * this transport").
 *
 * So Otto installs `otto-browser` (otto-browser.py), a small CLI that talks
 * to the same driver daemon under one session label. It starts Chrome on the
 * desktop with a loopback DevTools port, attaches it through Boat's
 * sanctioned `--grant existing-profile` route, and prints pages as short text
 * with refs. Same Chrome, same profile, same screen as Boat's desktop
 * stream, so the person can watch it and take over.
 */
import type { OpenCode } from "../opencode/client";
import OTTO_BROWSER from "./otto-browser.py?raw";

export { OTTO_BROWSER };
/** Bumped when the CLI or the skill changes, so connected machines get the new one. */
export const BROWSER_KIT_VERSION = 3;
const BIN = "~/.local/bin/otto-browser";

/** The header that marks a `question` as a handoff. Otto keys its Take control card on it. */
export const HANDOFF_HEADER = "Take over";

/** Skill for agents on Boat machines: how to use the browser and when to hand off. */
export const BROWSER_SKILL = `---
name: browser
description: Use the web browser on this machine to open sites, read pages, click, type and sign in. Read this before any browser task.
---

# Browser

This machine has Chrome on its desktop. The person can watch it live in Otto and take over. Drive it from the shell with \`${BIN}\`. Don't use curl or web fetch for a task that needs the real browser.

| Command | Does |
| - | - |
| \`${BIN} open [url]\` | Start or reuse Chrome, open the URL, print the page |
| \`${BIN} go <url>\` | Open a URL in the current tab |
| \`${BIN} read\` | Print the current page. \`--query <text>\` finds matching elements, \`--more\` shows the rest |
| \`${BIN} click <ref>\` | Click an element |
| \`${BIN} type <ref> <text>\` | Type into a field. \`--replace\` clears it first, \`--enter\` submits |
| \`${BIN} press <key>\` | Enter, Tab, Escape, Down… |
| \`${BIN} tabs\`, \`${BIN} tab <n>\` | List tabs, switch tab |

Pages print as one line per element. Actionable ones start with a ref, like \`[p3:12] link "Sign in"\`. Every command that changes the page prints it again; refs from older output stop working.

If you can see images and need to check the layout, \`get_window_state\` in the computer tools shows exactly what the person sees.

Chrome's window may be narrow, shaped to the person's phone or panel while they watch. Leave its size alone; pages read the same.

## Hand off to the person

Stop and hand off when the next step needs the person: signing in, a password or one-time code, a CAPTCHA, a payment, or anything you aren't allowed to do. Never ask for a password or a code in the chat, and never type one you were given.

Call the \`question\` tool with exactly one question whose \`header\` is \`${HANDOFF_HEADER}\`, what they should do as the \`question\`, and the options \`Done\` and \`Cancel\`:

\`\`\`json
{ "questions": [{ "header": "${HANDOFF_HEADER}", "question": "Sign in to GitHub in the browser, then hand back.", "options": ["Done", "Cancel"] }] }
\`\`\`

Otto shows them the live browser and a Take control button. When they answer Done, run \`${BIN} read\` (or \`tabs\`, the page may have moved on) and carry on from where you stopped. On Cancel, stop the browser part of the task and say what's left.
`;

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

/** Bash (idempotent) that installs the CLI and the skill. Prints OTTO_BROWSER_KIT. */
export function browserKitScript(): string {
  return [
    "set -eu",
    'mkdir -p "$HOME/.local/bin" "$HOME/.otto" "$HOME/.config/opencode/skills/browser"',
    `printf '%s' '${b64(OTTO_BROWSER)}' | base64 -d > "$HOME/.local/bin/otto-browser"`,
    'chmod 755 "$HOME/.local/bin/otto-browser"',
    `printf '%s' '${b64(BROWSER_SKILL)}' | base64 -d > "$HOME/.config/opencode/skills/browser/SKILL.md"`,
    `echo ${BROWSER_KIT_VERSION} > "$HOME/.otto/browser-kit"`,
    "echo OTTO_BROWSER_KIT",
  ].join("\n");
}

/** Bash that prints the installed kit version (0 when missing). */
export const BROWSER_KIT_CHECK = 'cat "$HOME/.otto/browser-kit" 2>/dev/null || echo 0';

/**
 * Install or update the kit over the agent server's shell. Cheap when it's
 * current (one `cat`), so it runs on every connect to a Boat machine.
 */
export async function ensureBrowserKit(client: OpenCode): Promise<boolean> {
  const have = Number((await client.exec(BROWSER_KIT_CHECK, { timeoutMs: 15_000 })).output.trim()) || 0;
  if (have >= BROWSER_KIT_VERSION) return false;
  const r = await client.exec(browserKitScript(), { timeoutMs: 30_000 });
  if (!r.output.includes("OTTO_BROWSER_KIT")) throw new Error(r.output.trim().slice(-300) || "Couldn't install the browser kit.");
  return true;
}
