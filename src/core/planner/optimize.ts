import { WINDOW_MS } from '../pinger.ts';
import { type DemandProfile, SLOT_MINUTES } from './demand.ts';

const WINDOW_SLOTS = WINDOW_MS / 60_000 / SLOT_MINUTES;

export interface PlannedWindow {
  /** Slot where the window starts (may be before the first active slot). */
  start: number;
  /** Slot where it resets. */
  end: number;
  /** Active slots inside the window. */
  activeSlots: number;
  /** Sum of the demand weights inside the window. */
  load: number;
}

export interface Plan {
  /** Slot of the ping. */
  trigger: number;
  /** Windows that touch active time, in order. */
  windows: PlannedWindow[];
}

/**
 * The windows a day gets if the first one starts at `trigger`.
 *
 * Realistic chaining: when a window resets, the next one starts with the
 * next activity (after a lunch break, for example), not at the reset
 * itself. A trigger after the first activity is too late: the user's own
 * first message starts the window then.
 */
export function simulate(demand: DemandProfile, trigger: number): Plan {
  const active = (slot: number) => (demand[slot] ?? 0) > 0;
  const firstActive = demand.findIndex((weight) => weight > 0);
  const windows: PlannedWindow[] = [];
  if (firstActive === -1) return { trigger, windows };

  // A window that would end before work starts is wasted: work starts a new one.
  let start =
    trigger > firstActive || trigger + WINDOW_SLOTS <= firstActive ? firstActive : trigger;
  while (start < demand.length) {
    const end = start + WINDOW_SLOTS;
    let load = 0;
    let activeSlots = 0;
    for (let slot = start; slot < Math.min(end, demand.length); slot++) {
      load += demand[slot] ?? 0;
      if (active(slot)) activeSlots += 1;
    }
    if (activeSlots > 0) windows.push({ start, end, activeSlots, load });
    let next = end;
    while (next < demand.length && !active(next)) next += 1;
    start = next;
  }
  return { trigger, windows };
}

/**
 * Lexicographic comparison of two plans; negative if `a` is better.
 *   1. more windows touching active time: each one is a fresh budget
 *   2. a lighter busiest window: the user is least likely to hit a limit
 *   3. a more even split (sum of squared loads)
 *   4. a later ping: closer to the day, less likely the Mac is asleep
 */
export function comparePlans(a: Plan, b: Plan): number {
  const peak = (p: Plan) => Math.max(0, ...p.windows.map((w) => w.load));
  const squares = (p: Plan) => p.windows.reduce((sum, w) => sum + w.load ** 2, 0);
  return (
    b.windows.length - a.windows.length ||
    compareLoads(peak(a), peak(b)) ||
    compareLoads(squares(a), squares(b)) ||
    b.trigger - a.trigger
  );
}

/**
 * Loads are sums of fractional weights, so equal loads can differ by a
 * rounding error; those must count as a tie, not decide the plan.
 */
function compareLoads(a: number, b: number): number {
  return Math.abs(a - b) < 1e-9 ? 0 : a - b;
}

/**
 * The best ping time for a day: every 5-minute slot in the five hours
 * before the first activity (not before midnight) is tried. Undefined on a
 * day without activity.
 */
export function optimizeTrigger(demand: DemandProfile): Plan | undefined {
  const firstActive = demand.findIndex((weight) => weight > 0);
  if (firstActive === -1) return undefined;
  let best: Plan | undefined;
  for (
    let trigger = Math.max(0, firstActive - WINDOW_SLOTS + 1);
    trigger <= firstActive;
    trigger++
  ) {
    const plan = simulate(demand, trigger);
    if (best === undefined || comparePlans(plan, best) < 0) best = plan;
  }
  return best;
}
