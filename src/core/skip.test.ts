import { describe, expect, it } from 'vitest';
import { addDays, dateRange, rangeLength, resolveDateArg, withoutSkip, withSkips } from './skip.ts';

describe('addDays', () => {
  it('crosses month, year and leap day boundaries', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('resolveDateArg', () => {
  it.each([
    ['today', '2026-11-15'],
    ['Tomorrow', '2026-11-16'],
    ['2026-12-31', '2026-12-31'],
  ])('%s', (arg, expected) => {
    expect(resolveDateArg(arg, '2026-11-15')).toBe(expected);
  });

  it.each(['yesterday', '2026-02-30', '31.12.2026', ''])('rejects %j', (arg) => {
    expect(resolveDateArg(arg, '2026-11-15')).toBeUndefined();
  });
});

describe('dateRange', () => {
  it('includes both ends', () => {
    expect(dateRange('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(dateRange('2026-12-30', '2026-12-30')).toEqual(['2026-12-30']);
    expect(dateRange('2026-12-30', '2026-12-29')).toEqual([]);
  });

  it('counts a range without building it', () => {
    expect(rangeLength('2026-12-30', '2027-01-02')).toBe(4);
    expect(rangeLength('2026-12-30', '2026-12-29')).toBe(0);
  });
});

describe('withSkips / withoutSkip', () => {
  const today = '2026-11-15';

  it('adds dates sorted, once, and drops past dates', () => {
    expect(withSkips(['2026-12-31', '2026-11-01'], ['2026-11-20', '2026-12-31'], today)).toEqual([
      '2026-11-20',
      '2026-12-31',
    ]);
  });

  it('keeps today', () => {
    expect(withSkips([], [today], today)).toEqual([today]);
  });

  it('removes a date and past dates', () => {
    expect(withoutSkip(['2026-11-01', '2026-11-20', '2026-12-31'], '2026-11-20', today)).toEqual([
      '2026-12-31',
    ]);
  });
});
