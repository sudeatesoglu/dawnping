# ADR-0005: Minimize the sum of squared window loads

- **Status:** Accepted
- **Date:** 2026-11-16
- **Supersedes:** the objective in [ADR-0004](0004-optimize-the-trigger-over-a-demand-profile.md). The demand profile, the simulation and the search from ADR-0004 stay.

## Context

ADR-0004 compared plans first by the number of windows that touch working time, on the idea that each window is a fresh budget. A real profile showed the flaw: a window with five minutes of work counts as a full window.

For work 10:00-18:00 with 14:00-17:00 busy (weight 2), the optimizer chose a 05:05 ping. The loads were 0.08 + 6.08 + 4.83. That is practically the same as not pinging, which gives 10:00-15:00 and 15:00-20:00 with 6 + 5. The criterion was met by a sliver that changes nothing for the user (#28).

## Decision

We will rank plans by the **work the user can do before hitting a window's limit, averaged over every possible limit**. This turns out to be the same as minimizing the sum of squared window loads.

**Usable work.** A window with load ℓ (hours × weight) and budget B gives `min(ℓ, B)`: all of the work if it fits, the budget if it does not. A day gives `Σ min(ℓᵢ, B)`.

**Unknown budget.** B is not published and differs by plan, and the best plan depends on it. For the day above, 05:45 beats 05:05 if B = 3 (6.75 against 6.08), and loses if B = 5 (9.25 against 9.91). So we average over every B from 0 to M, where M is at least the largest load:

```
average of min(ℓ, B) for B in [0, M]
  = ( ℓ²/2  +  ℓ·(M − ℓ) ) / M        triangle while B < ℓ, rectangle after
  = ℓ − ℓ² / (2M)

Σ over the windows  =  Σ ℓᵢ  −  Σ ℓᵢ² / (2M)
```

`Σ ℓᵢ` is the day's total work, which the ping time does not change. So **maximizing the average usable work is the same as minimizing Σ ℓᵢ²**, whatever M is.

Plans are compared by:

1. the lowest sum of squared loads,
2. then the lightest busiest window,
3. then the later ping.

**Why it behaves well.** Squares grow faster than the loads themselves, so an even split wins: 3.5 + 3.5 gives 24.5, while 6 + 1 gives 37. Spreading load over more meaningful windows lowers the sum too: 9 in one window gives 81, 3 + 3 + 3 gives 27. A sliver earns almost nothing: 0.08² ≈ 0.006. No separate window count is needed, and the criterion cannot be met by a sliver.

**Result for the motivating day:** 05:40, with loads of about 0.67 + 6.67 + 3.67 (sum of squares 58.3). For comparison: 05:05 gives 60.4 and no ping gives 61.0. The examples from ADR-0004 keep their answers: 10-18 → 06:30, 09-18 → 06:00, 12-17 → 09:30, 12-17 with 15-17 busy → 10:15, 10-15 → 07:30. A busy morning (10-12 weight 3 in 10-18) now gets 06:30 instead of 06:45.

## Alternatives considered

- **Keep the window count but ignore short windows** (for example under 30 minutes): it needs an arbitrary threshold, and a window just above it would still be overrated.
- **Assume one budget B and maximize Σ min(ℓᵢ, B):** the right objective once B is known, but a guessed B can be badly wrong. Learning B from the logs (#25) would make this possible.
- **Minimize the busiest window only:** it ignores the other windows. In the motivating day it also preferred the sliver.

## Consequences

- The objective has a meaning a user can be told: the most work on average before hitting a limit.
- "Every budget equally likely" is an assumption, not knowledge. If #25 learns when the user actually hits limits, the optimizer can maximize `Σ min(ℓᵢ, B)` with that B. The formula is the same function before averaging.
- The weights are assumed to scale with usage: weight 2 uses the budget twice as fast. Learned profiles can refine this.
