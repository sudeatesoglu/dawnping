import { describe, expect, it } from 'vitest';
import type { Config } from './config/schema.ts';
import { earliestPing, nextPing } from './next-ping.ts';

const config: Config = {
  version: 1,
  ping: { model: 'haiku' },
  profiles: {
    default: { days: ['mon', 'tue', 'wed', 'thu'], work: '10:00-18:00', trigger: 'auto' },
    friday: { days: ['fri'], work: '09:00-12:00', trigger: '06:00' },
  },
  skip: ['2026-11-17'],
};
const at = (iso: string) => Date.parse(`${iso}+03:00`);
const IST = 'Europe/Istanbul';

describe('nextPing', () => {
  it("returns today's ping while it is still ahead", () => {
    expect(nextPing(config, at('2026-11-16T05:00:00'), IST)).toEqual({
      date: '2026-11-16',
      weekday: 'mon',
      minutes: 6 * 60 + 30,
    });
  });

  it('moves on past a done ping, skipped dates and rest days', () => {
    // Monday afternoon → Tuesday is skipped → Wednesday.
    expect(nextPing(config, at('2026-11-16T15:00:00'), IST)?.date).toBe('2026-11-18');
    // Friday afternoon → weekend → Monday.
    expect(nextPing(config, at('2026-11-20T15:00:00'), IST)?.date).toBe('2026-11-23');
  });

  it('has nothing to plan without profiles', () => {
    expect(nextPing({ ...config, profiles: {} }, at('2026-11-16T05:00:00'), IST)).toBeUndefined();
  });
});

describe('earliestPing', () => {
  it('takes the earliest ping over all profiles', () => {
    expect(earliestPing(config)).toBe(6 * 60);
    expect(earliestPing({ ...config, profiles: {} })).toBeUndefined();
  });
});
