# Changelog

All notable changes to Otto are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Write user-facing notes under `## [Unreleased]` as you go. `bun run release` turns that section into the next version (see [RELEASING.md](RELEASING.md)).

## [Unreleased]

## [0.9.0] - 2026-10-16

### Added

- **Teammates.** In Agents, + creates a teammate: a name, a job, standing instructions and a generated face in one of eight colours, plus its own model, step limit and permissions. Teammates are listed first in the agent menu, the command palette and under each reply, with their face and job. "What Piper is told" shows the exact prompt they run with. Everything is stored on the connected machine: who they are in `otto/teammates.json` in the OpenCode config folder, and the agent itself in `opencode.json`. If that agent goes missing, Otto rebuilds it from the teammate.
- **Otto's starter team.** Piper (product performance), Scout (research and briefs) and Relay (inbox and drafts) can be added to a machine in one tap. Relay shows every draft before anything goes out.
- **Teammates in the sidebar.** Each teammate is a row above the sessions, with its face, latest session and status: working, needs you, or unread. Expand a row for its sessions, click it to open the latest one, or use + to start a new session with that teammate. Opening a session opens its teammate's row. Pinned sessions stay under Pinned.
- **Teammates remember.** Teammates save what matters across sessions: your preferences, decisions about the project, and notes on their own work. Say "remember that…" or let them note things as they go. Each message brings in the memories that match it. Memory uses the [simple-memory](https://github.com/cnicolov/opencode-plugin-simple-memory) OpenCode plugin (pinned to 2.0.0), which Otto installs with your first teammate. The first start takes about a minute to download it. Memories are plain files in each project's `.opencode/memory` folder.
  - **Memory panel** (⌘⇧M, or the bookmark in the right rail). It lists everything teammates remember in this project, newest first. Search it, filter by whose memory it is (you, the project, or one teammate), edit text or kind in place, delete, or add one yourself. It updates as teammates save. Edits and deletions are logged the same way the plugin logs its own. "Turn memory off" removes the plugin and keeps the files.
  - **In the chat,** memory steps read "Remembered …" or "Recalled …", and open into a card with what was saved and for whom. "Show in Memory" jumps to it in the panel.
  - **Permissions:** each teammate's Permissions has a Memory section, with "All memory tools" plus a row for each of the nine tools (save, look up, change, forget, and so on), set to allow or deny. Memory tools run inside OpenCode's code tool, which never stops to ask, so there is no "ask" option. Deny takes the tool away.
- **Switch sessions from the chat.** The clock icon in the chat header lists this teammate's sessions. Search them, switch without leaving the thread, or start a new one with the same teammate. It's a popover on desktop and a full-screen page on phones.
- **File previews.** Images open as images, not as binary text: fit to the panel, zoom with ⌘/Ctrl-scroll, pinch or +/−/0/1, and drag to pan. Video, audio, PDFs and fonts preview too. Other binary files show their size and a hex peek.
- **A real folder picker.** "Browse folders…" in the project menu lets you type a path with Tab-completion, use breadcrumbs, go up a level, show hidden folders and create a folder. Recently used folders stay at the top of the menu.
- **Subagents you can follow.** Each delegated task gets a card with the agent, its status (working, in the background, needs you, done, failed or stopped) and a live timer. While it runs, the card shows the subagent's latest step. Open it to read its conversation, or stop it. Stopping tells the main agent that you cancelled the subagent, so it doesn't treat that as a failure and retry. A background subagent's report lands in its card instead of as a separate message.
- **Agents can use the browser on Boat machines.** Otto installs `otto-browser` and a matching skill on each Boat machine when it's set up or connected. Agents can then open pages, read them, click, type, and switch tabs in a real Chrome on the machine's desktop. They read pages as text instead of screenshots, so it's fast and cheap. Chrome opens full screen and keeps its tabs between runs.
- **Watch and take over the agent's screen.** On a Boat machine the Browser panel has two tabs: Preview, and **Agent's screen**, which streams the machine's desktop live, with the agent's Chrome on it. You watch by default and your input doesn't reach the screen. Double-click it or press **Take control** to drive it: the screen fills the window, and a blue ring shows you're in control. The full-screen button, in the panel or on the chat's screen card, also fills the window just to watch. Esc or the button leaves full screen. While you're in control, Esc goes to the machine. Taking control mid-run pauses the agent. **Hand back** tells it to look again and carry on. Above the stream, Otto shows the agent's current tab, or a button to open Chrome if it isn't running.
- **See the images the agent looks at.** When the agent reads an image or a tool returns one, like a screenshot, a thumbnail shows under that step and stays in view after the step folds away. Click it to see it full size.
- **Watch the agent's screen in the chat.** On a Boat machine, when the agent uses the browser or desktop tools, its screen plays live at the end of that turn, along with the page it's on and its last step. You can fold it away or open it in the panel. Browser calls read as steps, like *Clicked “Forgot password?”*, not as shell commands. The Agent's screen tab now fits the 16:9 screen without black bars and lists every browser step underneath.
- **Handoffs.** When an agent hits something only you can do (a sign-in, a 2FA code, a CAPTCHA), it stops and asks you to take over. A blue "Take over the screen" card says what it needs and opens the live screen. Type there, then press **I'm done, hand back** (⌥↵), and the agent checks the page and continues where it stopped. What you type goes straight to the machine, never through the chat. Cancel (⌥⌫) tells it to stop. A blue dot on the Browser rail shows a handoff is waiting.
- **What a turn changed, at its end.** When the agent writes or edits files, the turn ends with a card listing each one with its +/− lines. Click one to open it. Its own memory files aren't listed.
- **Starters on the new-session screen.** Research a topic, Use the browser, Fix an error and Explain this project fill the prompt for you to finish. They never send.
- **Markdown files open rendered.** A `.md` file in the Files panel reads as a document. "Show source" switches to the lines, and jumping to a line from a tool step does the same.
- **Approvals dock above the composer.** Approvals and questions no longer scroll away in the chat. Several at once become steps you can flip through ("2 of 3"), and ones from a subagent say which agent asked. Edit approvals show the diff they would apply. Answer with ⌥↵ (allow once), ⌥⇧↵ (always allow) or ⌥⌫ (deny); ⌥⌫ is ignored while you're typing.

### Changed

- **A clearer context meter.** The ring in the composer now shows how full the conversation is at a glance, with the percentage beside it (on phones, from half full). Below 80% it stays neutral; from 80% it turns blue, because it's time to decide. Its card says what that means in plain words ("Room for about 9 more turns like these", or that older messages get summarized automatically when it fills up) and offers two ways out: **Compact** summarizes in place, and **Fresh thread** starts an empty session with the same teammate, model and folder (also in the command palette). While a conversation is being compacted, the meter says so. On phones the card is a bottom sheet with full-size buttons.
- **No more bottom drawers on phones.** Settings, Files, an open file, Terminal, Browser, Memory, Project, session history, the folder picker, a subagent's conversation and Add workspace now open as full-screen pages. Each slides in from the right like a session, with a back button and swipe-from-the-edge to go back. A file opened from Files goes back to Files. The model picker and the context card are dropdowns by their buttons, with finger-sized rows on touch screens and search only when there are more than 8 models. Confirmations are small centered dialogs.
- **New sessions on phones open full screen.** "New session" slides in a session screen with the composer at the bottom, instead of a bottom sheet. Back or a swipe from the edge closes it, and sending turns it into the session.
- **Teammates are the agents.** OpenCode's Build, Plan, Explore and General no longer appear in the picker, the command palette or Agents. A new session starts with your oldest teammate, and the composer asks you to add one when there isn't any yet. Old sessions keep their history.
- **Tool calls read like what they did.** A run of steps is headed "Worked for 1m 12s" ("Working" while it runs), followed by what it did ("edited 2 files · ran 3 commands"). A run that only thought says "Thought for 4s". Each row has its own icon, the file path (shortened from the left so the name stays visible), and the numbers that matter: +/− lines, exit code, hit count, line range. Hover to open the file at the change.
  - Expanding a row shows a body built for that tool. Commands show the command and live output that follows the end. Edits show per-file diffs with line numbers, one column or side by side, plus any errors the edit introduced. Searches are grouped by file, with each line clickable. Web searches show result cards and questions show the answer you picked.
  - JSON results open as a summary, a tree or raw text. Unknown tools show their arguments as labelled fields.
  - Every section has a copy button, long output loads on demand, and a tool that fails to render shows a note instead of breaking the chat.

### Fixed

- Stopping a run no longer shows a red "Step interrupted" error under the "Stopped" divider, and steps cut short by the stop read "stopped" in grey instead of counting as failures.
- **Boat setup works again.** Boat's proxy now redirects any request that carries the access token in the address, so setting up a Boat machine stopped at "Saying hello". The desktop app now sends the token as the proxy's cookie instead. Boat's built-in computer use (the `computer` tools) works with Otto's agents, and editing settings in Otto keeps it switched on.
- Switching workspaces no longer carries the last one's folder, model or teammate into the new one. Before, a new session on a cloud machine could start in a folder from your computer and fail with "path not found". Recent folders are now kept per workspace, and a remembered folder that no longer exists falls back to the home folder.
- The session history button (the clock) now also shows on a new, empty session, on desktop and phones.
- Approvals and questions waiting for an answer survive a reload or reconnect. Before, they disappeared until the agent asked again.
- On phones, "New session" in the chat's history opens a new session with that teammate. It used to close the thread and land on the session list.
- On phones, menus with a search box no longer focus it when they open, so the keyboard stays down until you tap it.
- A server that was still starting could leave the agent and model menus empty until you reconnected. Otto now asks again.
- Settings save bars are opaque again, so text underneath no longer shows through.
- The file explorer could not open folders more than one level deep. It showed "directory not found" because each child path repeated its parent folder.
- **Keyboard:**
  - Escape closes the top-most menu or sheet.
  - Focus moves into menus and dialogs and comes back when they close.
  - Arrow keys move through menu items.
  - PageUp and PageDown scroll the conversation.
  - Shortcuts use ⌘ on macOS and Ctrl elsewhere. ⌃ shortcuts no longer hijack text fields or the terminal, and ⌘⇧B opens the browser instead of toggling the sidebar.
  - ⌘+/⌘− zoom works in the desktop app.
- **Approvals and questions from subagents** now appear in the chat that started them. Before, they were stuck in a session you couldn't see.
- Dropdowns no longer run off the screen. They open on whichever side has room and scroll inside.
- On macOS, closing the window hides Otto, and clicking the Dock icon brings it back.
- Long replies and big files no longer stall the app. Only the part of a reply that's still streaming re-renders, and code highlighting runs in idle time on a capped cache. Very large files load in chunks.

## [0.8.0] - 2026-10-13

### Fixed

- **ui:** Model picker is a popover on desktop; cap bottom sheets at 560px (d4d8590)

## [0.7.1] - 2026-10-13

### Changed

- **New app id: `dev.jaygupta.otto`** (was `dev.otto.app`, a domain Otto doesn't own). On macOS, Windows and Linux your workspaces, settings and keys carry over on first launch. **On Android this installs as a new app:** uninstall the old Otto and add your workspaces again.

### Fixed

- **Fewer Keychain prompts on macOS.** Otto keeps all its keys and passwords in one Keychain item, so macOS asks once (after an update, at most once more) instead of once per workspace and key. Keys saved by older versions move over the first time they're used.

## [0.7.0] - 2026-10-13

### Added

- **A sky to start with.** Otto ships with two painted backgrounds, Dusk and Night, and starts on Dusk (with a portrait crop on phones). Pick another or "None" in Settings → General.

### Fixed

- Android's back button and gesture go back one step (close a menu or sheet, leave Settings, return from a chat to the list) instead of closing Otto.

## [0.6.0] - 2026-10-13

### Added

- **Update notices on Android.** Otto checks for a new version and, when one is out, offers the APK download; Android installs it over the current app. The update button now also shows in the phone layout.

### Fixed

- The Android and iOS apps show the Otto icon instead of the default Tauri one.
- Android notifications use an Otto glyph in the status bar.

## [0.5.1] - 2026-10-13

### Changed

- **Approvals show the whole command.** When an agent asks to run something, the card shows the full command (every line, scrollable if it's long) instead of a short pattern, plus every path it wants to touch and what "Always allow" will remember. On phones the buttons go full width and are easier to hit. Questions wrap properly on small screens too.
- **Clearer notifications.** Alerts now lead with the session name and say what happened: "Finished", the error it stopped on, the command waiting for approval, or the question it's asking. Approvals and questions stay on screen longer and offer "Review".

### Fixed

- Coming back to Otto after switching away no longer leaves a running session looking idle with no Stop button. Otto also reconnects right away when you return, so you don't miss events from while it was in the background.

## [0.5.0] - 2026-10-12

### Added

- **Update from inside Otto.** On macOS, Windows and Linux, Otto checks for a new version shortly after launch and every few hours. When one is out, an "Update" button appears at the bottom of the sidebar: it downloads in the background, then asks you to restart. Settings → General → Updates shows your version, checks on demand, and turns the automatic check off. Nothing downloads until you click.

## [0.4.1] - 2026-10-12

### Fixed

- "This computer" workspaces set up again when an older OpenCode v2 is already on your PATH. Otto talks to an endpoint added in 2.0.26, so an older build never answered and setup gave up with a confusing error; it now installs a current one instead.

## [0.4.0] - 2026-10-12

### Added

- **Run agents on this computer.** Otto can start OpenCode right beside the app on macOS, Windows and Linux. It finds your OpenCode install (or fetches one), runs `opencode serve` locally on its own password, and leaves it running after you quit, so a long job keeps going. No cloud machine and no API key. Phones show a laptop icon for these workspaces so they aren't confused with a sandbox.

## [0.3.0] - 2026-10-12

### Added

- **install:** One-line macOS installer; fix release uploads; ad-hoc sign macOS; add issue templates (dd04c01)

## [0.2.0] - 2026-10-11

### Added

- Right-hand tools panel with Files, Terminal, Browser, Context and Project surfaces.
- A browser panel that previews dev servers on the agent machine through the provider's port forwarding, with a list of listening ports.
- Notification center for permission requests, questions and finished runs.
- Confirmation before deleting a session; renaming a session uses a proper dialog.
- Model picker shows recently used models, puts reasoning effort at the top, and opens as a sheet on phones.

### Changed

- On phones, Scheduled, Settings and the workspace switcher are one tap from the sessions list, and Files sits in the session header.
- App icons now match the logo on every platform: Android adaptive and themed (monochrome) icons, and opaque full-bleed iOS icons.

### Fixed

- The layout stays put when the on-screen keyboard opens; the composer rides on top of it.
- Bottom spacing respects the phone's safe area (the new-session button no longer sits under the gesture bar).
- The conversation follows new output and your own messages, and only stops following when you scroll.
- Adding an MCP server shows progress.
- The agent server on a sandbox is protected from the out-of-memory killer, so heavy installs (like Playwright's browsers) no longer take it down.

## [0.1.0] - 2026-10-11

First public release.

### Added

- Desktop (macOS, Windows, Linux) and mobile (Android, iOS) app for OpenCode v2.
- One-step workspaces on Boat, boxd, E2B and Daytona, or connect any OpenCode v2 server.
- Live conversation with streaming replies and every tool call shown step by step; stop or steer a run.
- Inline and system-notification prompts for permissions and agent questions.
- Agents editor with per-tool, per-skill and per-MCP permissions.
- MCP servers, skills and slash commands managed from the app.
- Scheduled tasks that run on the agent machine.
- Project file browser with syntax highlighting.

[Unreleased]: https://github.com/jaygupta17/otto/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/jaygupta17/otto/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/jaygupta17/otto/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/jaygupta17/otto/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/jaygupta17/otto/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/jaygupta17/otto/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/jaygupta17/otto/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/jaygupta17/otto/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/jaygupta17/otto/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/jaygupta17/otto/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jaygupta17/otto/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jaygupta17/otto/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jaygupta17/otto/tree/v0.1.0
