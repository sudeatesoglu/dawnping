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
  // auto → 06:30 for 10:00-18:00 (ADR-0005).
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

  it('anchors the chain at a five-hour gap, not at the start of the history', () => {
    // The history starts mid-window at t0+1h. A real window started at
    // t0+5.5h after the one from t0 reset. Starting the chain at t0+1h would
    // shift it; the 5-hour gap before t0+12h anchors it exactly.
    const answers = [t0 + HOUR, t0 + 5.5 * HOUR, t0 + 6.5 * HOUR, t0 + 12 * HOUR];
    // Unanchored chain: t0+1h → reset t0+6h, t0+6.5h → reset t0+11.5h.
    expect(activeWindowEnd(answers.slice(0, 3), t0 + 11 * HOUR)).toBe(t0 + 11.5 * HOUR);
    // After the gap the chain is exact: t0+12h starts a window until t0+17h.
    expect(activeWindowEnd(answers, t0 + 13 * HOUR)).toBe(t0 + 17 * HOUR);
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
      attempt: 1,
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
    expect(decide(monday('07:00'), { state: ping('verified') })).toEqual({
      action: 'wait',
      reason: 'already pinged today at 06:30',
    });
    // An unverified ping was still sent; it is not repeated.
    expect(decide(monday('07:00'), { state: ping('unverified') }).action).toBe('wait');
    // Yesterday's ping does not count.
    const yesterday: State = {
      version: 1,
      lastPing: { date: '2026-11-15', at: 0, outcome: 'verified', attempts: 1 },
    };
    expect(decide(monday('07:00'), { state: yesterday }).action).toBe('ping');
  });

  it('retries failed or interrupted pings with growing gaps', () => {
    // The 06:30 attempt failed: next try 15 minutes later.
    expect(decide(monday('06:40'), { state: ping('timeout', 1) })).toEqual({
      action: 'wait',
      reason: 'retrying at 06:45',
    });
    expect(decide(monday('06:45'), { state: ping('timeout', 1) })).toMatchObject({
      action: 'ping',
      attempt: 2,
    });
    // After the second failure the gap is 30 minutes.
    expect(decide(monday('06:59'), { state: ping('failed', 2) })).toMatchObject({ action: 'wait' });
    // A run that died after recording "pending" counts as an attempt.
    expect(decide(monday('06:35'), { state: ping('pending', 1) })).toMatchObject({
      action: 'wait',
    });
  });

  it('gives up after the last attempt of the day', () => {
    expect(decide(monday('15:00'), { state: ping('failed', MAX_ATTEMPTS_PER_DAY) })).toEqual({
      action: 'wait',
      reason: `gave up after ${MAX_ATTEMPTS_PER_DAY} failed pings today`,
    });
  });

  it('asks for the window check only when everything else says ping', () => {
    expect(decide(monday('06:30'), { activeWindowEnd: 'unchecked' })).toEqual({
      action: 'check-window',
    });
    expect(decide(monday('06:00'), { activeWindowEnd: 'unchecked' })).toMatchObject({
      action: 'wait',
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
