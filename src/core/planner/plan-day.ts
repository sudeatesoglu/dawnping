import type { Profile } from '../config/schema.ts';
import { parseTime } from '../time.ts';
import { manualDemand, SLOT_MINUTES } from './demand.ts';
import { optimizeTrigger, type Plan, simulate } from './optimize.ts';

export interface DayPlan {
  /** The plan that will run: the optimized one, or the fixed trigger's. */
  plan: Plan;
  /** What `auto` would choose, to compare with a fixed trigger. */
  auto: Plan;
  mode: 'auto' | 'fixed';
}

/** The ping plan for a profile's working day. */
export function planProfileDay(profile: Profile): DayPlan {
  const demand = manualDemand(profile);
  const auto = optimizeTrigger(demand);
  // A valid profile always has working time, so there is always a plan.
  if (auto === undefined) throw new Error('Profile without working time');
  if (profile.trigger === 'auto') return { plan: auto, auto, mode: 'auto' };
  const minutes = parseTime(profile.trigger);
  if (minutes === undefined) throw new Error(`Invalid trigger: ${profile.trigger}`);
  return { plan: simulate(demand, Math.floor(minutes / SLOT_MINUTES)), auto, mode: 'fixed' };
}
