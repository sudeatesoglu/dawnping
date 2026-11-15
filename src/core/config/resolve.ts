import { isValidTimeZone, type LocalTime, toLocalTime, type Weekday } from '../time.ts';
import type { Config, Profile } from './schema.ts';

export type NamedProfile = Profile & { name: string };

export interface Day extends LocalTime {
  /** The profile that owns this weekday, or undefined on a rest day. */
  profile: NamedProfile | undefined;
  /** True if the date is in the skip list. */
  skipped: boolean;
}

/** The profile that owns a weekday, or undefined on a rest day. */
export function profileFor(config: Config, weekday: Weekday): NamedProfile | undefined {
  const entry = Object.entries(config.profiles).find(([, profile]) =>
    profile.days.includes(weekday),
  );
  return entry === undefined ? undefined : { name: entry[0], ...entry[1] };
}

/**
 * The time zone dawnping works in: the configured one, else the system's
 * if it is a proper IANA zone. Undefined means neither is usable and the
 * user has to set one.
 */
export function effectiveTimeZone(config: Config, systemTimeZone: string): string | undefined {
  if (config.timezone !== undefined) return config.timezone;
  return isValidTimeZone(systemTimeZone) ? systemTimeZone : undefined;
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
  return {
    ...local,
    profile: profileFor(config, local.weekday),
    skipped: config.skip.includes(local.date),
  };
}
