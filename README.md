# dawnping

[![CI](https://github.com/sudeatesoglu/dawnping/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/sudeatesoglu/dawnping/actions/workflows/ci.yml)

Start your Claude Code usage window at the right time, so its resets land inside your working day instead of after it.

> **Status:** early development. It runs from source on macOS; it is not published to npm yet.

## The idea

Claude Code subscriptions have a 5-hour usage window that starts with your first message. If you start working at 10:00, the window resets at 15:00, and a workday that ends at 18:00 only ever sees two windows.

If the window had started at 06:30, it would reset at 11:30 and 16:30, and your day's work would be split differently across the windows. dawnping sends one tiny message before you start work to make that happen. What matters is not the number of windows but how your work is split across them, so that you can do as much as possible before hitting a limit ([ADR-0005](docs/adr/0005-minimize-squared-window-loads.md)).

Several tools already ping on a fixed schedule. dawnping decides *when*:

- **Plans the ping time** from your working hours, busy stretches and breaks; `dawnping plan` explains every choice
- **Skips the ping** when a usage window is already running
- **Verifies** that the ping landed in Claude Code's session log, retries with growing gaps and notifies you if it keeps failing
- **Recognizes usage limits** and tries again when the limit resets, if that is still within your working hours
- **Profiles per weekday** and skip dates, all managed from the CLI
- **`dawnping doctor`** checks the whole setup and says what to fix

Planned: learning your pattern from the session logs, keeping the window chain going over breaks, a Claude Code status line and calendar awareness.

## Try it from source (macOS)

You need Node.js 22.12 or newer, pnpm, and Claude Code signed in with a Pro or Max subscription.

```sh
git clone https://github.com/sudeatesoglu/dawnping.git
cd dawnping
pnpm install && pnpm build
alias dawnping="node $PWD/dist/cli.js"

dawnping config set profiles.default.work 09:30-18:00   # your working hours (Mon-Fri by default)
dawnping profile busy add default 14:00-17:00            # optional: your busiest stretch
dawnping plan                                            # when it will ping, and why
dawnping install                                         # run in the background
dawnping doctor                                          # check everything
```

`dawnping --help` lists every command. Settings live in `~/.config/dawnping/config.json`; `dawnping config list` shows them all.

The background job runs `dist/cli.js` from the cloned folder, so run `pnpm build` again after pulling changes. `dawnping uninstall` removes it.

## How it works

A launchd agent runs `dawnping` every 5 minutes. Most runs only check the time and exit. At the planned time it:

1. reads the last 24 hours of Claude Code's session logs and stops if a usage window is already running,
2. runs `claude -p --model haiku` with a one-line message from its own folder, so its log stays apart from your projects,
3. looks for the answer in the session log to confirm the window started,
4. retries a failed ping after 15, 30, 60 and 120 minutes, and notifies you on the first failure and when it gives up.

A ping costs a few seconds and almost none of your usage ([ADR-0003](docs/adr/0003-start-the-window-with-a-headless-haiku-ping.md)).

## Privacy

dawnping runs entirely on your Mac. It sends nothing anywhere itself; the only network traffic is the ping that the `claude` command sends to Anthropic.

From the session logs in `~/.claude/projects/` it looks only at lines that record a model answer, and from those it uses only the timestamp, the model name, whether the answer was a rejected request (`isApiErrorMessage`) and the project folder name. It does not keep or show the text of your conversations.

Its own files are the config (`~/.config/dawnping/`) and a small state file and run log (`~/.local/state/dawnping/`).

## Caveats

- dawnping does not give you more usage. Weekly limits still apply; it only distributes the 5-hour windows better across your day.
- It needs the subscription's 5-hour window. The ping always uses your Claude login, never an API key, and with API billing alone there is no window to move.
- When exactly the window starts is not officially documented. A measurement showed it starts at the ping itself, not rounded to the hour ([ADR-0003](docs/adr/0003-start-the-window-with-a-headless-haiku-ping.md)); the reset time Claude shows may differ by a few minutes.
- macOS only for now. Your Mac has to be awake and online at ping time. If it sleeps through it, dawnping pings on its first run after the Mac wakes, as long as your working day has not ended. A scheduled wake (`sudo pmset repeat wake MTWRF <time>`) helps; set it to the ping time or a minute after, not before. Whether a short wake with the lid closed is long enough for the ping is still being measured ([#31](https://github.com/sudeatesoglu/dawnping/issues/31)).

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
