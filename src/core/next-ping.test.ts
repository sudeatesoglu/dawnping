import { describe, expect, it } from 'vitest';
import type { Config } from './config/schema.ts';
import { nextPlannedPing, pingTimes, profilePingTime } from './next-ping.ts';

const config: Config = {
  version: 1,
  ping: { model: 'haiku' },
  profiles: {
    default: { days: ['mon', 'tue', 'wed', 'thu'], work: '10:00-18:00', trigger: 'auto' },
    friday: { days: ['fri'], work: '09:00-12:00', trigger: '06:00' },
  },
  skip: ['2026-11-17'],
};

describe('profilePingTime', () => {
  it('is the auto or fixed ping time', () => {
    expect(profilePingTime({ days: ['mon'], work: '10:00-18:00', trigger: 'auto' })).toBe(390);
    expect(profilePingTime({ days: ['mon'], work: '10:00-18:00', trigger: '07:00' })).toBe(420);
  });

  it('is undefined for a fixed trigger that has no effect', () => {
    expect(
      profilePingTime({ days: ['mon'], work: '10:00-18:00', trigger: '11:00' }),
    ).toBeUndefined();
  });
});

describe('nextPlannedPing', () => {
  it('starts with the day after today and skips skipped dates and rest days', () => {
    // From Monday: Tuesday is skipped → Wednesday.
    expect(nextPlannedPing(config, '2026-11-16')).toEqual({
      date: '2026-11-18',
      weekday: 'wed',
      minutes: 390,
    });
    // From Friday: the weekend has no profile → Monday.
    expect(nextPlannedPing(config, '2026-11-20')?.date).toBe('2026-11-23');
  });

  it('has nothing to plan without pinging profiles', () => {
    expect(nextPlannedPing({ ...config, profiles: {} }, '2026-11-16')).toBeUndefined();
  });
});

describe('pingTimes', () => {
  it('lists the profiles that ping, with their time and days', () => {
    expect(pingTimes(config)).toEqual([
      { name: 'default', minutes: 390, days: ['mon', 'tue', 'wed', 'thu'] },
      { name: 'friday', minutes: 360, days: ['fri'] },
    ]);
  });
});
