# Changelog

All notable changes to Otto are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Write user-facing notes under `## [Unreleased]` as you go. `bun run release` turns that section into the next version (see [RELEASING.md](RELEASING.md)).

## [Unreleased]

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

[Unreleased]: https://github.com/jaygupta17/otto/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/jaygupta17/otto/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/jaygupta17/otto/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/jaygupta17/otto/releases/tag/v0.1.0
