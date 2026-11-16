import { profileFor } from './config/resolve.ts';
import type { Config, Profile } from './config/schema.ts';
import { SLOT_MINUTES } from './planner/demand.ts';
import { planProfileDay } from './planner/plan-day.ts';
import { addDays } from './skip.ts';
import { type Weekday, weekdayOf } from './time.ts';

export interface PlannedPing {
  date: string;
  weekday: Weekday;
  /** Minutes after local midnight. */
  minutes: number;
}

/**
 * The ping time a profile's plan uses, or undefined if it never pings: a
 * fixed trigger after work starts (or 5+ hours before) has no effect, and
 * tick waits instead (decideTick).
 */
export function profilePingTime(profile: Profile): number | undefined {
  const { plan, mode } = planProfileDay(profile);
  const first = plan.windows[0];
  if (mode === 'fixed' && first !== undefined && first.start !== plan.trigger) return undefined;
  return plan.trigger * SLOT_MINUTES;
}

/**
 * The first planned ping on a day after `today`, within a week. Today is
 * left to decideTick, which also handles late and retried pings.
 */
export function nextPlannedPing(config: Config, today: string): PlannedPing | undefined {
  for (let offset = 1; offset <= 7; offset++) {
    // Calendar arithmetic: no daylight saving shift can skip or repeat a day.
    const date = addDays(today, offset);
    if (config.skip.includes(date)) continue;
    const weekday = weekdayOf(date);
    const profile = profileFor(config, weekday);
    const minutes = profile === undefined ? undefined : profilePingTime(profile);
    if (minutes !== undefined) return { date, weekday, minutes };
  }
  return undefined;
}

/** Every profile that pings, with its ping time and days. */
export function pingTimes(config: Config): { name: string; minutes: number; days: Weekday[] }[] {
  return Object.entries(config.profiles).flatMap(([name, profile]) => {
    const minutes = profilePingTime(profile);
    return minutes === undefined ? [] : [{ name, minutes, days: profile.days }];
  });
}
