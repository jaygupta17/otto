# Otto design system

Mode: **Operate.** People come here to start, watch and steer agents. The interface should disappear into that job. The bar is a native-feeling tool (Finder, Xcode, Linear), not a landing page.

## Scene

Glanced at on a laptop between other work, and on a phone while away from the desk, at any hour. Light and dark both ship; the OS decides.

## Type

- UI: Geist (variable). One family; weight and size do the hierarchy.
- Meta: Geist Mono at 11–12 for timestamps, durations, counts, shortcuts, paths, IDs and code. Always tabular.
- Display: Geist Pixel (Square), for a few moments: the live status line, empty-state headlines, big numbers, and the status line under a page's large title (13px, uppercase, tracked: the one place capitals are allowed, because pixel type reads as a readout). Never for body text.
- Scale (px): 12 meta · 13 controls & labels · 14 UI body · 15 conversation · 17 section title · 22 page title · 28 first-run title. Ratio ≈ 1.15.
- Phones step up one size: 16 for list titles and every text input (smaller input text makes iOS zoom; on a coarse pointer `styles.css` lifts every field to 16, since pinch-zoom stays on), 17 for the bar title, 14 for second lines. Each tab opens on a 34px large title (`PageTitle`) that hands over to the small bar title once scrolled away.
- Group labels are 11px uppercase (see Layout), never with counts beside them.
- Sentence case everywhere else. The only other capitals are the pixel status line under a phone title. No eyebrows above headings.

## Colour (each hue has one job)

Cold and quiet: blue-steel neutrals in light, graphite (not black) in dark, one ice accent. Work in progress is shown by motion (shimmer, dither), not by a hue.

| Role | Frost (light) | Dark | Job |
|---|---|---|---|
| ground | `#eef1f5` | `#19191b` | window, sidebar, phone pages |
| panel | `#fbfcfe` | `#1b1b1d` | main work surface |
| surface | `#ffffff` | `#212123` | cards, menus, dialogs |
| raised | `#ffffff` | `#252527` | cards, menus; the chosen item (`chip`) mixes in ice |
| ink | `#0a1424` | `#eef3f8` | text, primary buttons, focus |
| ink-2 / muted / faint | `#2c3646` / `#5d6878` / `#858f9e` | `#d0d0d4` / `#a0a0a7` / `#76767d` | hierarchy |
| line | `#dde2e9` | `#2c2c2f` | 1px structure |
| **ice** | `#155ea6` text · `#1a73c9` fill | `#8fd0ff` | actions, the chosen item, where you are, list icons, needs you, live, new, links |
| mint | `#13865f` | `#5fe0b0` | done, allowed |
| red | `#c8372f` | `#ff6f6a` | failed, denied, destructive |

Ice is the one hue, and it does a job: primary actions and send are ice fills (`bg-accent text-on-accent`), switches and picked choices are ice, the chosen row or tab is a `chip` tinted ice, the current phone tab and the icons that lead settings, sidebar and template rows are ice. Group labels are not: they're a quiet grey between body and hint (`.list-label`). Body text, titles and secondary controls stay neutral, so ice still means "this one". A send with nothing to send is ice at 35%, not grey. Every surface is lighter than the page under it: nothing is ever darker than the ground, so no field, track or card reads as a hole.

## Dither

Otto's one texture is ordered (Bayer 8×8) dithering: tone is carried by how many hard dots are on, never by blur, glow or gradient (`lib/dither.ts`).

