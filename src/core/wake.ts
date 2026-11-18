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

/**
 * How long after a ping time a wake still counts as "in time". The wake
 * has to come at or after the ping time, never before: after a scheduled
 * wake that nobody uses, macOS sleeps again within a minute, so a tick
 * started by an early wake would only wait for the ping time and miss it.
 */
export const WAKE_WINDOW_MINUTES = 30;

const DAY_MINUTES = 24 * 60;

const shiftDay = (day: Weekday, by: number): Weekday =>
  WEEKDAYS[(WEEKDAYS.indexOf(day) + by + WEEKDAYS.length) % WEEKDAYS.length] ?? day;

/**
 * The repeating wake that brings the Mac up shortly after a ping time on a
 * weekday, if any. A wake just after midnight covers a ping just before
 * it (on the next day of the week). Wakes whose days could not be read
 * never count: dawnping cannot tell whether they fire that day.
 */
export function coveringWake(
  wakes: readonly RepeatingWake[],
  weekday: Weekday,
  ping: number,
): RepeatingWake | undefined {
  return wakes.find((wake) => {
    if (wake.days === 'unknown') return false;
    const crossesMidnight = wake.minutes < ping;
    const delay = crossesMidnight ? wake.minutes + DAY_MINUTES - ping : wake.minutes - ping;
    const day = crossesMidnight ? shiftDay(weekday, 1) : weekday;
    return delay <= WAKE_WINDOW_MINUTES && wake.days.includes(day);
  });
}

/**
 * Wake this long after the ping time. launchd runs the tick it missed
 * during sleep as soon as the Mac wakes, and by then the ping is due.
 */
export const WAKE_DELAY_MINUTES = 2;

const PMSET_LETTERS: Record<Weekday, string> = {
  mon: 'M',
  tue: 'T',
  wed: 'W',
  thu: 'R',
  fri: 'F',
  sat: 'S',
  sun: 'U',
};

/**
 * The `pmset repeat` command that wakes the Mac just after a ping time.
 * It uses `wake`, not `wakeorpoweron`: a Mac that was shut down would
 * start up to the login screen (with FileVault, before any user agent
 * can run), so powering on would only surprise the user.
 */
export function wakeCommand(ping: number, days: readonly Weekday[]): string {
  const at = ping + WAKE_DELAY_MINUTES;
  // A wake after midnight belongs to the next day of the week.
  const shift = at >= DAY_MINUTES ? 1 : 0;
  const wakeDays = new Set(days.map((day) => shiftDay(day, shift)));
  const letters = WEEKDAYS.filter((day) => wakeDays.has(day))
    .map((day) => PMSET_LETTERS[day])
    .join('');
  return `sudo pmset repeat wake ${letters} ${formatTime(at % DAY_MINUTES)}:00`;
}
