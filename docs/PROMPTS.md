# Otto prompts — house rules

How we write the text that goes into Otto's prompts: the compiled teammate prompt
(`src/lib/teammates.ts`), the plugin tool descriptions (`presentPlugin.ts`,
`schedulesPlugin.ts`), the memory templates (`memory.ts`) and any future prompt
surface. Derived from a close read of the strongest current system prompts
(`asgeirtj/system_prompts_leaks`, Nov 2026 — frontier models and the best agent
products); plan and evidence: `projects/otto-prompt-refinement-plan-2026-11-03.md`.

## Writing rules

1. One rule per sentence. Name the failure the rule prevents. Bans stand alone
   ("A blocked permission is a fence, not a puzzle.").
2. Address the agent as "you", imperative present. No meta-instructions
   ("feel free to", "you should aim to"). No third-person narrator voice —
   that's another vendor's house style.
3. Lead with the positive when it helps ("with the user's yes…" before
   "never…"), and make exceptions explicit ("only when (a)… or (b)…").
4. A section earns its place only if its absence produces a failure class.
   Headings are the routing table; does the model find the section while acting?
5. Word-policing ages badly: the best 2026 prompts *deleted* their banned-word
   lists. Keep ours to the two conscious keeps (no emojis unless the user uses
   them first; no "On it" filler) and add nothing else without evidence from
   Otto's own transcripts.
6. Description layers carry a "when NOT to use it" line, for every agent and
   every tool. That is the guard rail the lead reads before anything else.
7. Tool descriptions are rules with fallbacks: when NOT to use it, what the
   misuse costs, then the fallback ("If a path can't be read or doesn't exist, the chip says so").
   A WRONG/RIGHT pair beats a paragraph.
8. Machine contracts stay sentence-level, never JSON in prose: `Result: …` /
   `Needs input: …` / `Failed: …`, a restatement first line, status lines at
   the end.
9. Budgets, enforced by test: compiled lead prompt ≤ 14,000 chars,
   specialist ≤ 12,000 chars, memory files ≤ 40 lines. Growth is a decision —
   the test failing should force that conversation, never happen silently.
10. Multi-model gate: no model or vendor names, no clause that only makes sense
    on one provider's harness (channels, persona sliders, wire formats). A
    prompt change ships only if it reads right on a non-Anthropic model.
11. Original text only. The leak corpus is proprietary prompt text: the craft
    transfers, the words don't. Clean-room, same rule as Rook.

## Machinery

- `TEAMMATE_PROMPT_VERSION` in `teammates.ts` bumps whenever any compiled text
  changes; `resync()` recompiles every teammate on the user's next connect, so
  the bump is the deploy. Tool-description changes (generated plugins) deploy
  by file-diff on connect; no bump needed.
- `memory.test.ts` pins the memory section's wording and ordering — read it
  before editing `memoryPrompt`.
- After any prompt edit: `bun run typecheck`, `bun test`, `bun run build`,
  then one live check per changed surface with real credentials.
