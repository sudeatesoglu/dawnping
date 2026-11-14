# dawnping

Start your Claude Code usage window at the right time, so its resets land inside your working day instead of after it.

> **Status:** early development. Nothing to install yet.

## The idea

Claude Code subscriptions have a 5-hour usage window that starts with your first message. If you start working at 10:00, the window resets at 15:00, and a workday that ends at 18:00 only ever sees two windows.

If the window had started at 07:00, it would reset at 12:00 and again at 17:00, so the same workday sees three fresh windows. dawnping sends one tiny message before you start work to make that happen.

Several tools already do this with a fixed schedule. dawnping's goal is to decide *when* from your own data:

- **Learns your pattern** from Claude Code's local session logs and suggests the best trigger time
- **Simulates** past days: "with a 06:30 trigger you would have waited 1.5 h instead of 6 h"
- **Keeps the window chain going** during work hours (for example over a lunch break)
- **Verifies** that the ping actually started a window and notifies you if it didn't
- **Profiles per weekday**, skip dates and optional calendar awareness, all managed from the CLI
- **Status line** for Claude Code showing the next reset

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

Architecture decisions are recorded in [`docs/adr/`](docs/adr/).

## License

Not decided yet.
