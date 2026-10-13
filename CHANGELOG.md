# Changelog

All notable changes to Otto are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Write user-facing notes under `## [Unreleased]` as you go. `bun run release` turns that section into the next version (see [RELEASING.md](RELEASING.md)).

## [Unreleased]

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

[Unreleased]: https://github.com/jaygupta17/otto/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/jaygupta17/otto/compare/v0.5.1...v0.6.0
[0.5.1]: https://github.com/jaygupta17/otto/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/jaygupta17/otto/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/jaygupta17/otto/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/jaygupta17/otto/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/jaygupta17/otto/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jaygupta17/otto/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jaygupta17/otto/tree/v0.1.0
