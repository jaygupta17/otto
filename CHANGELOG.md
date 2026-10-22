# Changelog

All notable changes to Otto are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Write user-facing notes under `## [Unreleased]` as you go. `bun run release` turns that section into the next version (see [RELEASING.md](RELEASING.md)).

## [Unreleased]

### Changed

- The chat fades in earlier above the composer, with a soft uneven edge instead of a straight band; the fade stays inside the conversation pane.
- Fewer repeated labels and agent names in the composer, thread footers and new-chat header. The context meter is the ring only, with usage on hover and in its card; starter prompts are gone.

### Fixed

- Saved background photos and colours have a visible remove control, including on touch screens.

## [0.13.0] - 2026-10-22

### Added

- Agents can manage schedules on a fresh machine: the `otto_schedule` tool is installed when a workspace connects, not only after someone opens Schedules. Settings → General → Automation → **Agents can manage schedules** turns it off, and existing schedules keep running.

### Changed

- Teammate memory is plain markdown in the OpenCode config folder: `context.md` is injected into every new session, while daily notes, project state and learnings stay on disk for agents to read on demand. The Memory panel edits the same files, and the old memory plugin is gone.

## [0.12.1] - 2026-10-22

### Fixed

- Long conversations open without a long wait or a failed fetch. History now loads in small pages, and a finished turn refreshes only the last few messages instead of downloading the whole session again.

## [0.12.0] - 2026-10-22

### Added

- Agents can create, change and run schedules from chat with the `otto_schedule` tool. The app and the tool write through one rev-locked file, so neither overwrites the other, and the Schedules view shows who created a schedule and how its last run went.

### Fixed

- Starting or waking an agent machine no longer flashes "Couldn't load models" while OpenCode is still loading its plugins. The app waits for the model and agent catalog before it calls the connection ready, keeps Send paused until then, and picks the catalog up if it arrives late instead of leaving the picker empty.

## [0.11.1] - 2026-10-21

### Fixed

- Removing an agent no longer leaves the old one selected, and a workspace you delete no longer comes back after a restart.
- A tool row's stop, background and open buttons stay put while the agent moves between steps, and clicks on an expander land while a response is still streaming.
- The chat no longer jumps past the end of the conversation when the side panel changes the column's width.
- Permission requests stay put when you come back to Otto: an ask that is waiting on you is no longer dropped when the connection reconnects.

## [0.11.0] - 2026-10-20

### Added

- **Hire teammates.** + in Agents opens a gallery of everyone Otto can introduce, by face. Besides the starter team, seven new teammates are there: Quill (writing and docs), Quinn (sales outreach), Hollis (recruiting), Penny (expenses), Wren (customer health), Flint (paid ads) and Atlas (travel). Each has a profile where they greet you, say what they do, what to ask them and how they work. One tap hires them, and the same button then takes you to them. Tap one of their questions to start a session with it. "Your own" starts a blank teammate, as + did before. Like the others, the new teammates never send, pay or book anything themselves without showing you first.
- **See what's running in the background.** Commands the agent leaves running and teammates working on a part in the background now show above the composer, each with its time and a Stop. Two or more fold into a count that opens in place.
- **Keep running in the background.** A long command or teammate holding up the agent has a send-to-back action on its line. The work carries on, and the agent moves on and hears back when it ends.
- **Apps.** Settings → Apps connects Gmail, Google Calendar, Drive, Docs, Sheets, Slack, Notion, GitHub, Linear and Outlook through a free Composio account of your own. Paste your key once, then tap Connect and approve the app on its own sign-in page. Every teammate on every workspace can then use it. Need another app? Just ask. Your teammate finds it among Composio's 500+ and asks you to connect it. The key stays in this device's keychain, and in a private file on each agent machine.
- **Connect from the chat.** When a teammate needs an app you haven't connected, its link shows as a button with the app's logo. It waits while you sign in, then says the app is connected, and **Carry on** lets the teammate continue.
- **App work reads plainly.** "Used Slack · send message", "Looked through Google Calendar", "Asked to connect Gmail", with the app's logo, even while it's still running, instead of "ran 1 command".
- **Choose what teammates may do in your apps.** Permissions has an Apps section, for everyone and for each teammate. Each app has Reading, Sending and changing, and Deleting, each set to Allow, Ask or Block, and you can set any single action on its own. Out of the box teammates read freely and ask before they send, change or delete anything. Blocked actions disappear from their tools. Settings → Apps shows what applies and links there.
- **Approvals for app actions say what they'll do.** The approval shows the app, the action, the thing it acts on by name ("Team sync", not an id), who it reaches, and what it will say. **Always for Juno** or **Always for every teammate** remembers that action for those people or places. The rule then shows under Remembered in Permissions, where you can change or forget it, and the toast has Undo.
- **See what each agent can do.** An agent's Permissions now opens with a plain summary: what it's free to do, what it asks you about first, and what it's never allowed to do.

