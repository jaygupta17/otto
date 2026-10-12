# OpenCode Discord — Tue 20 Oct, 09:00 PT (21:30 IST)

**Channel:** showcase
**Attach:** `marketing/video/renders/otto-16x9-small.mp4` — 8.2 MB, under Discord's 10 MB
free-account cap. Don't upload the 1080p, it's 23.6 MB and will fail.

---

**Otto: a desktop and mobile app for OpenCode v2** (MIT)

My agents kept stopping when my laptop slept, so I built this. Otto sets up `opencode serve` on a cloud machine (Boat, boxd, E2B or Daytona), or connects to an OpenCode server you already run. Then you use it from a native app:

• permission prompts and agent questions as phone notifications
• schedules as cron jobs on the machine
• several sessions at once, with every step live
• an agents editor with per-tool and per-MCP permissions, plus MCP, skills and commands managed in the app
• **This computer**, which runs OpenCode beside the app on macOS, Windows and Linux, with no cloud machine and no API key

Mac: `curl -fsSL https://jaygupta.dev/otto/install.sh | sh` · Other platforms: https://jaygupta.dev/otto
Repo: https://github.com/jaygupta17/otto

Feedback welcome, especially from people who know the v2 API well.

---

Added the "This computer" bullet — this crowd reads the app feature list closely and it's in
the shipped build.