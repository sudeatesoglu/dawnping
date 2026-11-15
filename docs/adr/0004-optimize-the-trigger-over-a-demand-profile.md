# ADR-0004: Optimize the trigger time over a demand profile

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

A usage window lasts five hours from the first message (ADR-0003). Each new window is a fresh budget, so the value of the morning ping is in where it puts the resets relative to the user's working day.

A closed formula ("ping so the first and last parts of the day are equal") was considered first. It breaks down on real days:

- For a short day, such as 12:00-17:00, it suggested not pinging, because the day fits into one window. Yet a ping at 09:30 gives the same day two fresh windows of 2.5 hours each.
- It cannot take into account that some hours are busier than others, or that a lunch break delays the next window until work resumes.

## Decision

We will choose the trigger time with a small, exhaustive optimization over a **demand profile**.

**Demand profile.** A day is 288 slots of 5 minutes. Each slot has a relative activity weight: 0 for not working, 1 for an ordinary working stretch, more for busier stretches. A busy range with weight 0 marks a break, such as lunch. Busy ranges may not overlap. Times that feed the planner use 5-minute steps, so plans are never off by rounding. The optimizer does not know where the profile comes from. Today it is built from the user's `work` range and optional `busy` ranges with weights. Later it can be learned from the session logs (#25), with values the user sets explicitly taking precedence.

**Simulation.** For a candidate trigger T, the day's windows are chained realistically:

- A ping after the first activity is too late: the user's own first message starts the window.
- A ping more than five hours before work starts is wasted: the window ends before work.
- After a reset, the next window starts with the next activity, not at the reset. A lunch break delays it.

**Search.** Every 5-minute slot in the five hours before the first activity is tried, but never before midnight. That is at most 60 simulations, so no heuristic is needed.

**Objective**, compared lexicographically:

1. The number of windows that touch working time. Each one is a fresh budget, and nothing else matters as much.
2. The load of the busiest window, which is the sum of its weights. A lower value means the user is less likely to hit a limit.
3. The sum of squared loads, so the split is more even.
4. The later ping wins a tie: it is closer to the day and less likely to fall while the Mac sleeps.

**Transparency.** `dawnping plan [day]` prints the chosen ping and every window with its share of the day's load. For a fixed trigger, it also shows what `auto` would choose.

## Alternatives considered

- **A closed formula:** simple, but wrong for short days and blind to busy stretches and breaks.
- **A weighted sum of the criteria:** needs weights that are hard to justify. The lexicographic order states the priorities directly: more budgets first, then a lighter peak.
- **Maximizing the expected usable budget with a model of the limit:** the size of a window's budget is not published and varies by plan, so such a model would rest on guesses.
- **An earliest allowed ping time:** it only lowers the chance that the Mac is asleep and does not solve it. Running while the Mac sleeps is a separate problem.

## Consequences

- The optimizer is a pure function of an array, tested with plain values. Learned profiles plug in without changing it.
- Results can surprise intuition. For a busy morning (10:00-12:00 weighted 3 in a 10:00-18:00 day), the best ping is 06:45, not 06:30, because the first reset then splits the busy stretch between two windows. `plan` exists to make such choices visible.
- Weights are relative activity, not tokens. Whether learned weights use answers or tokens per slot is decided in #25.
