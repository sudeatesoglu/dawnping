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

describe('parseRepeatingWakes on real output', () => {
  it('reads pmset -g sched as macOS prints it, repeating events first', () => {
    // Recorded on macOS 26 after `sudo pmset repeat wake MTWRF 05:38:00`.
    const text = `Repeating power events:
  wake at 5:38AM weekdays only
Scheduled power events:
 [0]  wake at 11/18/2026 01:26:36 by 'com.apple.alarm.user-invisible-com.apple.calaccessd.travelEngine.periodicRefreshTimer'
 [1]  wake at 11/18/2026 02:55:02 by 'com.apple.alarm.user-invisible-com.apple.osanalytics.hardhighengagementtimer'
`;
    expect(parseRepeatingWakes(text)).toEqual([
      { minutes: 5 * 60 + 38, days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
    ]);
  });
});

describe('coveringWake', () => {
  const weekdays = [{ minutes: 5 * 60 + 42, days: ['mon', 'tue', 'wed', 'thu', 'fri'] as const }];

  it('finds a wake at or shortly after the ping on that day', () => {
    expect(coveringWake(weekdays, 'tue', 5 * 60 + 40)).toBe(weekdays[0]);
    expect(coveringWake(weekdays, 'tue', 5 * 60 + 42)).toBe(weekdays[0]);
  });

  it('ignores a wake on another day, before the ping, or long after it', () => {
    expect(coveringWake(weekdays, 'sat', 5 * 60 + 40)).toBeUndefined();
    // Waking before the ping time does not help: the Mac sleeps again first.
    expect(coveringWake(weekdays, 'tue', 5 * 60 + 45)).toBeUndefined();
    expect(coveringWake(weekdays, 'tue', 5 * 60)).toBeUndefined();
  });

  it('lets a wake after midnight cover a ping before it', () => {
    // Tuesday 00:05 covers Monday 23:50.
    const tuesday = [{ minutes: 5, days: ['tue'] as const }];
    expect(coveringWake(tuesday, 'mon', 23 * 60 + 50)).toBe(tuesday[0]);
    expect(coveringWake(tuesday, 'tue', 23 * 60 + 50)).toBeUndefined();
    // Sunday wraps to Monday.
    expect(coveringWake([{ minutes: 5, days: ['mon'] }], 'sun', 23 * 60 + 50)).toBeDefined();
  });

  it('never counts a wake whose days could not be read', () => {
    expect(coveringWake([{ minutes: 310, days: 'unknown' }], 'sun', 300)).toBeUndefined();
  });
});

describe('wakeCommand', () => {
  it('wakes two minutes after the ping on the profile days, in pmset letters', () => {
    expect(wakeCommand(5 * 60 + 40, ['fri', 'mon', 'thu', 'sun'])).toBe(
      'sudo pmset repeat wake MRFU 05:42:00',
    );
  });

  it('moves a wake past midnight to the next day', () => {
    expect(wakeCommand(23 * 60 + 59, ['mon', 'sun'])).toBe('sudo pmset repeat wake MT 00:01:00');
  });
});
