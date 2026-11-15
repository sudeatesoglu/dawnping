import type { Profile } from '../config/schema.ts';
import { parseWorkRange } from '../time.ts';

/** A day is split into slots of this many minutes. */
export const SLOT_MINUTES = 5;
export const SLOTS_PER_DAY = (24 * 60) / SLOT_MINUTES;

/** Weight of a busy range when neither the user nor the logs give one. */
export const DEFAULT_BUSY_WEIGHT = 2;

/**
 * How much the user works in each 5-minute slot of a day, relative to an
 * ordinary working slot (1). Zero means not working. The optimizer only
 * sees this array, so it works the same whether the profile is written
 * by hand or learned from the session logs.
 */
export type DemandProfile = readonly number[];

/** Slot index range [start, end) of an "HH:MM-HH:MM" range. */
function slots(range: string): { start: number; end: number } {
  const parsed = parseWorkRange(range);
  if (parsed === undefined) throw new Error(`Invalid range: ${range}`);
  return { start: parsed.start / SLOT_MINUTES, end: Math.ceil(parsed.end / SLOT_MINUTES) };
}

/** The demand profile a user describes with `work` and `busy` ranges. */
export function manualDemand(profile: Pick<Profile, 'work' | 'busy'>): DemandProfile {
  const demand = new Array<number>(SLOTS_PER_DAY).fill(0);
  const work = slots(profile.work);
  demand.fill(1, work.start, work.end);
  for (const busy of profile.busy ?? []) {
    const range = slots(busy.range);
    demand.fill(busy.weight ?? DEFAULT_BUSY_WEIGHT, range.start, range.end);
  }
  return demand;
}