### Changed

- **Permissions say what will happen.** Each row shows Allow, Ask or Block, and the one that applies is lit even when the agent follows the default. "Default" or "Changed · Reset" under the name says which, in place of the old "Auto".

### Fixed

- **Background commands finish in the chat.** A command the agent ran in the background used to show as done at once, and its output never appeared. Now its line stays live, shows output as it arrives when you open it, and ends in place with the result, or in red with the exit code when it fails. Results that arrive while you're watching now show at once, without reopening the chat.
- **Stopping a background command** tells the agent it was you, so it doesn't start it again. The line keeps what the command printed up to then.
- **The approval card is solid.** The chat no longer shows through it while it waits for you.
- **An approval already answered elsewhere**, in another window or by a rule you just saved, no longer shows "Couldn't answer".
- **Phones keep your workspaces and keys.** Otto on Android could reopen at onboarding with its API keys gone, once the phone had closed it in the background. Settings are now saved so a closed app always keeps the last good copy, and your backdrop photos are kept apart from them.
- **Big app results come back whole.** A long calendar or inbox listing used to reach the agent empty, and it failed with errors like "Cannot read properties of null". Agents also see every action an app has, so they stop calling ones that don't exist.
- **Picking a chat from History on a new session (phones)** now opens it. Before, the new session stayed on screen until you tapped back.

## [0.10.0] - 2026-10-20

### Added

- **Teammates come alive.** Faces are now soft, lit characters that move with what they're doing. Idle, they breathe, blink and glance around. Working, they nod as they take the task, narrow their eyes and wear the amber clock hand round their rim. Needing you, they look up wide-eyed, hop and show a blue beacon. Done, they smile, blush and pop once. Each face keeps its own timing, so a sidebar of teammates never moves in unison. Under reduced motion they hold still and keep their state marks.
- **Teammates notice you.** Between states they do little things on their own: look around, tilt their head, hop, wiggle, blink. Faces watch your pointer and lean toward it. Hover a teammate's row or card and it perks up and grins; press it and it squishes. On a new session, your teammate says hello, looks down at what you're writing and nods along with each word. Poke it a few times and it gets dizzy.
- **Accessories.** A teammate can wear an antenna, glasses, a headset, a cap, a sprout or a bowtie, picked under Look in their settings.
- **Personalities.** Under Personality in a teammate's settings: a tagline, a greeting, a voice (how they talk and work, which goes into their prompt) and up to four things to ask them. The starter team comes with theirs, and existing starters pick them up on their own.
- **Meet the teammate.** A new session with a teammate opens with their face, their greeting and their own starters, on desktop and on phones.
- **Patch** joins the starter team: code and fixes, with tests. If you already have the others, "Add Patch" sits at the end of your teammates in Agents. With no teammates yet, Agents introduces the whole team by face.
- **Juno, chief of staff.** Hand Juno the whole job. Juno splits it up, gives each part to the right teammate at the same time, checks what comes back (sending it back when it's off), and answers once, saying who did what. Each handoff shows in Juno's thread with that teammate's face working on it. In the sidebar, they show as working "On a task for Juno". If you already have teammates, "Add Juno" is in Agents.
- **Leads.** Any teammate can lead the team: turn on "Leads the team" in their settings. Nobody hands work to a lead, and teammates doing a lead's part can't pass it on.
- **The team on your phone.** The sessions screen shows your teammates as a row of faces with their live state; tap one to start a session with them. Their sessions wear their face too.

### Changed

- Teammate colours are brighter, still clear of the status colours. Teammates using the old colours move to the new ones.
- Sidebar rows for teammates show their state on the face instead of a separate clock or dot.
- **Quieter live activity.** Handoffs, tool runs and thinking are single lines now, without cards: the teammate's face is the spinner, live words shimmer, and the time and a chevron follow. The turn's own "Working" line is gone. Only the teammate's face shows, in the pauses when nothing else is moving. Opening a handoff shows the brief and result underneath. Its conversation and Stop are icons that appear on hover.
- While the agent works, the composer says "Steer Juno…". The Steer or Queue switch appears only once you've typed something.

### Fixed

- A teammate finishing its part of a lead's job no longer pops a "Finished. Your turn." notice while the lead is still working.

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

[Unreleased]: https://github.com/jaygupta17/otto/compare/v0.13.0...HEAD
[0.13.0]: https://github.com/jaygupta17/otto/compare/v0.12.1...v0.13.0
[0.12.1]: https://github.com/jaygupta17/otto/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/jaygupta17/otto/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/jaygupta17/otto/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/jaygupta17/otto/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/jaygupta17/otto/compare/v0.9.0...v0.10.0
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
