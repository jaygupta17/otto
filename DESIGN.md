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
- No gradients or glows. Glass appears only when the user sets a background photo.

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
- The only ambient motion is the **agent clock**: a ring with an amber hand that turns while an agent works. Everything static stays still.
- Respect reduced motion.

## Signature

The agent clock plus tabular elapsed time (`Working · 1:24`) is how activity reads everywhere: composer, timeline, sidebar, schedules.
