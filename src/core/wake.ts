import { formatTime, WEEKDAYS, type Weekday } from './time.ts';

/** A repeating wake set with `pmset repeat`, as `pmset -g sched` lists it. */
export interface RepeatingWake {
  /** Minutes after midnight. */
  minutes: number;
  /** The days it repeats on, or "unknown" if the listing could not be read. */
  days: readonly Weekday[] | 'unknown';
}

const DAY_WORDS: [RegExp, readonly Weekday[]][] = [
  [/every ?day/i, WEEKDAYS],
  [/weekdays/i, ['mon', 'tue', 'wed', 'thu', 'fri']],
  [/weekends/i, ['sat', 'sun']],
];

/**
 * Reads the repeating wake events from `pmset -g sched`. One-time events
 * (often scheduled by macOS itself) are ignored. The exact wording of the
 * day list is not documented, so days that cannot be read are "unknown"
 * rather than guessed.
 */
export function parseRepeatingWakes(text: string): RepeatingWake[] {
  const section = /Repeating power events:\n((?:[ \t]+.*\n?)*)/i.exec(text)?.[1] ?? '';
  const wakes: RepeatingWake[] = [];
  for (const line of section.split('\n')) {
    const match = /\bwake\w*\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(line);
    if (!match) continue;
    let hours = Number(match[1]) % 12;
    if (match[3] === undefined) hours = Number(match[1]);
    else if (match[3].toUpperCase() === 'PM') hours += 12;
    const days = DAY_WORDS.find(([pattern]) => pattern.test(line))?.[1] ?? 'unknown';
    wakes.push({ minutes: hours * 60 + Number(match[2]), days });
  }
  return wakes;
}

/** How long before a ping a wake still counts as "in time". */
export const WAKE_WINDOW_MINUTES = 30;

/** True if a repeating wake brings the Mac up shortly before the ping. */
export function wakeCovers(
  wakes: readonly RepeatingWake[],
  weekday: Weekday,
  ping: number,
): boolean {
  return wakes.some(
    (wake) =>
      (wake.days === 'unknown' || wake.days.includes(weekday)) &&
      wake.minutes <= ping &&
      wake.minutes >= ping - WAKE_WINDOW_MINUTES,
  );
}

/**
 * Wake this long before the ping. Short on purpose: macOS can go back to
 * sleep soon after a scheduled wake if nobody uses the Mac.
 */
export const WAKE_LEAD_MINUTES = 2;

const PMSET_LETTERS: Record<Weekday, string> = {
  mon: 'M',
  tue: 'T',
  wed: 'W',
  thu: 'R',
  fri: 'F',
  sat: 'S',
  sun: 'U',
};

/** The `pmset repeat` command that wakes the Mac before the earliest ping. */
export function wakeCommand(earliestPing: number, days: readonly Weekday[]): string {
  const letters = WEEKDAYS.filter((day) => days.includes(day))
    .map((day) => PMSET_LETTERS[day])
    .join('');
  const at = formatTime(Math.max(0, earliestPing - WAKE_LEAD_MINUTES));
  return `sudo pmset repeat wakeorpoweron ${letters} ${at}:00`;
}
