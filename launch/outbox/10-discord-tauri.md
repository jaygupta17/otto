# Tauri Discord — Tue 20 Oct, 09:00 PT (21:30 IST)

**Channel:** showcase — this crowd cares about the stack
**Attach:** `otto-16x9-small.mp4` (8.2 MB) and `15-mobile-prompt.png`

---

**Otto**: a Tauri 2 app for running coding agents on cloud machines (MIT)

One React codebase ships to macOS, Windows, Linux and Android, and iOS builds from source. The Rust side handles streaming HTTP without CORS problems, the OS keychain and native notifications. On phones it sizes itself to `visualViewport` so the composer sits on top of the keyboard like a native app.

For "This computer" workspaces it finds an OpenCode v2 install or fetches one, starts `opencode serve` detached on 127.0.0.1 with a random password, and revives it on reconnect — so a job survives quitting the app.

Repo: https://github.com/jaygupta17/otto
Write-up: https://jaygupta.dev/writing/building-otto

Happy to talk through any of the mobile quirks.

---

Added the local-process paragraph — it's the most Tauri-relevant thing in the current build.