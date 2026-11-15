import { describe, expect, it } from 'vitest';
import { effectiveTimeZone, profileFor, resolveDay } from './resolve.ts';
import type { Config } from './schema.ts';

const config: Config = {
  version: 1,
  ping: { model: 'haiku' },
  profiles: {
    default: { days: ['mon', 'tue', 'wed', 'thu'], work: '10:00-18:00', trigger: 'auto' },
    friday: { days: ['fri'], work: '10:00-15:00', trigger: '07:00' },
  },
  skip: ['2026-12-31'],
};

const IST = 'Europe/Istanbul';

describe('profileFor', () => {
  it('finds the owner of a weekday', () => {
    expect(profileFor(config, 'fri')?.name).toBe('friday');
    expect(profileFor(config, 'sun')).toBeUndefined();
  });
});

describe('effectiveTimeZone', () => {
  it('prefers the configured zone, then a usable system zone', () => {
    expect(effectiveTimeZone({ ...config, timezone: 'UTC' }, 'Europe/Berlin')).toBe('UTC');
    expect(effectiveTimeZone(config, 'Europe/Berlin')).toBe('Europe/Berlin');
    expect(effectiveTimeZone(config, 'Etc/Unknown')).toBeUndefined();
    expect(effectiveTimeZone(config, '+03:00')).toBeUndefined();
  });
});

describe('resolveDay', () => {
  it('picks the profile that owns the local weekday', () => {
    // Friday 2026-11-20, 08:00 in Istanbul.
    const day = resolveDay(config, Date.parse('2026-11-20T05:00:00Z'), IST);
    expect(day).toMatchObject({ date: '2026-11-20', weekday: 'fri', skipped: false });
    expect(day.profile).toEqual({ name: 'friday', ...config.profiles['friday'] });
  });

  it('uses the local date, not the UTC date', () => {
    // Thursday 22:30 UTC is already Friday 01:30 in Istanbul.
    expect(resolveDay(config, Date.parse('2026-11-19T22:30:00Z'), IST).profile?.name).toBe(
      'friday',
    );
  });

  it('returns no profile on a day no profile covers', () => {
    // Saturday.
    const day = resolveDay(config, Date.parse('2026-11-21T09:00:00Z'), IST);
    expect(day.weekday).toBe('sat');
    expect(day.profile).toBeUndefined();
  });

  it('marks skipped dates', () => {
    // Thursday 2026-12-31 is in the skip list.
    const day = resolveDay(config, Date.parse('2026-12-31T09:00:00Z'), IST);
    expect(day).toMatchObject({ weekday: 'thu', skipped: true });
    expect(day.profile?.name).toBe('default');
  });
});
