# Changelog

All notable changes to Otto are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Write user-facing notes under `## [Unreleased]` as you go. `bun run release` turns that section into the next version (see [RELEASING.md](RELEASING.md)).

## [Unreleased]

## [0.20.0] - 2026-10-26

### Added

- **The dock.** The panel's navigation is a vertical column of five icons at the window's right edge, and it never moves: Artifact, Screen, Terminal, Context and Memory open to the left of it, and clicking the icon you're on closes the panel. One control, one place, both directions — the button that opens is the button that closes. Hover an icon for its name and shortcut (⌘⇧A, ⌘⇧B, ⌃\`, ⌘⇧I, ⌘⇧M); ⌘⇧\\ still shows or hides the panel.
- **Artifacts.** Agents have a new `present` tool: they show a file, a page, a URL or a bit of markup in the panel instead of describing it. Images fit the panel, HTML and URLs are framed (sandboxed), text and PDFs read like a file, and anything else is a name, a size and a save button.
- Each presentation is a chip in the chat. Click it and the artifact opens at the panel's full size, with a back button to the list of everything this conversation has shown (with thumbnails for images). Copy its path, save a copy, or open a URL in your browser from its header.
- Agents are told when and how to present: once it's ready and checked, with a title you'll recognise, and a sentence on what to look at.
- A dot on the Artifact icon (or the phone's `…`) when something has been shown that you haven't looked at.

### Changed

- The panel keeps one width for every surface, remembered, instead of resizing as you switch.
- A surface's header is now just its name and its own controls. Expand, close and the surface menu are gone: the dock does all three.
- The panel is no longer "expanded over the chat": drag its edge for more room.
- Browser is the agent's screen only. Previewing a page you want to see is an artifact now.
- Clicking a file path in chat, a change in Context, or a localhost link opens it in Artifact.

### Removed

- The Files surface and its file tree. Agents show what matters with `present`; there's no filesystem to browse.
- Screenshots and the agent's screen no longer show up inline in chat. What's worth seeing, the agent presents.
- The chat header's panel button, the panel's expand and close buttons, and the surface menu.

### Fixed

- A link to a file that the agent gave its own words (`[the config](src/x.ts)`) keeps those words, and opens the file, instead of turning into the path chip.
- A file path in backticks inside a link stays part of that link instead of becoming a second link nested inside it.

## [0.19.1] - 2026-10-26

### Changed

- A file path in a message is one compact piece of text wherever it appears: a small file icon, the path in monospace, and the line number when there is one. A path on its own line used to take a whole row with a "Show preview" button — now it sits in the line with the rest of the sentence, and clicking it opens the file (the Files panel shows the preview). The line height doesn't change, whether a message has one path or ten.
- A path written inside `inline code` is now clickable too, when it points at a real file in the workspace. Paths in code blocks stay exactly as written.

### Fixed

- A file at the top of the workspace with a line number (`notes.md:20`) could never be opened — it was being read as a URL scheme.
- A message listing many paths could use up the checks that decide whether a path is real, leaving the later ones as plain text.

## [0.19.0] - 2026-10-26

### Changed

- The agent's screen fits where you watch it. On a phone, in a narrow panel or full screen, Otto shapes the agent's Chrome window to the space you have and shows just that browser at a readable size, instead of the whole desktop shrunk to fit. The button next to full screen switches back to the whole desktop, and Otto remembers your choice. Boat machines pick up the updated browser tools the next time you connect.
- Teammates rest in shades: an idle teammate wears the cool face instead of the plain one. Sleeping and dozing look the same as before.

### Fixed

- A teammate working in the background keeps its line above the composer however long ago it was started. It used to drop out once its handoff was a few turns back, or after coming back to the app reconnected, even though it was still running.
- A teammate's own command no longer counts as a second thing running in the background. One teammate running `bun test` reads "Scout working in the background", not "2 running in the background", above the composer and in the session list.
- Reloading or reconnecting while other chats are working no longer forgets which teammates are still running. Any activity elsewhere during the check used to throw it away, so a long-running teammate went missing everywhere until it finished.

## [0.18.0] - 2026-10-25

### Added

- Link previews: a link on a line of its own becomes a compact card with the site's title, description and image. **Off by default** — turn on "Link previews" in Settings → General → Appearance. It fetches each page from your machine, so nothing is requested unless you ask for it.
- File paths in a message are links that open the file. `src/lib/preview.ts` or `README.md:20` goes straight to the line, and a linked file's own preview is one tap away. Paths that don't resolve, and anything outside the workspace, stay as plain text.
- "Reduce motion" in Settings → General → Appearance. Sheets, messages, menus and page moves happen instantly; the birds, the shimmer and the loading indicators keep moving. It's on by default on phones, and the system setting still applies on top of it.
- The file tree remembers which folders you had open, per workspace, across reloads and the Refresh button. A folder that's been deleted drops out quietly.

### Changed

- Tables in a message scroll sideways instead of squeezing their columns into unreadable wrapping.

### Fixed

- The copy button on code blocks is visible on phones and tablets. It only appeared on hover before, so code couldn't be copied on touch at all.
- Taking control of the agent's screen is now a deliberate act: tap the stream to reveal "Take control", then tap that. A stray tap no longer pauses a running agent, and no double-tap, key repeat or synthetic click can skip the step. Double-clicking with a mouse still takes over at once.
- The keyboard opens reliably when typing in the agent browser's address bar on phones.

## [0.17.0] - 2026-10-24

### Added

- Attach files to a message: + › Upload files, paste a screenshot, or drop files on the reply box. They're saved in the project under `.otto/uploads` (kept out of git), and the agent is told where each one is. Images are also shown to the model when it can see images. Your messages show the images and files you sent, including after you reopen the session, and editing or forking a message brings its files back.
- On Android, share to Otto from any app (a link, text, photos or files), the way you would to a chat app. Pick an agent to start a session with, or a session you already have, and it lands in that reply box ready to send. Files over 25 MB stay behind.
- Images open as a pager: swipe (or ←/→) between the images in a message with a "2 of 3" hint, pull down or swipe in from the left edge to close, and Back closes the viewer instead of leaving the app.
- Step between subagents handed parts in the same turn: their conversation shows "1 of 2" with previous and next, swipe or ←/→ to move, and Back returns to the chat. Their lines in chat are labelled with each one's task, or "Scout A" / "Scout B" when the same teammate went twice.

### Changed

- No more banners inside Otto when an agent in another session finishes or needs you; the session list and the inbox show it, and system notifications still come while Otto is in the background. The "Banners inside Otto" setting is gone.
- Active sessions in the desktop sidebar now look like they do on phones: a raised card with the agent's face, the title and what it's doing, held in ice when it's the one open.
- Stopping a run puts any message still waiting to steer or follow it back in the reply box (after what you'd typed, files included) instead of starting a new turn with it.
- Agents write like a person messaging you: whole, natural sentences in plain words, no jargon, and lists only for things that really are lists. Your teammates pick this up the next time Otto connects.
- Memory now remembers you, not just the work: the note every session starts with opens with About you (who you are, how you like replies, what you've asked for or corrected). When you tell an agent how you like things, the lead saves it there straight away.

### Fixed

- Sending the first message of a new session no longer flickers: your words stay in the box until the session opens, the conversation replaces the new-session screen in one step with your message already in it (on phones too, with no slide out and back in), and the message no longer fades in twice once the server confirms it.
- Scrolling up while an agent streams now holds: the conversation no longer pulls you back down while you read, and follows again once you scroll back to the bottom.
- A chat whose subagent was still working when Otto reconnected shows as working in the sidebar again.

## [0.16.0] - 2026-10-24

### Changed

- A new reply box: the text sits on a raised card that lights up in ice when you type, and its tools get their own row underneath: + on the left with the agent you're talking to, the model and a round send on the right. While a run is going, a Steer or Queue pill says what your message will do, and stop goes quiet once there's something to send. Shell mode shows as a pill you can tap to leave.
- Starting a session puts the reply box in a tray, with the project and the machine it runs on along the bottom.
- On phones, Sessions drops its title: the machine you're on is a pill at the top, like the menu it opens to switch workspaces. Sessions that need you, are working or have a result you haven't seen come first, each on its own card, and a working one shows what it's doing right now ("Edit Thread.tsx", "Thinking"); once you've opened one it moves down to Recent. Then your agents, one big row each (tap one to start a session; anyone already busy above is left out), then recent sessions as plain text. Rows light up with dots where you press them.
- The desktop sidebar is laid out the same way: Active sessions raised with the agent's face and what it's doing, then your agents (click one to start a session), then Pinned and Recent as plain text. No more date groups.
- Section labels in session lists are a quiet grey instead of blue.
- The model's thinking shows in chat by default as a folded line that stays closed while it streams; turn off Settings › Appearance › Show thinking to hide it.
- Copy, edit and fork on your messages sit under the message instead of beside it.
- A working turn ends in one quiet line instead of a bird: a breathing dither orb and what it's doing right now ("Thinking…", "Reading Thread.tsx…", "Running bun test…"), rolling to the next step as it goes. That line heads the steps and they stay folded until you open them, while it works and after. Steps in the trail no longer spin. Session rows say the step while it happens ("Editing Thread.tsx").
- Opening a session puts the cursor in the reply box (not on touch screens, so the keyboard doesn't cover the chat).
- In a session, the agent's bird moves out of the header and perches on the top right of the reply box, bigger: it shows what they're doing, nods at each new step, types while files are edited, watches what you type and nods along. Thought clouds, bulbs and sparkles are bigger on small birds so their faces read. The header keeps their name over the session's title. A teammate's handoff line no longer has a moving strip beside it.
- Explore and General show a face everywhere a teammate would: handoff lines, the running strip above the reply box, their conversation, and questions they ask.
- Sessions with work still going in the background (a teammate on a part, a command left running) stay under Active with their bird awake, and say what's going: "Scout working in the background", "bun dev running in the background".
- Agents now send slow work to the background instead of waiting on it: a lead hands parts to teammates in the background and keeps talking to you, and anyone running a long build or test suite carries on with something else, or tells you what's running and stops there. They pick up from the result when it lands.
- Faces on handoff lines are bigger, so you can see what the teammate is up to. While a handoff runs, the turn no longer adds a "Waiting on Scout…" line under it: the handoff line already says what's happening.
- Stop and "open their conversation" on handoff lines and the running strip are always shown instead of waiting for hover.
- Recent sessions no longer show a bird, on phones or in the sidebar: birds are for agents, so it's clear at a glance what's history.
- Sleeping birds are easier to spot: a deeper breath and sway, a snore bubble, and bigger ice z's drifting up.
- Explore and General have faces of their own, pixel glyphs rather than birds (birds are for teammates): ice and flickering while they work. They show up in Agents as subagents.
- The starting team is Juno with Scout, Relay and Patch, beside the Explore and General helpers. Piper moves to the hiring gallery.
- On phones, a new session with a teammate shows their bird, name and greeting, without the description underneath.
- Your open session, drafts and model picks come back after a reload.
- Free and paid versions of the same model are told apart in menus, and models without thinking levels no longer offer one.
- Pinch-zoom works on phones again, and text fields no longer zoom the page when you tap them.

### Fixed

- Schedules around a daylight-saving change run at the right time.
- Live text no longer shimmers red in themes whose colours are mixes (like Tokyo Night Day).
- "Keep working in the background" on a teammate's handoff line shows a few seconds in, as it should. Before, it was usually hidden while the teammate worked, because every handoff looked as if it was already in the background.

## [0.15.0] - 2026-10-23

### Changed

- A new look: dark mode is a soft graphite instead of black, and each phone tab opens on a large title level with its buttons. Scroll down and a frosted bar takes over.
- Menus, dialogs, toasts, the reply box and settings cards catch the light: a lit top edge, a soft glow and a faint dot grain. Search boxes, text fields and switches are lighter wells instead of dark holes, and whatever you've picked (a tab, a sidebar row, a segment) sits on a raised chip.
- The phone tab bar is a capsule with the current tab on a chip that slides as you switch.
- Desktop sidebar rows show the same crisp birds as phones, and agents without a bird get a small dot orb instead of a grey bubble. Group labels are small capitals throughout.
- On phones, the model name in the reply box no longer shrinks to a few letters, and scrollbars stay out of sight.
- Teammate birds nap in lists, wake when you hover their row, and catch a glint of light every so often. Session rows are taller, with bigger, sharper birds.
- The desktop sidebar breathes: rows are taller with bigger birds and a little space between them.
- Phone headers have room to breathe: a little more space above the title and below it, and no count lines under it (Sessions keeps its workspace switcher). Lists and cards start at the same spot on every tab, and section labels line up with the cards and rows they name. Opening a settings page no longer puts a ring round its back button.
- Counts of things working shimmer in the accent colour.
- A touch of ice blue runs through the app: the shimmer on live text has a cold edge of blue dots, and the light along the top of cards, menus and the reply box is faintly blue.
- Ice blue is now the colour of doing and choosing: send, stop and primary buttons, switches, picked answers and days, the chosen row or tab, the current phone tab, section labels and the icons in settings, the sidebar and schedule templates. Bird lines are a little cold too. Send stays a dim blue until there's something to send.
- Birds use all their faces now. Between states they have a moment: a light bulb when they start writing, hearts when you answer them, shades when they're back from retrying, a party when a run finishes, a jolt when one fails. A pat on a big bird gets hearts, and tapping a teammate's face on their profile shows every mood.
- Handoffs to teammates are one quiet line: their bird and what they're doing right now, with their name when you hover the bird. When they finish it just says how long it took; open it for the brief and the report.
- Coloured status dots are gone. Connections, servers, schedules, app permissions and new alerts use small pixel marks whose shape says the state, so they read without colour, and notification counts are small squares instead of red circles.
- Birds are the same drawing at every size, and their faces follow what's happening everywhere you see them: typing while a reply streams in, shivering while a retry waits, upset when something failed, sad when stopped, and a little party when someone joins the team. Agents without a bird are the dot orb everywhere, settings included.
- Thinking level is now a submenu on each model: hover or tap a model to pick its level, and the menu closes once you choose. The model button shows the level you picked.
- Questions from an agent come one at a time, with a tab for each, their choices as a list with explanations, and a row where you can type your own answer instead.
- Approval buttons are cleaner: shortcuts moved into tooltips, one row on phones, and "Always allow" for an app asks whether it covers this teammate or every teammate.
- The sidebar lists one row per teammate, with their latest session and when it happened, under a search field. Schedules, agents and settings sit at the bottom.
- Chats read like a messages app: your messages and the agent's replies sit in rounded bubbles, with a time stamp when a conversation starts or picks up again after an hour.
- The chat header shows who you're talking to, with the session title underneath; click the name to switch teammates. The reply box is a single rounded bar, with a + menu for mentioning files, running commands and using the shell.
- Side panels open narrower so the chat keeps its room: Files starts as a slim tree and widens when you open a file, and the chat never shrinks below a readable column. Double-click a panel's edge to reset its width.
- The strip of panel icons on the right edge is gone. A panel button at the end of the chat header (⌘⇧\\) opens the panel where you left it, and a menu at the top of the panel switches between Files, Terminal, Browser, Context, Project and Memory.
- Less text on screen: icon buttons say what they do, with their shortcut, in a tooltip; each reply ends with quiet copy and fork icons and how long it took, with the model and speed on hover.
- Phones get a tab bar at the bottom: Sessions, Team, Schedules and Settings, each its own place instead of a menu behind the workspace name. Sessions shows how many are waiting on you, and tapping the current tab scrolls back to the top.
- Team on phones lists your teammates with their faces; each opens as a full page to edit, and hiring opens profiles where **Talk to** starts a session straight away.
- Settings on phones looks like iOS Settings: your workspace at the top, then grouped sections that each open as their own page, with larger rows and buttons. Apps and workspaces keep extra actions in a … menu, and tapping a workspace switches to it.
- On phones, the session list opens with your workspace's name and your sessions grouped by day, each with its teammate's face. Search, inbox and new session are plain icons at the top; the chat header shows who you're talking to, and Files moved into the … menu. The reply box is a single bar like on desktop.
- Less empty space between the last message and the reply box, on desktop and phones.
- Agent and teammate pages are calmer: who they are at the top, then General, Personality and Permissions tabs with labelled, grouped fields. Tap a teammate's face to preview their moods; on phones, **New session** sits under the name.

### Removed

- Background photos and colours. Every screen is a plain, solid surface again.

## [0.14.0] - 2026-10-23

### Added

- Otto has themes: separate light and dark palettes, six built-in variants (Catppuccin, Flexoki, Tokyo Night) and local import from Otto JSON, Tweakcn/shadcn CSS, VS Code or OpenChamber theme files. Imported themes stay on your machine and can be removed from the picker.

## [0.13.1] - 2026-10-22

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

[Unreleased]: https://github.com/jaygupta17/otto/compare/v0.20.0...HEAD
[0.20.0]: https://github.com/jaygupta17/otto/compare/v0.19.1...v0.20.0
[0.19.1]: https://github.com/jaygupta17/otto/compare/v0.18.0...v0.19.1
[0.19.0]: https://github.com/jaygupta17/otto/compare/v0.18.0...v0.19.0
[0.18.0]: https://github.com/jaygupta17/otto/compare/v0.17.0...v0.18.0
[0.17.0]: https://github.com/jaygupta17/otto/compare/v0.16.0...v0.17.0
[0.16.0]: https://github.com/jaygupta17/otto/compare/v0.15.0...v0.16.0
[0.15.0]: https://github.com/jaygupta17/otto/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/jaygupta17/otto/compare/v0.13.1...v0.14.0
[0.13.1]: https://github.com/jaygupta17/otto/compare/v0.13.0...v0.13.1
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
