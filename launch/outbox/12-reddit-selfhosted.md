# r/selfhosted — Wed 21 Oct, morning

**Rescheduled on purpose.** The plan had this at 14:00 PT = 02:30 IST, which is the middle
of the night. Both you and the mods are sharper in the morning, and this sub is slow enough
that 8 hours changes nothing.

**Attach:** a screenshot gallery, **not** the film. This sub is suspicious of hype.
- `01-home.png`
- `10-providers.png`
- `15-mobile-prompt.png`
- `08-scheduled.png`

Lead with "your own server". Check the self-promo day rule before you post — post the film in
a comment if someone asks.

---

**Title:** Otto: a desktop and mobile app for your own OpenCode server (no account, no backend, MIT)

I run OpenCode, the open-source coding agent, on a server I control, and I wanted a good app to use it from my laptop and phone. So I built Otto.

- Connect to any OpenCode v2 server with its URL and password. The app talks to it directly over HTTPS. There's no Otto backend, account or tracking.
- Or let Otto set up a server for you on Boat, boxd, E2B or Daytona. It installs OpenCode, runs it under systemd with a random password, and exposes the port.
- **Or run it on the machine itself** — no cloud host and no API key, useful if you'd rather keep everything on one box.
- Permission prompts and agent questions arrive as notifications on your phone.
- Schedules are plain cron jobs on the server.
- Passwords and keys are stored in the OS keychain.

Available for Mac, Windows, Linux and Android. iOS builds from source with Xcode. Built with Tauri 2 and React.

Repo: https://github.com/jaygupta17/otto
Site: https://jaygupta.dev/otto

Happy to answer questions about running OpenCode under systemd.