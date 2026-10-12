# Tue 20 Oct · launch day

IST = PT + 12:30 (DST ends 1 Nov). **Your launch starts at 20:30 IST.**

## Before you post · 19:30 PT = 08:00 IST

- [ ] `gitleaks detect` on full history — last run was clean at 19 commits
- [ ] **Make `jaygupta17/otto` public** ← everything below depends on it
- [ ] Verify `curl -fsSL https://jaygupta.dev/otto/install.sh | sh` resolves a real tag
      (it reads `/releases/latest` by following a redirect — dead while private)
- [ ] Check every GitHub URL in these files now returns 200
- [ ] YouTube video is public
- [ ] X bio + LinkedIn headline + LinkedIn Featured

## Run of show

| IST | PT | Action | File |
| --- | --- | --- | --- |
| 20:30 | 08:00 | Show HN submit | `07-show-hn.md` |
| 20:32 | 08:02 | HN first comment | `07-show-hn.md` |
| 20:35 | 08:05 | Friends the HN link | `03-friends-dm.md` |
| 20:45 | 08:15 | X thread, pin post 1 | `08-x-thread.md` |
| 21:00 | 08:30 | LinkedIn, links in first comment | `09-linkedin-launch.md` |
| 21:30 | 09:00 | OpenCode Discord → Tauri Discord | `10-discord-*.md` |
| 22:00 | 09:30 | YouTube + Short | `11-youtube.md` |
| 22:30 | 10:00 | r/opencodeCLI | `12-reddit-opencodecli.md` |
| 00:30 | 12:00 | r/ChatGPTCoding | `12-reddit-chatgptcoding.md` |
| — | — | **sleep** | |
| 02:30 | 14:00 | ~~r/selfhosted~~ moved to Wed AM | `12-reddit-selfhosted.md` |
| 04:30 | 16:00 | ~~r/opensource~~ moved to Wed AM | `12-reddit-opensource.md` |

## Two hours either side of midnight

HN checkpoints at **10:00 PT** and **13:00 PT**. Under ~50 points, stop treating HN as the
anchor: lead on X and the write-up, and pull the dev.to cross-post up from T+2 to T+1.

## Rescheduled from the plan

r/selfhosted and r/opensource were 02:30 and 04:30 IST. Moved to Wed morning — you're
sharper, and both subs are slow enough that it costs nothing. Only the two OpenCode-related
subs stay on launch night, because that crowd is awake at 22:30 IST.

## Still on the plan, honestly

`chore(release): v0.3.1` on launch evening no longer applies — you shipped **v0.4.1**.
If launch day produces fixes, that's **v0.4.2**, and cutting a cross-platform release after
midnight is unlikely. Decide at 20:30 whether you're doing it, not at 23:00.