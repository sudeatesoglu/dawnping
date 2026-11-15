import { describe, expect, it } from 'vitest';
import type { Config } from '../config/schema.ts';
import { WINDOW_MS } from '../pinger.ts';
import { EMPTY_STATE, type State } from '../state.ts';
import { activeWindowEnd, decideTick, MAX_ATTEMPTS_PER_DAY } from './tick.ts';

const HOUR = 60 * 60 * 1000;
const IST = 'Europe/Istanbul';

const config: Config = {
  version: 1,
  ping: { model: 'haiku' },
  // auto → 06:30 for 10:00-18:00 (ADR-0004).
  profiles: {
    default: { days: ['mon', 'tue', 'wed', 'thu', 'fri'], work: '10:00-18:00', trigger: 'auto' },
  },
  skip: ['2026-12-31'],
};

/** Monday 2026-11-16 at a local Istanbul time (UTC+3). */
const monday = (time: string) => Date.parse(`2026-11-16T${time}:00+03:00`);

const ping = (outcome: NonNullable<State['lastPing']>['outcome'], attempts = 1): State => ({
  version: 1,
  lastPing: { date: '2026-11-16', at: monday('06:30'), outcome, attempts },
});

function decide(now: number, overrides: Partial<Parameters<typeof decideTick>[0]> = {}) {
  return decideTick({
    config,
    now,
    timeZone: IST,
    state: EMPTY_STATE,
    activeWindowEnd: undefined,
    ...overrides,
  });
}

describe('activeWindowEnd', () => {
  const t0 = monday('06:00');

  it('rebuilds the window chain from answers', () => {
    // 06:00 starts a window until 11:00; 10:59 is inside it; 11:30 starts the next.
    const answers = [t0, t0 + 4.98 * HOUR, t0 + 5.5 * HOUR];
    expect(activeWindowEnd(answers, t0 + 6 * HOUR)).toBe(t0 + 5.5 * HOUR + WINDOW_MS);
  });

  it('knows a window that has already reset', () => {
    // The last answer was 4 hours ago, but its window started 6 hours ago.
    expect(activeWindowEnd([t0, t0 + 2 * HOUR], t0 + 6 * HOUR)).toBeUndefined();
  });

  it('ignores answers after now and handles no answers', () => {
    expect(activeWindowEnd([t0 + HOUR], t0)).toBeUndefined();
    expect(activeWindowEnd([], t0)).toBeUndefined();
  });
});

describe('decideTick', () => {
  it.each([
    ['06:00', 'wait', 'next ping at 06:30'],
    ['06:30', 'ping', 'ping time'],
    // The Mac woke up late: still worth it before work ends.
    ['09:40', 'ping', 'ping time (planned for 06:30)'],
    ['18:00', 'wait', 'working hours are over'],
  ])('at %s on a work day: %s', (time, action, reason) => {
    expect(decide(monday(time))).toMatchObject({ action, reason });
  });

  it('pings with the configured model for the local date', () => {
    expect(decide(monday('06:30'))).toEqual({
      action: 'ping',
      date: '2026-11-16',
      model: 'haiku',
      reason: 'ping time',
    });
  });

  it('waits on rest days and skipped dates', () => {
    expect(decide(Date.parse('2026-11-21T08:00:00+03:00'))).toEqual({
      action: 'wait',
      reason: '2026-11-21 is a rest day',
    });
    expect(decide(Date.parse('2026-12-31T08:00:00+03:00'))).toEqual({
      action: 'wait',
      reason: '2026-12-31 is skipped',
    });
  });

  it('pings once a day', () => {
    expect(decide(monday('07:00'), { state: ping('verified') }).reason).toBe(
      'already pinged today at 06:30',
    );
    // An unverified ping was still sent; it is not repeated.
    expect(decide(monday('07:00'), { state: ping('unverified') }).action).toBe('wait');
    // Yesterday's ping does not count.
    const yesterday: State = {
      version: 1,
      lastPing: { date: '2026-11-15', at: 0, outcome: 'verified', attempts: 1 },
    };
    expect(decide(monday('07:00'), { state: yesterday }).action).toBe('ping');
  });

  it('retries a failed ping a few times only', () => {
    expect(decide(monday('06:35'), { state: ping('timeout', 1) }).action).toBe('ping');
    expect(decide(monday('06:45'), { state: ping('failed', MAX_ATTEMPTS_PER_DAY) })).toEqual({
      action: 'wait',
      reason: 'gave up after 3 failed pings today',
    });
  });

  it('does not ping while a usage window is already active', () => {
    // Worked until 03:00: the window started at 02:00 lasts until 07:00.
    expect(decide(monday('06:30'), { activeWindowEnd: monday('07:00') })).toEqual({
      action: 'wait',
      reason: 'a usage window is already active until 07:00',
    });
    // Once it has reset, the next tick pings (late, but before work).
    expect(decide(monday('07:00'))).toMatchObject({ action: 'ping' });
  });

  it('waits when a fixed trigger has no effect', () => {
    const late: Config = {
      ...config,
      profiles: { default: { days: ['mon'], work: '10:00-18:00', trigger: '11:00' } },
    };
    expect(decide(monday('11:00'), { config: late })).toEqual({
      action: 'wait',
      reason: 'the fixed trigger 11:00 has no effect',
    });
  });

  it('uses local time across a daylight saving change', () => {
    // Berlin is on summer time (UTC+2) from 2026-03-29; this is the Monday after.
    const berlin = Date.parse('2026-03-30T04:30:00Z'); // 06:30 in Berlin (UTC+2)
    expect(decide(berlin, { timeZone: 'Europe/Berlin' })).toMatchObject({ action: 'ping' });
    expect(decide(berlin - 60_000, { timeZone: 'Europe/Berlin' })).toMatchObject({
      action: 'wait',
    });
  });
});
