import { type LocalTime, toLocalTime } from '../time.ts';
import type { Config, Profile } from './schema.ts';

export interface Day extends LocalTime {
  /** The profile that owns this weekday, or undefined on a rest day. */
  profile: (Profile & { name: string }) | undefined;
  /** True if the date is in the skip list. */
  skipped: boolean;
}

/**
 * Resolves what a given instant means for the user: which local day it is,
 * which profile applies and whether the day is skipped.
 *
 * Pure: the instant and the time zone are passed in, never read from the
 * system, so tests can pin any moment (a DST change, midnight in another
 * time zone).
 */
export function resolveDay(config: Config, instant: number, timeZone: string): Day {
  const local = toLocalTime(instant, timeZone);
  const entry = Object.entries(config.profiles).find(([, profile]) =>
    profile.days.includes(local.weekday),
  );
  return {
    ...local,
    profile: entry === undefined ? undefined : { name: entry[0], ...entry[1] },
    skipped: config.skip.includes(local.date),
  };
}
