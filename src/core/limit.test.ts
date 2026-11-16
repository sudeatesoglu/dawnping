import { describe, expect, it } from 'vitest';
import { limitResetToday } from './limit.ts';

describe('limitResetToday', () => {
  it.each([
    // Seen on a real Mac (#30).
    ["You've hit your weekly limit · resets 4pm (Europe/Istanbul)", 16 * 60],
    ['5-hour limit reached ∙ resets 3:30pm', 15 * 60 + 30],
    ['limit reached, resets at 9am', 9 * 60],
    ['resets 12am', 0],
    ['resets 12pm', 12 * 60],
    ['resets 16:05', 16 * 60 + 5],
  ])('%s → %i', (message, minutes) => {
    expect(limitResetToday(message)).toBe(minutes);
  });

  it.each([
    'resets Nov 20, 4pm',
    'resets 20 Nov',
    'resets Thursday',
    "You've hit your limit",
    'resets 13pm',
    'resets 25:00',
  ])('gives no time for today in %j', (message) => {
    expect(limitResetToday(message)).toBeUndefined();
  });
});
