# Placeholders to fill before sending

Anything in `[BRACKETS]` must be replaced. Grep this outbox for `[` before
sending anything:

```bash
grep -rn '\[' launch/outbox/
```

| Placeholder | Fill with | Needed by |
| --- | --- | --- |
| `[PROVIDER]` | Boat, boxd, E2B or Daytona — one copy per company | Thu 15 |
| `[PROVIDER_DEVLINK]` | the DevRel / founder handle you found, if any | Thu 15 |
| `[YOUTUBE LINK]` | the unlisted YouTube URL, `https://youtu.be/…` | Thu 15 (maintainers), Mon 19 (providers) |
| `[HN LINK]` | the Show HN thread URL | Tue 20, 08:05 PT |
| `[OPENCODE_URL]` | the OpenCode site URL, if the maintainer email needs it | Thu 15 |

Never send anything with a bracket still in it. The risk is a bracketed
`[YOUTUBE LINK]` going out to a real person.

## Per-recipient fields

Four provider emails, one per company. Only these change:

```
[PROVIDER]         the company name
[PROVIDER_DEVLINK] who you're writing to
```

Attach for E2B: `15-mobile.png`→ **no** — attach `11-connect-e2b.png`.
Attach for Boat, boxd, Daytona: `10-providers.png`.

## Who gets what

| File | Send to | When |
| --- | --- | --- |
| `01-opencode-maintainers.md` | OpenCode maintainers | Thu 15, needs YouTube link |
| `02-provider-boat.md` | Boat | Thu 15, stills only |
| `02-provider-boxd.md` | boxd | Thu 15, stills only |
| `02-provider-e2b.md` | E2B | Thu 15, stills only |
| `02-provider-daytona.md` | Daytona | Thu 15, stills only |
| `02-provider-film-followup.md` | all four, on the 19th | Mon 19, needs YouTube link |
| `03-friends-dm.md` | 5–10 people | Mon 19 evening |
| `04-x-teaser-1.md` | X | Sat 17, morning PT |
| `05-linkedin-teaser.md` | LinkedIn | Sun 18, 09:00 IST |
| `06-x-teaser-2.md` | X | Mon 19 |
| `07-show-hn-title-and-comment.md` | Hacker News | Tue 20, 08:00 PT |
| `08-x-thread.md` | X | Tue 20, 08:15 PT |
| `09-linkedin-launch.md` | LinkedIn | Tue 20, 08:30 PT |
| `10-discord-*.md` | 2 Discords | Tue 20, 09:00 PT |
| `11-youtube.md` | YouTube | Tue 20, 09:30 PT |
| `12-reddit-*.md` | 4 subreddits | Tue 20 + Wed 21, see schedule |
| `13-ph-*.md` | Product Hunt | Tue 27 |

Attachments live in `marketing/` and are named in each file's header.