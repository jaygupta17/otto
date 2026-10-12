# r/opensource — Wed 21 Oct, morning

**Rescheduled on purpose.** Plan had 16:00 PT = 04:30 IST. Both sleep better after.

**Attach:** `01-home.png`, `03-parallel-agents.png`, `15-mobile-prompt.png`
Lead with stack and license.

---

**Title:** Otto: an MIT-licensed Tauri 2 app for running OpenCode agents on cloud machines

Otto is a desktop (macOS, Windows, Linux) and Android app for OpenCode v2. iOS builds from source. It sets up a cloud machine, installs OpenCode as a systemd service and connects over HTTPS. Your coding agents keep working when your laptop sleeps, and you can steer them from your phone.

It's built with Tauri 2 and React, with one codebase for desktop and mobile. The Rust side handles streaming HTTP, the OS keychain and notifications. A "This computer" option runs OpenCode beside the app instead, which is where most of the process management lives.

Each cloud machine provider is one file, so adding one makes a self-contained first PR. A few good first issues are open too.

Repo: https://github.com/jaygupta17/otto
Write-up: https://jaygupta.dev/writing/building-otto

Feedback and contributors welcome.