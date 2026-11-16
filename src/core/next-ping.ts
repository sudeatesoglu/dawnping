import { profileFor } from './config/resolve.ts';
import type { Config } from './config/schema.ts';
import { SLOT_MINUTES } from './planner/demand.ts';
import { planProfileDay } from './planner/plan-day.ts';
import { addDays } from './skip.ts';
import { toLocalTime, type Weekday, weekdayOf } from './time.ts';

export interface PlannedPing {
  date: string;
  weekday: Weekday;
  /** Minutes after local midnight. */
  minutes: number;
}

/**
 * The next planned ping within a week: today's if it is still ahead,
 * otherwise the next working day that is not skipped. Undefined if no
 * day in the coming week has one.
 */
export function nextPing(config: Config, now: number, timeZone: string): PlannedPing | undefined {
  const today = toLocalTime(now, timeZone);
  for (let offset = 0; offset <= 7; offset++) {
    // Calendar arithmetic: no daylight saving shift can skip or repeat a day.
    const date = addDays(today.date, offset);
    if (config.skip.includes(date)) continue;
    const weekday = weekdayOf(date);
    const profile = profileFor(config, weekday);
    if (profile === undefined) continue;
    const minutes = planProfileDay(profile).plan.trigger * SLOT_MINUTES;
    if (offset === 0 && today.minutes >= minutes) continue;
    return { date, weekday, minutes };
  }
  return undefined;
}

/** The earliest ping time over all profiles, for one repeating wake. */
export function earliestPing(config: Config): number | undefined {
  const times = Object.values(config.profiles).map(
    (profile) => planProfileDay(profile).plan.trigger * SLOT_MINUTES,
  );
  return times.length === 0 ? undefined : Math.min(...times);
}
