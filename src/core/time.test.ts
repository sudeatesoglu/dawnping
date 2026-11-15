import { describe, expect, it } from 'vitest';
import { isIsoDate, isValidTimeZone, parseTime, parseWorkRange, toLocalTime } from './time.ts';

describe('parseTime', () => {
  it.each([
    ['00:00', 0],
    ['07:30', 450],
    ['23:59', 1439],
  ])('parses %s', (value, minutes) => {
    expect(parseTime(value)).toBe(minutes);
  });

  it.each(['24:00', '7:30', '07:60', '0730', '', ' 07:30'])('rejects %j', (value) => {
    expect(parseTime(value)).toBeUndefined();
  });
});

describe('parseWorkRange', () => {
  it('parses a range', () => {
    expect(parseWorkRange('09:00-18:00')).toEqual({ start: 540, end: 1080 });
  });

  it.each(['18:00-09:00', '09:00-09:00', '09:00', '09:00-18:00-20:00', '9-18'])(
    'rejects %j',
    (value) => {
      expect(parseWorkRange(value)).toBeUndefined();
    },
  );
});

describe('isIsoDate', () => {
  it('accepts real dates, including leap days', () => {
    expect(isIsoDate('2026-12-31')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
  });

  it.each(['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-01', '31.12.2026', ''])(
    'rejects %j',
    (value) => {
      expect(isIsoDate(value)).toBe(false);
    },
  );
});

describe('isValidTimeZone', () => {
  it.each(['Europe/Istanbul', 'America/Argentina/Buenos_Aires', 'Etc/GMT+3', 'UTC'])(
    'accepts %s',
    (value) => {
      expect(isValidTimeZone(value)).toBe(true);
    },
  );

  // Offsets and abbreviations have no daylight saving rules.
  it.each(['Mars/Olympus', '+03:00', 'EST', 'europe/istanbul', ''])('rejects %j', (value) => {
    expect(isValidTimeZone(value)).toBe(false);
  });
});

describe('toLocalTime', () => {
  it('uses the given time zone, not UTC', () => {
    // Sunday 22:30 in UTC is already Monday 01:30 in Istanbul (UTC+3).
    const instant = Date.parse('2026-11-15T22:30:00Z');
    expect(toLocalTime(instant, 'UTC')).toEqual({
      date: '2026-11-15',
      weekday: 'sun',
      minutes: 22 * 60 + 30,
    });
    expect(toLocalTime(instant, 'Europe/Istanbul')).toEqual({
      date: '2026-11-16',
      weekday: 'mon',
      minutes: 90,
    });
  });

  it('follows daylight saving changes', () => {
    // Berlin switches from UTC+1 to UTC+2 on 2026-03-29 at 01:00 UTC.
    expect(toLocalTime(Date.parse('2026-03-29T00:30:00Z'), 'Europe/Berlin').minutes).toBe(90);
    expect(toLocalTime(Date.parse('2026-03-29T01:30:00Z'), 'Europe/Berlin').minutes).toBe(210);
  });

  it('reports midnight as 0 minutes', () => {
    expect(toLocalTime(Date.parse('2026-11-16T00:00:00Z'), 'UTC').minutes).toBe(0);
  });
});
