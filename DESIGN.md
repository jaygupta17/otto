# Otto design system

Mode: **Operate.** People come here to start, watch and steer agents. The interface should disappear into that job. The bar is a native-feeling tool (Finder, Xcode, Linear), not a landing page.

## Scene

Glanced at on a laptop between other work, and on a phone while away from the desk, at any hour. Light and dark both ship; the OS decides.

## Type

- UI: the platform system face (`-apple-system` / SF Pro, Segoe UI Variable, Roboto). One family, weight and size do the hierarchy.
- Code, commands, paths, cron, IDs: JetBrains Mono. Never as decoration.
- Scale (px): 12 meta · 13 controls & labels · 14 UI body · 15 conversation · 17 section title · 22 page title · 28 first-run title. Ratio ≈ 1.15.
- Numerals that change (timers, counts, costs) are tabular.
- Sentence case everywhere. No uppercase tracked labels, no eyebrows above headings.

## Colour (each hue has one job)

| Role | Light | Dark | Job |
|---|---|---|---|
| ground | `#f2f2f1` | `#0d0d0e` | window, sidebar |
| panel | `#ffffff` | `#161618` | main work surface |
| raised | `#ffffff` | `#1d1d20` | inputs, menus, dialogs |
| ink | `#161616` | `#f1f1f0` | text, primary buttons, focus |
| ink-2 / muted / faint | `#3d3d3d` / `#6b6b6b` / `#8f8f8f` | `#c8c8c6` / `#9a9a98` / `#6d6d6b` | hierarchy |
| line | `#e3e3e1` | `#262628` | 1px structure |
| **amber** | `#b86e00` text · `#f0a020` fill | `#f3b13f` | agent is working, live, brand dot |
| **blue** | `#1d5fd6` | `#6d9cff` | needs you: approvals, questions, links |
| green | `#1f8a4c` | `#4cc488` | done, allowed |
| red | `#c93a32` | `#ff6b62` | failed, denied, destructive |

Primary actions are ink, not a hue. Selection is neutral (`active`), never a colour.

## Shape & depth

- Radius: 6 small controls · 8 buttons, inputs, rows · 10 cards & menus · 12 composer & dialogs. Nothing rounder except pills and avatars.
- Structure is drawn with 1px lines. Shadows only on things that float (menus, dialogs, toasts, composer), always offset (`0 8px 24px -8px`).
- Regions sit flush to the window edges and are split by 1px lines; no floating panel cards.
- No gradients or glows. Glass appears only when the user sets a background photo. The one exception is a teammate's face (below).

## Materials (only with a background photo)

| Material | Where | Tint (dark / light) | Why |
|---|---|---|---|
| chrome | sidebar | black / white ~45% · blur 40 | short labels only, so the photo can show most |
| thick | chat, editor, file tree | ~80% · blur 50 | long reading; contrast first |
| regular | composer | ~70% · blur 32 · top edge highlight · shadow | floats above content |
| thin | home chips (context, recent) | ~55% · blur 28 · edge | small separate pieces over the bare photo |

- Home has no panel: the photo is the surface, with a soft radial scrim behind the content and a text shadow on text set directly on it.
- Tints are neutral black or white. Never mix the panel colour into the photo; that reads as muddy.
- Inside glass, lines and fills are white/black alpha (`--border`, `--hover`), not opaque greys.
- "See-through panels" (`--glass`) lowers every material's tint together, keeping their order.

## Words & controls

- Say it once. No description under a self-explanatory title, no label beside an obvious icon (tooltip instead), no status on rows where it's the default ("Not connected").
- Hints only for things a newcomer couldn't guess ("Leave the project": files outside the project folder).
- One field look (`.field`) for inputs, textareas and menu triggers. Never a native `<select>` or time input: use `Select` / `TimeSelect`.
- Settings are grouped rows (`Rows` / `Row`): label left, control right. Lists are one card with hairlines, not a stack of cards.
- Secondary actions live in a `…` menu or appear on hover; a row shows at most one always-visible control.

## Motion

- 150–200 ms ease-out for state changes; no bounce.
- Ambient motion belongs to agents only. A plain agent shows the **agent clock**: a ring with an amber hand that turns while it works. Everything static stays still.
- Respect reduced motion: faces and the clock hold still and keep their state marks.

## Teammate faces

A teammate is a character, not a row: its face is its identity and its status at once.

- A soft lit body (the only gradient in the app: light top-left, shade bottom-right, one highlight) with solid white pill eyes. No pupils, no outlines. It has to read at 14px and stay calm at 120px.
- Body colours stay clear of the status hues so a face never reads as a state. The state shows as a mark on the face, in the status hue:
  - **idle**: breathes and sways, blinks, and does little things on its own: looks around, tilts its head, hops, wiggles.
  - **working**: a nod as it takes the task, bobbing along, eyes narrowed and reading across, and the amber hand running round its rim (the agent clock, worn by the agent).
  - **needs you**: wide eyes, hopping for attention, a blue beacon.
  - **done**: jumps for joy, happy eyes and a blush, sparkles burst out, then calm.
