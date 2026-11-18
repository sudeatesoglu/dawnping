# ADR-0006: Run the agent on the wall clock and wake the Mac after the ping time

- **Status:** Accepted
- **Date:** 2026-11-18

## Context

The background agent has to run at the ping time, often early in the morning while the Mac sleeps with its lid closed. Until now it ran with launchd's `StartInterval` (every 300 seconds), and `doctor` suggested a scheduled wake (`pmset repeat`) two minutes *before* the ping.

Three mornings on a MacBook (Apple silicon, macOS 26, on battery, lid closed, `sleep 1` in `pmset -g`) showed that this does not work:

| Morning | What happened |
| --- | --- |
| 1 | No scheduled wake. The agent ran a few times overnight at irregular times (02:27, 05:25 local) and next when the user opened the lid. |
| 2 | No scheduled wake. One agent run at 04:14 during a 2-second maintenance wake, the next one 1.5 minutes after the lid was opened at 08:19. |
| 3 | Scheduled wake at 05:42. macOS woke for 45 seconds without turning on the display, and the agent **did not run**. It ran at 07:46 during an unrelated 45-second wake (a USB-C event) and the ping finished and was confirmed in the session log about 6 seconds later. |

Two conclusions:

1. `StartInterval` counts only the time the Mac is awake. Overnight the Mac wakes for a few seconds every quarter hour, so a 5-minute interval fills up slowly and runs land at random wall-clock times. It does not run "as soon as the Mac wakes".
2. A 45-second wake with the lid closed is long enough for a ping: the network is up and the ping takes a few seconds.

launchd documents that a `StartCalendarInterval` run missed during sleep is started when the Mac next wakes, with several missed runs merged into one.

## Decision

We will run the agent with `StartCalendarInterval` at every fifth minute of every hour (:00, :05, … :55) instead of `StartInterval`. It still runs every 5 minutes while the Mac is awake, and after any sleep longer than 5 minutes it runs right after waking.

We will suggest a scheduled wake **2 minutes after** the ping time (`pmset repeat wake`), not before it. A tick that runs before the ping time only waits, and the Mac sleeps again before the ping is due. The suggested command uses `wake`, not `wakeorpoweron`: a Mac that was shut down would start up to the login screen (with FileVault, before any user agent can run), so powering it on cannot help.

We will run every tick under `caffeinate -i`, so a Mac that is fully awake but idle does not go to sleep in the middle of a ping.

## Alternatives considered

- **One `StartCalendarInterval` entry per ping time:** the ping time comes from the config, so every config change would need a reinstall of the agent, and a forgotten reinstall would silently keep the old time. Running every 5 minutes on the wall clock needs no change when the config changes.
- **Keep `StartInterval` and add calendar entries:** the interval adds nothing once the calendar entries cover every 5 minutes.
- **Wake shortly before the ping and keep the Mac awake until then:** `caffeinate -i` does not keep a wake that nobody uses (a "dark wake") going. The power log of morning 3 shows an app holding the same kind of assertion for 32 minutes while the Mac went to sleep several times.

## Consequences

- The agent also runs after the short maintenance wakes during the night. Such a run only reads the config and exits; if it is suspended mid-way, it continues at the next wake.
- Users who installed an earlier version must run `dawnping install` again to get the new agent definition.
- Whether launchd starts the missed calendar run during a 45-second wake with the lid closed is documented but not yet measured. It is checked on a real Mac before #31 is closed, and the result is added here.
- pmset allows one repeating wake, so with several profiles only one ping time can be covered; `doctor` suggests the time used on the most days.
