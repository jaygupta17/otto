# Contributing to Otto

Thanks for helping. Small, focused pull requests are easiest to review.

## Setup

```bash
bun install
bun run oc:local    # local OpenCode v2 server with an isolated config
bun run app:dev     # desktop app with hot reload
```

`bun run dev` runs the UI in a browser at http://localhost:1420, which is handy for quick UI work.

## Before you open a pull request

```bash
bun run typecheck
bun run build
cd src-tauri && cargo check
```

- Follow [DESIGN.md](DESIGN.md) for anything visual: system type, the color roles, 1px structure, and the agent clock as the only ambient motion.
- Write UI copy in sentence case. Name actions by what they do, and say how to recover in error messages.
- Keep secrets out of logs, URLs we build, and committed files.
- Talk to OpenCode through `src/lib/opencode/client.ts`, and keep wire shapes in `src/lib/opencode/`.

## Adding a sandbox provider

Providers live in `src/lib/providers/`. A provider needs to: create or resume a machine, run a shell script on it, and expose a port over HTTPS. Look at `boat.ts` and `provision.ts`, then add the provider to the list in `components/onboarding/Onboarding.tsx`.
