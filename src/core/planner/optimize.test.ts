import { describe, expect, it } from 'vitest';
import { formatTime } from '../time.ts';
import { manualDemand, SLOT_MINUTES, SLOTS_PER_DAY } from './demand.ts';
import { comparePlans, optimizeTrigger, simulate } from './optimize.ts';

const at = (slot: number) => formatTime(slot * SLOT_MINUTES);
const hours = (slots: number) => (slots * SLOT_MINUTES) / 60;

/** The plan as "trigger: window loads in hours", for readable expectations. */
function summary(work: string, busy: { range: string; weight?: number }[] = []) {
  const plan = optimizeTrigger(manualDemand({ work, busy }));
  if (plan === undefined) throw new Error('no plan');
  return `${at(plan.trigger)}: ${plan.windows.map((w) => hours(w.load)).join(' + ')}`;
}

describe('optimizeTrigger', () => {
  it.each([
    // The examples from issue #24.
    ['10:00-18:00', [], '06:30: 1.5 + 5 + 1.5'],
    ['09:00-18:00', [], '06:00: 2 + 5 + 2'],
    ['12:00-17:00', [], '09:30: 2.5 + 2.5'],
    ['12:00-17:00', [{ range: '15:00-17:00' }], '10:15: 3.5 + 3.5'],
    ['10:00-15:00', [], '07:30: 2.5 + 2.5'],
    // A busy morning: the first reset lands inside the busy stretch and splits
    // it between two windows (06:30 would leave 6 in the second window).
    ['10:00-18:00', [{ range: '10:00-12:00', weight: 3 }], '06:45: 5.25 + 5.5 + 1.25'],
  ])('%s with %j → %s', (work, busy, expected) => {
    expect(summary(work, busy)).toBe(expected);
  });

  it('never pings before midnight', () => {
    // The ideal ping for 01:00-12:00 would be 00:00 minus an hour.
    expect(optimizeTrigger(manualDemand({ work: '01:00-12:00' }))?.trigger).toBe(0);
  });

  it('has no plan for a day without work', () => {
    expect(optimizeTrigger(new Array(SLOTS_PER_DAY).fill(0))).toBeUndefined();
  });
});

describe('simulate', () => {
  const day = manualDemand({ work: '10:00-18:00' });

  it('treats a ping after the start of work as too late', () => {
    // At 11:00 the user's own message at 10:00 already started the window.
    expect(at(simulate(day, 11 * 12).windows[0]?.start ?? -1)).toBe('10:00');
  });

  it('treats a ping more than five hours early as wasted', () => {
    expect(at(simulate(day, 4 * 12).windows[0]?.start ?? -1)).toBe('10:00');
  });

  it('starts the next window with the next activity after a break', () => {
    // Work 08:00-12:00 and 14:00-18:00: the first window resets during lunch
    // (13:00), so the next one starts when work resumes at 14:00.
    const split = manualDemand({
      work: '08:00-18:00',
      busy: [{ range: '12:00-14:00', weight: 0.0001 }],
    });
    const gap = split.map((w) => (w < 0.01 ? 0 : w));
    const plan = simulate(gap, 8 * 12);
    expect(plan.windows.map((w) => `${at(w.start)}-${at(w.end)}`)).toEqual([
      '08:00-13:00',
      '14:00-19:00',
    ]);
  });
});

describe('comparePlans', () => {
  it('treats loads that differ only by rounding as equal', () => {
    const a = { trigger: 10, windows: [{ start: 10, end: 70, activeSlots: 3, load: 0.1 + 0.2 }] };
    const b = { trigger: 20, windows: [{ start: 20, end: 80, activeSlots: 3, load: 0.3 }] };
    // Equal loads: the later ping (b) wins, not the rounding error.
    expect(comparePlans(a, b)).toBeGreaterThan(0);
  });

  it('prefers more windows over a lighter peak', () => {
    const day = manualDemand({ work: '12:00-17:00' });
    const two = simulate(day, 9 * 12);
    const one = simulate(day, 12 * 12);
    expect(two.windows).toHaveLength(2);
    expect(one.windows).toHaveLength(1);
    expect(comparePlans(two, one)).toBeLessThan(0);
  });
});