- Dots are one CSS pixel (two from 48px up) and never smoothed (`.dither`, `image-rendering: pixelated`).
- Dithered canvases share one ticker at 18 fps, so they read as pixels changing, not video. They hold still off screen and in a hidden tab, and draw one still frame under reduced motion.
- Dither is for things that are alive (the agent orb, live text) and, sparingly, for big empty moments. Never behind text you have to read.
- A live turn breathes (`DitherBreath`): a 28px lit sphere, 2px dots, that swells and shrinks while its light circles it. It never touches its canvas edge, so it stays round.
- Shares are dots too: context used is a still pie (`DitherGauge`) in the composer and a straight bar (`DitherMeter`) in the usage card, solid up to the share over a sparse track. A pie, never a ring, so it can't be mistaken for a spinner.
- Pages have weather (`DitherField`, `ui/Hero.tsx`): live 2px dots on an 8px grid in the accent. On Home and the new-session screen it's a faint field (`Sky`, 45%) weighted to both edges and fading in from the top. It scrolls away with the title and never reaches rows, cards or chat.
- Live counts ("3 working") use `.shimmer.shimmer-accent`: the dithered light sweeping through accent text.
- Edges dissolve into dots, not a soft gradient (`.dither-fade-top`, drawn at the screen's density): streaming thoughts and the top of the thread under its header fade this way.
- Pressing a phone row grows dots from under your finger (`ui/Spot.tsx`, DitherUI's dither spot), held long enough to see on a quick tap, then fading.

## Shape & depth

- Radius: 6 small controls · 8 buttons, inputs, rows · 10 cards & menus · 12 dialogs · 20 the composer (22 on phones), the ask dock and inbox tray above it, and chat bubbles · 24 the composer's tray (the composer + its 4px padding, so the corners nest). Fully round: avatars and the composer's buttons and pills.
- Chat: your messages are ink bubbles on the right (`bubble-me`), the agent's words grey bubbles on the left (`bubble`). Tool activity, files and commands stay outside bubbles. A centred time starts each new stretch of conversation.
- Structure is drawn with 1px lines. Shadows only on things that float (menus, dialogs, toasts, composer), always offset (`0 8px 24px -8px`).
- Things that hold controls are bezels (`.bezel`, and `.surface-float` / `.surface-overlay` get it for free): a hairline, a lit top edge, a soft glow from above (both in `--lit`, the text colour cooled 40% toward the accent) and a faint dot grain fading out from the middle. Settings cards, grouped lists, the composer, menus, dialogs and toasts. Never chat activity, rows or birds: those sit bare. The one exception is a phone session that wants you, which is its own card (below).
- Four materials, after DitherUI (`styles.css`), and nothing else makes a box:
  - `bezel`: a control surface (cards, grouped lists, the composer, menus). Lighter than the page, with a hairline and a lit top edge.
  - `well`: a recessed track: a segmented control's track, the phone tab bar, an icon socket. A touch lighter than its surroundings, with an inner shadow along the top.
  - `chip`: the chosen item in a well or list: the active tab, sidebar row, settings page or file. Raised with a little ice mixed in (12% light, 22% dark), an ice hairline, lit top edge, small shadow. Selection never uses a flat fill. Segment pills (`seg-pill`) stay neutral, since their text carries the colour.
  - `field`: an input, a light well with a focus ring. Search boxes and text fields everywhere use it.
- Small extras: `kbd` is a keycap for shortcuts (search, the palette); `topbar` is a bar that is clear at rest and frosts (`topbar-on`: the page colour at 84%, blur, hairline) once the page scrolls under it.
- Regions sit flush to the window edges and are split by 1px lines; no floating panel cards.
- No glass and no colour gradients. The bezel's glow is the only gradient, and it's the text colour at a few percent.

## Layout

- Desktop: sidebar · chat · tools panel. No rail. The panel button at the end of the chat header (⌘⇧\\) opens the panel on the surface used last; the menu at the start of the panel's header switches between Files, Terminal, Browser, Context, Project and Memory.
- Phone: a tab bar along the bottom with four places: Sessions · Team · Schedules · Settings. It's a capsule `well` (60px, 22px radius) and the current tab is a `chip` that slides between them. Tabs only navigate, never act; Sessions carries a blue count of sessions waiting on you, and tapping the current tab scrolls it to the top. A pushed session covers the bar, so the composer owns the bottom.
- Every phone tab but Sessions opens the same way (`RootPage` / `PageTitle` / `TopBar`): a 32px title level with the tab's actions (plain icons, 44pt). No counts ("7 teammates", "Nothing scheduled"): the list under it already says so. No dots under the header. The title row starts 16px from the top and content starts 24px under the header on every tab. Nothing sits above the title. Scroll past it and a frosted bar fades in with the name small in the middle.
- Phone Sessions: no title; the header leads with the machine as a pill (`bezel`, rounded-full: its provider icon in a round well, the name at 17px semibold, a ▾), the same icon-and-name language as the menu it opens to switch, add or manage workspaces. A pixel status pip joins it only when it isn't connected. Search, inbox and new session are icons on the right. The list goes:
  - **Active** (needs you, then working, then a result you haven't opened, failures included): each session is its own raised card (`bezel`) with the agent's 56px bird, a 17px title and its state; a ring of ice when it needs you. While it works, the state line shimmers what it's doing right now (`Edit Thread.tsx`, `Thinking`), like a handoff line in chat; between steps it says who is working. Once you've opened it, it moves to Recent.
  - **Agents**: bare rows down the page, no card (60px dozing bird, 17px name, 15px job, a faint ✎); tap to start a session. Anyone already in Active is left out. Hidden while searching.
  - **Recent**: bare text rows with hairlines between them (title, who · where, time). No birds: faces mean agents, so history reads as history.
  - Three tiers, three looks (a card with a face, a face, a line of text), 40px between sections, and only Active is raised: nothing else on the page competes for attention.
- Phone Settings follows iOS Settings: grouped lists on the page colour (`bg-bg`), with bezel cards (14px radius) and small uppercase group labels. Settings pages push in with the same grouped look (`Sheet grouped`, wrapped in `PhonePage`); inside them `.group-card` is the same card as the list it came from, and a tab's own heading gives way to its description, because the page bar already names it. List rows are a choice: tap the row, a check marks the current one, and everything else sits behind `…`.
- Bars hold plain icons, never grey circles or bordered buttons; the rest goes in the `…` menu. Deeper screens are pushed full-screen pages, never bottom sheets; a pushed page takes focus itself (`data-focus-self`), so its back button doesn't open ringed. Touch targets are 44pt: menu rows grow on a coarse pointer, and a page's main buttons are `h-11` at 15px.
- Icons are Lucide at stroke 1.75, sized to the text beside them: 16–17 in desktop headers, 21–22 in phone bars.
- Group labels in session lists (sidebar and phone) are `.list-label`: 11px, semibold, uppercase, tracked 0.06em, in a grey halfway between `--text-2` and `--muted`, so they divide the list without competing with it. Elsewhere (settings, panels) they're the same size in ice (`text-accent-ink`). Page and row text is never uppercase. A label sits flush with the left edge of what it labels: the card under it, or the row marks in a full-bleed list, which on phones is the same 16px as the page title. Never indent a label past its card.
- The sidebar has the phone's tiers (`state/tiers.ts` ranks both): **Active** rows are raised (`bezel`, a `chip` when open) with the agent's 40px face, the title and the live line; the open one stays up there while you're in it. **Agents** are bare rows (42px face, name, job; ✎ on hover), and clicking one starts a draft with them; a teammate on a lead's task shimmers what it's doing instead of its job. Then **Pinned** and **Recent** as text. A plain agent (no bird) gets `PlainMark`: a dither orb in an empty square, never a grey circle with a speech bubble.
- Sidebar history rows (Pinned, Recent) are text only: title and time, then who · where with the state's pip at the end. Birds belong to agents, never to history. No date groups: the time on each row says it.
- Scrollbars appear only while the pointer is over a scroller (`.scroll-quiet`) and never on touch.

## Words & controls

- Say it once. No description under a self-explanatory title, no label beside an obvious icon (tooltip instead), no status on rows where it's the default ("Not connected").
- Every icon-only control has an `aria-label` and a tooltip: `data-tip` names it, `data-tip-keys` adds its shortcut, dimmed. Tooltips appear only with a fine pointer; add `data-tip-tap` where touch needs the detail too (a turn's model and speed). `IconButton` does all of this from `label` and `keys`.
- Detail that's only sometimes wanted (model, speed, paths, why something is off) lives in a tooltip, not as text on the row.
- Hints (`Hint`, an ⓘ) only for things a newcomer couldn't guess ("Leave the project": files outside the project folder).
- One field look (`.field`) for inputs, textareas and menu triggers. Never a native `<select>` or time input: use `Select` / `TimeSelect`.
- Settings are grouped rows (`Rows` / `Row`): label left, control right. Lists are one card with hairlines, not a stack of cards.
- Secondary actions live in a `…` menu or appear on hover; a row shows at most one always-visible control.
- Cards in settings are `.group-card`: raised with a hairline on desktop, borderless on a phone page. Use it instead of hand-rolled `rounded-2xl bg-raised` cards so both looks stay in step.
- Profile pages (agents, teammates) lead with who it is: a large bird or colour mark, the name and one line about them, then a tab switcher. Text fields sit inside a `.group-card` as `FormRow`s (a small label above a borderless input, rows split by hairlines); switches and short values use `Row`. Destructive actions are a centred red row in their own card, confirming in place.
- The composer, after DitherUI's prompt input: a raised `composer` card (bezel, an ice ring on focus) whose tools sit on their own row under the text: + (rotates to × when open), the agent pill, a Steer/Queue pill while busy, then on the right context, model pill, and a round send. Round 32px controls on desktop, 40px on phones. Ice marks only the next action: send, or stop when there's nothing to send (stop goes neutral beside send). Shell mode is an ice `Shell ×` pill. Where the composer starts something (Home, a phone draft) it sits in a `well` tray with a strip under it for the project and where it runs.
- An agent's questions and approvals dock above the composer, one at a time with a tab for each. Choices are a list with their explanation underneath, and the last row is always a field for your own answer; shortcuts sit in tooltips.

## Motion

- 150–200 ms ease-out for state changes; no bounce.
- Ambient motion belongs to agents only. A teammate shows it through its bird; a plain agent shows the **agent orb**: a small dithered sphere in ice whose light circles it while it works. Everything static stays still.
- Respect reduced motion: birds and the orb hold still and keep their state marks; shimmer turns to plain text.

## Teammate birds

A teammate is a character, not a row: its bird is its identity and its status at once. The birds come from the Flock set (`lib/flock`): nyx the owl, vanta the raven, floe the penguin, fjord the puffin and flake the chickadee are the everyday five a new teammate is given at random; talon, zip and cinder are there to pick.

- **Lines only, no tile.** Each bird is ink line art in the text colour. Its inner shapes (the parts that hide lines behind them) are filled with paper (white in light, black in dark) and the art is blended (`multiply` in light, `screen` in dark), so the paper vanishes on any surface, row hover or selection. Never transform or fade `.bird` itself, which would break the blend; only `.bird-art` moves.
- **Framed tight.** The default crop fits the whole bird to its box, so a 24px bird is all bird. `bust` (head and shoulders, clipped) and `full` (the whole 240 grid, optional perch) are for big moments. One bird everywhere: every line at every size, a touch finer when small (`lib/flock/build.ts`), so the 18px bird in a picker is the same drawing as the 88px one on its profile. No simplified small birds. Motion and scene marks (thought cloud, sparkles) stay at every size; on a 32–96px bird they grow (up to 1.8×, lines kept at the bird's weight) and step out from its middle so they read without covering its face. List birds (under 32px) keep theirs as drawn.
- **State is the bird's expression**, with no mark beside it. Every bird asks `state/face.ts` (`faceOf` for a session; `mateFace` for a teammate, the loudest of its sessions and the parts it's doing for a lead), so it wears the same face everywhere:

  | State | Face | When |
  |---|---|---|
  | idle | breathes, blinks; dozes in lists | nothing going on |
  | working | thinking, eyes up; small birds bob | tools running, the model thinking |
  | writing | typing | the reply is streaming in |
  | retrying | shivering | waiting to try the model again |
  | needs you | puzzled | a question or approval waits |
  | done | happy, a hop | a result you haven't seen |
  | failed | upset | it didn't finish (a teammate drops it once you've seen it) |
  | stopped | sad | stopped before it finished |

  Between states a bird has a moment (`reaction` in `state/face.ts`, about a second) before it settles:

  | Change | Moment |
  |---|---|
  | working → writing | a light bulb (once per 45s, not every message) |
  | needs you → working | hearts: thanks for answering |
  | retrying → working | shades on: back on track |
  | working → done | a party: star eyes, hat, confetti |
  | working → idle (you watched it finish) | happy |
  | working → failed | a jolt (wide eyes, "!") before it goes dizzy |

  Joining the team (hiring) is a party. The profile header's face cycles through all sixteen moods when tapped.
- **It notices you** (`ui/Bird.tsx`). Nearby birds watch the pointer. Hovering what a bird belongs to (its row, its card) perks it up; pressing squishes it. Hero birds (the new-session greeting, the profile header, the bird on a session's reply box) greet you, look down at what you type and nod along, wink or puzzle now and then while they wait. A pat gets hearts; a few quick pokes make them cross.
- **Asleep until needed.** A quiet list-size bird (under 64px, not working, not needing you) dozes, and it should read from across the room: eyes closed, a slow deep breath with a sway (owls nod off and catch themselves), a snore bubble swelling at the beak, and three ice z's drifting up and out past the row. Hover its row and it wakes, then nods off again a moment after you leave. Never on the reply box (`doze={false}`): you're already with that agent.
- **A glint of light.** Every bird's lines carry a band of the accent that sweeps across now and then (every 9s, staggered per bird; every 1.8s while thinking). It stops off screen and under reduced motion.
- Every bird keeps its own timing, so a roster never moves in unison. Off screen or in a hidden tab, birds hold still. Under reduced motion all of it stops.
- **Perched on the reply box.** A session's header is just the name over the title; the agent's bird (56px, 52px on phones) stands on the top right of the reply box instead, or on whatever is stacked on it, feet on its edge (`Perch` in chat/Composer.tsx, `FEET` in lib/flock/birds.ts). It carries the session's state and follows the turn's status line: a nod at each new step, typing while a file is being edited or written. It's the only bird in a session; the thread itself has none. The thread ends a little above its head so the last line is never behind it. Plain agents have no bird, so nothing perches.
- Birds don't overlap or stack: blended line art doesn't hide what's behind it.
- Where a bird carries the state (sidebar rows, the composer chip, handoff lines), don't repeat it beside the bird with an orb, a pip or the word "Working".
- The helpers teammates hand work to (explore and general, `HELPERS` in `lib/teammates.ts`) are not birds: birds are for teammates. Each is a dither glyph (`ui/DitherAvatar.tsx`, after DitherUI's dither avatar): a 7×8 grid mirrored left to right, solid and checker-dithered cells grown from a fixed seed, in the text colour with whole-pixel cells. Ice while it works (its checker flips phase), ice when it needs you, red when it failed; on hover it tilts and flips. They're listed in Agents as subagents but never offered as someone to talk to, and they wear their glyph everywhere a teammate wears a bird: handoff lines, the running strip, their conversation's header, questions they ask. Nothing perches on a helper's reply box. Draw any agent with `AgentMark` (`useHasFace(id)` says whether it has a bird or glyph); `useMascot(id)` is a teammate's bird only.
- Plain agents (no teammate, not a helper) are the dither orb (`PlainMark`) wherever a bird would be, settings included: never a colour dot.

### Status pips

No round colour dots. Where no bird carries a state (connections, MCP servers, schedules and their runs, app permissions, new alerts, plain-agent rows), it's a pip (`ui/Pip.tsx`): a 3×3 block of 2px pixels whose shape says the state, so it reads without its colour.

| Tone | Shape | Means |
|---|---|---|
| on | solid, ink | connected, ran, allowed |
| new | solid, ice | unread, a new result |
| live | a ring with light running round it, ice | connecting, adding, waiting on a reply |
| needs | a plus, ice | waiting on you, asks first |
| error | an x, red | failed, blocked |
| off | a hollow ring, faint | off, never run |

Counts on the bell and the tab bar are small ice squares, not red circles; a pager of steps is short bars, the current one longer.

### Leads and handoffs

A lead (Juno, the chief of staff) takes the whole job and hands the parts to teammates through OpenCode's subagent tool. Nothing runs outside OpenCode.

- Leads compile as primary agents, so nobody hands work to a lead; everyone else compiles as `all` and is offered to the lead by name, job and tagline. One level deep: a teammate doing a lead's part can't hand it on.
- Each handoff shows in the lead's thread as one line: the teammate's bird (40px, so its face reads; the detail's thread line hangs from its centre) wearing that part's state and what they're doing right now (their latest step, else the task), shimmering, with the time so far. No name on the line: hover the bird for it (tap on phones). Done, it only says "Finished in 2m 14s"; the brief and the report wait behind the chevron. "Needs you", "Couldn't finish" and "Stopped after 40s" take its place when they apply. A report with no call in view is the same line ("Finished"). Stop (■, while it runs) and their conversation (↗) sit at the end of the line, always shown.
- While a teammate works on a lead's part, its sidebar row and phone bird show it working, with what it's doing (or "On a task for Juno" between steps) under the name. If it asks you something, both it and the lead show "Needs you", and the question waits in the lead's thread.
- Leads sit first in the sidebar, the phone Team tab and Agents.

## Signature

The agent orb plus tabular elapsed time (`Working · 1:24`) is how activity reads everywhere: composer, timeline, sidebar, schedules.

### Live lines, not cards

What's happening right now reads as one quiet line: a spinner, a word or two, the time, and a chevron (`◔ Working 0:24 ›`).

- A live turn's status is one line (`chat/Working.tsx`): the breathing orb (`DitherBreath`) and what it's doing right now in muted text with three pulsing dots ("Thinking…", "Reading Thread.tsx…", "Running bun test…"; `toolDoing` in lib/opencode/tools.ts). Each phrase rolls up into the next and holds at least 0.7s so quick steps don't flicker. While a run of steps is the live end of the turn, that line is the run's heading, with a chevron that opens the steps; once the run is over it folds to "Worked 55s". It stands on its own only where there's no run to head: before the first step, between prose and the next step, after a handoff has finished. A handoff isn't a step for it: while one is going, its own line says what's happening and no status line repeats it ("Waiting on Scout" never shows). It hides while the reply streams in; a retry takes it over with the countdown and the reason. No bird in the thread: the one on the reply box reacts instead.
- Runs of steps are folded by default, live or done: you open one to see its steps. A long command holding up the turn still offers "Keep running in the background" on the folded line.
- Sidebar rows and phone cards say the same step while it happens ("Editing Thread.tsx"), then what it did ("Edited Thread.tsx") between steps.
- The model's thinking shows in the thread as a folded line, even while it streams; open it to read. Settings › Appearance › Show thinking hides it.
- A message's actions (copy, edit, fork) sit under it, right-aligned, on hover (always on phones).
- Rows in the trail don't spin or show a timer while they run: the status line says the turn is live, and the row's shimmer says which step.
- Live words shimmer (`.shimmer`: a band of ordered-dither dots sweeping through the text, drawn in the theme's own colours, with a sparse edge of accent dots either side of the bright core). The shimmer is what says "live", so don't add "Running" or "In progress" next to it. When it stops, the text turns plain.
- States are cues, not labels: a stop is struck through, a failure takes the red, needing you takes the blue. Done is the bird's done state and the shimmer stopping.
- No boxes or fills around activity, teammates included: a handoff is a line like any other. Detail opens under the line, hanging off a plain thread line (no live strip down it); each step on it hangs from a small square node (ice while live, red when it failed, faint when done). Content (a brief, a result, code) may sit in its own box.
- Actions are icons that appear when you reach for the line (always shown on touch), and their tooltips name them. No words where the icon already says it: ↗ opens, ■ stops.
- Don't show a control until it matters (Steer or Queue appears once you've typed while the agent works), and let the placeholder say the mode ("Steer Juno…").

### Background work

Work that outlives its turn (a command the agent left running, a teammate on a part in the background) stays visible until it ends.

- Its row stays live where it started: the shimmer, the orb, the time, and a faint "in the background". It ends in place with its own output, and its report never shows as a separate card.
- Above the composer, one line per thing still running for this chat (its own commands, and those of teammates working for it), with ■ and ↗ always shown. Two or more fold into "2 running in the background", which opens in place. A command shorter than a breath never appears there.
- A folded run that left work going says so on its summary line ("· 1 still running").
- A blocking command or teammate that has run a few seconds (4s) offers "Keep running in the background" (send-to-back icon): the turn moves on and the work carries on. It acts on the lead's turn (OpenCode's `session.background`), so it moves everything that turn is waiting on. OpenCode marks every handoff `status: "running"` as it starts; only a call that *settled* that way (or asked for `background`) is in the background (`subagentOf`).
- A session with work still going counts as working: it stays under Active with its bird awake, and its line says what's going ("Scout working in the background", "bun dev running in the background", "2 running in the background"; `useBackgroundLine` in state/tiers.ts) until its own turn or the next step takes over.
- Agents are told to prefer the background (`teammatePrompt`): anything slow goes to the background, they carry on with work that doesn't overlap, and with nothing left they say what's running and end the reply, then pick up from the result. A lead hands parts off in the background and reports when they're in. A teammate on a lead's brief stays in the foreground, since its last reply is the report.
- Stopping posts a note telling the agent it was you before anything is killed, so the agent doesn't retry what you stopped. The row keeps what the command printed up to then.

### Apps

- An app always shows its own logo, on a white tile (rounded square in lists, circle in chat), so it reads the same in light and dark.
- A connect link from the agent becomes a pill button: logo and "Connect Gmail", then "Waiting for you in the browser…" with a live pip, then "Gmail connected" with a green check and **Carry on**.
- App calls read as what happened to the app ("Checked Google Calendar"), never as the script that made them.

### Permissions

- Show what will happen, never "Auto" or "inherit". Allow (green) / Ask (blue, it needs you) / Block (red). The answer that applies is always lit: in its colour on a plain pill when it comes from the default, filled when it was set here.
- Under each row's name, "Default" or "Changed · Reset".
- An agent's permissions open with a plain-words summary in three lines: free to, asks you first to, never allowed to.
