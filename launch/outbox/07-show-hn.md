# Show HN — Tue 20 Oct, 08:00 PT (20:30 IST)

**Title** (78 of 80 chars — verified, don't add words)

```
Show HN: Otto – run OpenCode agents on a cloud box, steer them from your phone
```

**URL** — the repo, not the site. The repo is private until launch morning, so make it
public *before* you submit. Every GitHub link in every post depends on it.

```
https://github.com/jaygupta17/otto
```

## First comment — post at 08:02 PT, right after submitting

Nothing attached. HN is plain text; the README's video and the write-up do the showing.

---

My agents kept stopping overnight because my laptop went to sleep. Otto moves them to a cloud machine. Paste a key from Boat, boxd, E2B or Daytona, and it sets up a Linux box, installs OpenCode and runs it as a service behind its own password. Then you watch and steer the agents from a desktop app (Mac, Windows, Linux) or Android.

When an agent asks for permission, like running git push, the prompt reaches your phone. Schedules are cron jobs on the machine, so they run with all your devices off.

There's no Otto server in between. The app connects straight to your machine over HTTPS, or to any OpenCode server you already run. MIT, built with Tauri 2 and React.

What's not done: the Mac build isn't notarized yet (`curl -fsSL https://jaygupta.dev/otto/install.sh | sh` avoids the warning), and on iOS you have to build it yourself.

I wrote up the main decisions and a few bugs, including the OOM killer choosing the agent server over Chromium: https://jaygupta.dev/writing/building-otto

Happy to answer questions about running OpenCode headless.

## Checkpoints on launch day

Check the ranking at **10:00 PT** and again at **13:00 PT**. Under ~50 points, stop
backlinking to HN as the anchor for the rest of the day — lead on X and the write-up
instead, and move the dev.to cross-post up from T+2 to T+1. You never wrote this
contingency down before; it matters most at 10:00 PT on the 20th, when you're tired.

## Replies

- Within 15 minutes, all day
- "Fixed in v0.4.2, thanks" is the best follow-up post you'll make
- Never ask for upvotes, on HN or Reddit. Ask for honest comments instead.