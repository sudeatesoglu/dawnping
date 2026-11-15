# ADR-0003: Start the usage window with a headless Haiku ping

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

dawnping exists to start the Claude Code 5-hour usage window at a chosen time. How the window behaves is not officially documented, so before building the pinger, the planner and the log reader we measured four things (spike #3):

1. Does a headless `claude -p` call start the subscription's 5-hour window?
2. Is the window anchored to the exact time of the first message, or rounded down to the hour?
3. Does a headless call write to the session logs under `~/.claude/projects`, and where?
4. How much of the budget does a minimal ping use?

**Method.** Right after a window had reset, with no other Claude usage in between, one message was sent from an empty temporary directory:

```
claude -p --model haiku "Reply with the single word: ok"
```

The reset time and usage were then read from the usage screen, and the new session log entries were summarized (timestamps, model and token counts only).

**Measurements** (Claude Code 2.1.325, macOS, one run):

| Question | Observation |
| --- | --- |
| Starts the window | Ping at 19:32:13 local time. The usage screen showed a new current session that resets at 00:30, five hours after the ping. |
| Anchor | Not rounded down to the hour (that would show 00:00). The displayed reset was 2 minutes before ping + 5 h, so the window or the display has a granularity of a few minutes. |
| Session logs | One new `.jsonl` file under `~/.claude/projects/<folder>/`, where the folder name is the working directory's real path with `/`, `_` and `.` replaced by `-`. One entry with model `claude-haiku-5-5`, finished 2 s after the start. |
| Cost | About 24.5k tokens, almost all of them Claude Code's own system prompt (written to and read from the prompt cache), 4 output tokens. The usage screen showed 0% used. |

## Decision

- **Ping with `claude -p --model haiku` and a one-word prompt.** It counts against the subscription, starts the window, and its cost does not show up in the usage percentage.
- **Treat the window as starting at the ping.** The planner computes the reset as ping time + 5 hours and allows a few minutes of slack, because the exact granularity is not known yet.
- **Always ping from one fixed, empty working directory**, `<state dir>/ping`, instead of a new temporary directory each time:
  - every ping's log lands in the same known `~/.claude/projects` folder, so verification (#8) looks in one place;
  - the log analysis (v0.2) can exclude dawnping's own pings from the user's work pattern;
  - no new project folder is created per ping.
- **Read only timestamps, model and token counts** from session logs, never message content.

## Alternatives considered

- **Assume the hour-rounded anchor that some community tools describe:** contradicted by the measurement.
- **Ping with the default model:** works too, but Haiku is the cheapest model and the reply is irrelevant.
- **Ping through the API with an API key:** uses separate API billing and does not start the subscription window at all.
- **A new temporary directory per ping:** what the spike did. It leaves one project folder per ping and mixes pings into the user's logs.

## Consequences

- If a Claude Code release changes how headless calls are billed or logged, dawnping breaks silently. `doctor` (#12) and ping verification (#8) must detect a ping that did not land in the logs.
- The few-minute slack is a guess from one run. A second measurement at a different minute (follow-up issue) will pin down the granularity.
- The folder-name rule is observed, not documented. The log reader should locate the ping folder by that rule and fall back to scanning for the newest entry if it changes.
