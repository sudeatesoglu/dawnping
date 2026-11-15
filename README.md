# dawnping

[![CI](https://github.com/sudeatesoglu/dawnping/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/sudeatesoglu/dawnping/actions/workflows/ci.yml)

Start your Claude Code usage window at the right time, so its resets land inside your working day instead of after it.

> **Status:** early development. Nothing to install yet.

## The idea

Claude Code subscriptions have a 5-hour usage window that starts with your first message. If you start working at 10:00, the window resets at 15:00, and a workday that ends at 18:00 only ever sees two windows.

If the window had started at 06:30, it would reset at 11:30 and 16:30, and your day's work would be split differently across the windows. dawnping sends one tiny message before you start work to make that happen. What matters is not the number of windows but how your work is split across them, so that you can do as much as possible before hitting a limit ([ADR-0005](docs/adr/0005-minimize-squared-window-loads.md)).

Several tools already ping on a fixed schedule. dawnping decides *when*:

- **Plans the ping time** from your working hours, busy stretches and breaks; `dawnping plan` explains every choice
- **Skips the ping** when a usage window is already running
- **Verifies** that the ping landed in Claude Code's session log and notifies you if it didn't
- **Profiles per weekday** and skip dates, all managed from the CLI

Planned: learning your pattern from the session logs, keeping the window chain going over breaks, a Claude Code status line and calendar awareness.

## Caveats

- dawnping does not give you more usage. Weekly limits still apply; it only distributes the 5-hour windows better across your day.
- How the window is anchored (exact time vs. rounded to the hour) is not officially documented. dawnping measures and lets you configure it.
- macOS first. Your Mac has to be awake at trigger time (dawnping will help you set that up).

## Development

Requires Node.js 22.12 or newer and pnpm.

```sh
pnpm install         # also installs the git hooks
pnpm build           # bundle the CLI into dist/
node dist/cli.js --help

pnpm lint            # Biome lint and format check
pnpm typecheck       # type-check, including the pure-core boundary
pnpm test            # unit tests (pnpm test:coverage for coverage)
```

Architecture decisions are recorded in [`docs/adr/`](docs/adr/). Branch protection lives in [`.github/rulesets/`](.github/rulesets/) and is applied with `node scripts/apply-rulesets.mjs` (needs admin access through the GitHub CLI).

## License

Not decided yet.