- Faces notice you (`faceLife.ts`). Nearby faces watch the pointer and lean toward it. Hovering what a face belongs to (its row, its card) makes it perk up and grin; pressing squishes it. Hero faces (the new-session greeting, the editor header) also nod along with each word you type, and a few quick pokes make them dizzy.
- Every face keeps its own timing, so a roster never moves in unison. Faces in lists fidget rarely; the hero fidgets often. Below 20px: blinks and hover only, no accessory, and state marks only. Off screen or in a hidden tab, faces hold still. Under reduced motion all of it stops.
- An accessory (antenna, glasses, headset, cap, sprout, bowtie) hints at the job. One at most.
- Where a face carries the state (sidebar rows, the composer chip, handoff cards), don't repeat it beside the face with a clock, a dot or the word "Working".

### Leads and handoffs

A lead (Juno, the chief of staff) takes the whole job and hands the parts to teammates through OpenCode's subagent tool. Nothing runs outside OpenCode.

- Leads compile as primary agents, so nobody hands work to a lead; everyone else compiles as `all` and is offered to the lead by name, job and tagline. One level deep: a teammate doing a lead's part can't hand it on.
- Each handoff shows in the lead's thread as a card with the teammate's face wearing that part's state, and their name. The report card wears the face too.
- While a teammate works on a lead's part, its sidebar row and phone face show it working, with "On a task for Juno" under the name. If it asks you something, both it and the lead show "Needs you", and the question waits in the lead's thread.
- Leads sit first in the sidebar, the phone team strip and Agents.

## Signature

The agent clock plus tabular elapsed time (`Working · 1:24`) is how activity reads everywhere: composer, timeline, sidebar, schedules.

### Live lines, not cards

What's happening right now reads as one quiet line: a spinner, a word or two, the time, and a chevron (`◔ Working 0:24 ›`).

- The spinner is the teammate's own working face when there is one, else the agent clock.
- A live turn shows nothing of its own while something in it is moving (words streaming, a tool or teammate running). In the gaps between, only the spinner shows, with no "Working" and no timer, so the turn never looks frozen. Only a retry gets words.
- Live words shimmer (`.shimmer`: a soft light sweeping through the text). The shimmer is what says "live", so don't add "Running" or "In progress" next to it. When it stops, the text turns plain.
- States are cues, not labels: a stop is struck through, a failure takes the red, needing you takes the blue. Done is the face's done state and the shimmer stopping.
- No boxes around activity. Detail opens under the line, hanging off a thread line; content (a brief, a result, code) may sit in its own box.
- Actions are icons that appear when you reach for the line (always shown on touch), and their tooltips name them. No words where the icon already says it: ↗ opens, ■ stops.
- Don't show a control until it matters (Steer or Queue appears once you've typed while the agent works), and let the placeholder say the mode ("Steer Juno…").

### Background work

Work that outlives its turn (a command the agent left running, a teammate on a part in the background) stays visible until it ends.

- Its row stays live where it started: the shimmer, the clock, the time, and a faint "in the background". It ends in place with its own output, and its report never shows as a separate card.
- Above the composer, one line per thing still running for this chat (its own commands, and those of teammates working for it), with ■ on hover. Two or more fold into "2 running in the background", which opens in place. A command shorter than a breath never appears there.
- A folded run that left work going says so on its summary line ("· 1 still running").
- A blocking command or teammate that has run a few seconds offers "Keep running in the background" (send-to-back icon): the turn moves on and the work carries on.
- Stopping posts a note telling the agent it was you before anything is killed, so the agent doesn't retry what you stopped. The row keeps what the command printed up to then.

### Apps

- An app always shows its own logo, on a white tile (rounded square in lists, circle in chat), so it reads the same in light and dark.
- A connect link from the agent becomes a pill button: logo and "Connect Gmail", then "Waiting for you in the browser…" with a pulsing blue dot (needs you), then "Gmail connected" with a green check and **Carry on**.
- App calls read as what happened to the app ("Checked Google Calendar"), never as the script that made them.

### Permissions

- Show what will happen, never "Auto" or "inherit". Allow (green) / Ask (blue, it needs you) / Block (red). The answer that applies is always lit: in its colour on a plain pill when it comes from the default, filled when it was set here.
- Under each row's name, "Default" or "Changed · Reset".
- An agent's permissions open with a plain-words summary in three lines: free to, asks you first to, never allowed to.
