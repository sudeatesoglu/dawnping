import { describe, expect, it } from 'vitest';
import { formatTime } from '../time.ts';
import { SLOT_MINUTES } from './demand.ts';
import { planProfileDay } from './plan-day.ts';

const at = (slot: number) => formatTime(slot * SLOT_MINUTES);

describe('planProfileDay', () => {
  it('uses the optimized plan for trigger auto', () => {
    const day = planProfileDay({ days: ['mon'], work: '12:00-17:00', trigger: 'auto' });
    expect(day.mode).toBe('auto');
    expect(at(day.plan.trigger)).toBe('09:30');
    expect(day.plan).toBe(day.auto);
  });

  it('keeps a fixed trigger and still reports what auto would choose', () => {
    const day = planProfileDay({ days: ['mon'], work: '12:00-17:00', trigger: '09:00' });
    expect(day.mode).toBe('fixed');
    expect(at(day.plan.trigger)).toBe('09:00');
    expect(at(day.auto.trigger)).toBe('09:30');
    expect(day.plan.windows.map((w) => w.load)).toEqual([24, 36]);
  });

  it('rejects a profile without working time', () => {
    expect(() =>
      planProfileDay({ days: ['mon'], work: '00:00-00:00', trigger: 'auto' } as never),
    ).toThrow();
  });
});
