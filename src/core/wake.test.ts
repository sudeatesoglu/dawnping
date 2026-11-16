import { describe, expect, it } from 'vitest';
import { parseRepeatingWakes, wakeCommand, wakeCovers } from './wake.ts';

const ONE_TIME_ONLY = `Scheduled power events:
 [0]  wake at 11/16/2026 21:44:18 by 'com.apple.alarm.user-invisible-com.apple.calaccessd.travelEngine.periodicRefreshTimer'
`;

describe('parseRepeatingWakes', () => {
  it('ignores one-time events macOS schedules for itself', () => {
    expect(parseRepeatingWakes(ONE_TIME_ONLY)).toEqual([]);
  });

  it.each([
    ['  wakepoweron at 5:38AM weekdays only', 5 * 60 + 38, ['mon', 'tue', 'wed', 'thu', 'fri']],
    ['  wake at 5:38PM every day', 17 * 60 + 38, ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']],
    ['  wakeorpoweron at 12:05AM weekends only', 5, ['sat', 'sun']],
    ['  wake at 06:15 some days', 6 * 60 + 15, 'unknown'],
  ])('reads %j', (line, minutes, days) => {
    const text = `${ONE_TIME_ONLY}Repeating power events:\n${line}\n`;
    expect(parseRepeatingWakes(text)).toEqual([{ minutes, days }]);
  });

  it('ignores repeating events that are not wakes', () => {
    expect(parseRepeatingWakes('Repeating power events:\n  sleep at 8:00PM every day\n')).toEqual(
      [],
    );
  });
});

describe('wakeCovers', () => {
  const weekdays = [{ minutes: 5 * 60 + 38, days: ['mon', 'tue', 'wed', 'thu', 'fri'] as const }];

  it('accepts a wake shortly before the ping on that day', () => {
    expect(wakeCovers(weekdays, 'tue', 5 * 60 + 40)).toBe(true);
  });

  it('rejects a wake on another day, after the ping, or long before it', () => {
    expect(wakeCovers(weekdays, 'sat', 5 * 60 + 40)).toBe(false);
    expect(wakeCovers(weekdays, 'tue', 5 * 60 + 30)).toBe(false);
    expect(wakeCovers(weekdays, 'tue', 7 * 60)).toBe(false);
  });

  it('accepts a wake whose days could not be read', () => {
    expect(wakeCovers([{ minutes: 300, days: 'unknown' }], 'sun', 310)).toBe(true);
  });
});

describe('wakeCommand', () => {
  it('wakes two minutes early on the profile days, in pmset letters', () => {
    expect(wakeCommand(5 * 60 + 40, ['fri', 'mon', 'thu', 'sun'])).toBe(
      'sudo pmset repeat wakeorpoweron MRFU 05:38:00',
    );
    expect(wakeCommand(1, ['sat'])).toBe('sudo pmset repeat wakeorpoweron S 00:00:00');
  });
});
