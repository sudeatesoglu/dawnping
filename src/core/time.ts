export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "07:30" → minutes after midnight (450), or undefined if invalid. */
export function parseTime(value: string): number | undefined {
  const match = TIME.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** "09:00-18:00" → start and end in minutes, or undefined if invalid. */
export function parseWorkRange(value: string): { start: number; end: number } | undefined {
  const [from, to, ...rest] = value.split('-');
  if (from === undefined || to === undefined || rest.length > 0) return undefined;
  const start = parseTime(from);
  const end = parseTime(to);
  if (start === undefined || end === undefined || end <= start) return undefined;
  return { start, end };
}

/** True for a real calendar date in the form YYYY-MM-DD (rejects 2026-02-30). */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * True for an IANA zone name such as Europe/Istanbul, or UTC.
 *
 * Intl also accepts offsets ("+03:00"), abbreviations ("EST") and
 * lowercase names. Offsets and most abbreviations have no daylight saving
 * rules, so they would put work hours off by an hour for half the year.
 */
export function isValidTimeZone(value: string): boolean {
  if (value !== 'UTC' && !/^[A-Z][A-Za-z_-]*(\/[A-Za-z0-9_+-]+)+$/.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The calendar view of an instant in a given time zone. */
export interface LocalTime {
  /** YYYY-MM-DD */
  date: string;
  weekday: Weekday;
  /** Minutes after local midnight. */
  minutes: number;
}

const WEEKDAY_BY_SHORT_NAME: Record<string, Weekday> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
};

/** Converts an instant (epoch ms) to the local date, weekday and time of day. */
export function toLocalTime(instant: number, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instant));

  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) throw new Error(`Missing ${type} in formatted date`);
    return part.value;
  };

  const weekday = WEEKDAY_BY_SHORT_NAME[get('weekday')];
  if (weekday === undefined) throw new Error(`Unknown weekday ${get('weekday')}`);

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}
