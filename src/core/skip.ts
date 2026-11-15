import { isIsoDate } from './time.ts';

/** Longest range `skip --until` accepts, to catch typos like 2062. */
export const MAX_SKIP_RANGE_DAYS = 366;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Adds days to a YYYY-MM-DD date (calendar arithmetic, no time zones). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** "today", "tomorrow" or YYYY-MM-DD → a date, relative to `today`. */
export function resolveDateArg(arg: string, today: string): string | undefined {
  const value = arg.trim().toLowerCase();
  if (value === 'today') return today;
  if (value === 'tomorrow') return addDays(today, 1);
  return isIsoDate(value) ? value : undefined;
}

/** How many dates `dateRange(from, to)` holds, without building it. */
export function rangeLength(from: string, to: string): number {
  return Math.max(
    0,
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1,
  );
}

/** Every date from `from` to `to`, both included. */
export function dateRange(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: rangeLength(from, to) }, (_, i) =>
    new Date(start + i * DAY_MS).toISOString().slice(0, 10),
  );
}

/**
 * The skip list after adding dates: sorted, without duplicates and without
 * dates before `today`, which can never matter again (including past dates
 * written by hand).
 */
export function withSkips(
  current: readonly string[],
  dates: readonly string[],
  today: string,
): string[] {
  return [...new Set([...current, ...dates])].filter((date) => date >= today).sort();
}

/** The skip list without `date`, also dropping past dates. */
export function withoutSkip(current: readonly string[], date: string, today: string): string[] {
  return current.filter((d) => d !== date && d >= today);
}
