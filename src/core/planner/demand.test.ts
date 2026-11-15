import { describe, expect, it } from 'vitest';
import { DEFAULT_BUSY_WEIGHT, manualDemand, SLOTS_PER_DAY } from './demand.ts';

describe('manualDemand', () => {
  it('weights working slots 1 and busy slots by their weight', () => {
    const demand = manualDemand({
      work: '09:00-12:00',
      busy: [{ range: '10:00-11:00', weight: 3 }, { range: '11:30-12:00' }],
    });
    expect(demand).toHaveLength(SLOTS_PER_DAY);
    expect(demand[9 * 12 - 1]).toBe(0);
    expect(demand[9 * 12]).toBe(1);
    expect(demand[10 * 12]).toBe(3);
    expect(demand[11 * 12 + 6]).toBe(DEFAULT_BUSY_WEIGHT);
    expect(demand[12 * 12]).toBe(0);
  });

  it('rejects a range it cannot parse', () => {
    expect(() => manualDemand({ work: 'all day' })).toThrow('Invalid range: all day');
  });
});
