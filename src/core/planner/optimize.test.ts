import { describe, expect, it } from 'vitest';
import { formatTime } from '../time.ts';
import { manualDemand, SLOT_MINUTES, SLOTS_PER_DAY } from './demand.ts';
import { comparePlans, optimizeTrigger, simulate } from './optimize.ts';

const at = (slot: number) => formatTime(slot * SLOT_MINUTES);
const hours = (slots: number) => Number(((slots * SLOT_MINUTES) / 60).toFixed(2));

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
    // A busy morning stays in the first window, with an even split after it.
    ['10:00-18:00', [{ range: '10:00-12:00', weight: 3 }], '06:30: 4.5 + 6 + 1.5'],
    // A busy afternoon (#28): the first window gets 40 minutes of real work,
    // and the busy stretch is split between the second and the third.
    ['10:00-18:00', [{ range: '14:00-17:00' }], '05:40: 0.67 + 6.67 + 3.67'],
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

  it('prefers a split into meaningful windows over one window', () => {
    const day = manualDemand({ work: '12:00-17:00' });
    const two = simulate(day, 9 * 12 + 6);
    const one = simulate(day, 12 * 12);
    expect(two.windows).toHaveLength(2);
    expect(one.windows).toHaveLength(1);
    expect(comparePlans(two, one)).toBeLessThan(0);
  });

  it('gives a five-minute sliver window almost no credit', () => {
    // #28: 05:05 makes a third window with 5 minutes of work, which is
    // practically the same as not pinging; 05:45 is better.
    const day = manualDemand({ work: '10:00-18:00', busy: [{ range: '14:00-17:00' }] });
    const sliver = simulate(day, 5 * 12 + 1);
    const balanced = simulate(day, 5 * 12 + 9);
    expect(sliver.windows).toHaveLength(3);
    expect(sliver.windows[0]?.activeSlots).toBe(1);
    expect(comparePlans(balanced, sliver)).toBeLessThan(0);
  });
});
