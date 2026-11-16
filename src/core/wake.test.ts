import { describe, expect, it } from 'vitest';
import { coveringWake, parseRepeatingWakes, wakeCommand } from './wake.ts';

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

describe('coveringWake', () => {
  const weekdays = [{ minutes: 5 * 60 + 38, days: ['mon', 'tue', 'wed', 'thu', 'fri'] as const }];

  it('finds a wake shortly before the ping on that day', () => {
    expect(coveringWake(weekdays, 'tue', 5 * 60 + 40)).toBe(weekdays[0]);
  });

  it('ignores a wake on another day, after the ping, or long before it', () => {
    expect(coveringWake(weekdays, 'sat', 5 * 60 + 40)).toBeUndefined();
    expect(coveringWake(weekdays, 'tue', 5 * 60 + 30)).toBeUndefined();
    expect(coveringWake(weekdays, 'tue', 7 * 60)).toBeUndefined();
  });

  it('lets a wake before midnight cover a ping after it', () => {
    // Sunday 23:50 covers Monday 00:10.
    const sunday = [{ minutes: 23 * 60 + 50, days: ['sun'] as const }];
    expect(coveringWake(sunday, 'mon', 10)).toBe(sunday[0]);
    expect(coveringWake(sunday, 'tue', 10)).toBeUndefined();
  });

  it('never counts a wake whose days could not be read', () => {
    expect(coveringWake([{ minutes: 300, days: 'unknown' }], 'sun', 310)).toBeUndefined();
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
