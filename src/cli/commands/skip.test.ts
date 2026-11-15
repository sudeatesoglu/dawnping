import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../test-context.ts';

// The test context's clock: Sunday 2026-11-15, 09:00 in Istanbul.
let t: Awaited<ReturnType<typeof createTestContext>>;

beforeEach(async () => {
  t = await createTestContext();
});

afterEach(async () => {
  await t.cleanup();
});

const savedSkip = async () => JSON.parse(await readFile(t.ctx.paths.configFile, 'utf8')).skip;

describe('skip', () => {
  it('skips tomorrow in the configured time zone', async () => {
    expect(await t.run('skip', 'tomorrow')).toEqual({
      code: 0,
      stdout: 'Skipping 2026-11-16 (Mon)\n',
      stderr: '',
    });
    expect(await savedSkip()).toEqual(['2026-11-16']);
  });

  it('uses the config time zone over the system one', async () => {
    // 06:00 UTC is still Saturday evening in Honolulu (UTC-10).
    await t.run('config', 'set', 'timezone', 'Pacific/Honolulu');
    expect((await t.run('skip', 'today')).stdout).toBe(
      'Skipping 2026-11-14 (Sat, already a rest day)\n',
    );
  });

  it('skips several dates and a range', async () => {
    await t.run('skip', '2026-12-31', '2026-11-20');
    await t.run('skip', '2026-12-24', '--until', '2026-12-26');
    expect(await savedSkip()).toEqual([
      '2026-11-20',
      '2026-12-24',
      '2026-12-25',
      '2026-12-26',
      '2026-12-31',
    ]);
  });

  it('does not add a date twice', async () => {
    await t.run('skip', 'tomorrow');
    await t.run('skip', 'tomorrow');
    expect(await savedSkip()).toEqual(['2026-11-16']);
  });

  it('marks dates that are rest days anyway', async () => {
    expect((await t.run('skip', '2026-11-21')).stdout).toBe(
      'Skipping 2026-11-21 (Sat, already a rest day)\n',
    );
  });

  it('drops past dates when saving', async () => {
    await t.run('config', 'set', 'skip', '2026-11-01,2026-11-20');
    await t.run('skip', 'tomorrow');
    expect(await savedSkip()).toEqual(['2026-11-16', '2026-11-20']);
  });

  it.each([
    [['yesterday'], 'Not a date: "yesterday" (use today, tomorrow or YYYY-MM-DD)\n'],
    [['2026-11-14'], '2026-11-14 is in the past.\n'],
    [
      ['2026-11-01', '2026-11-02', 'today'],
      'These dates are in the past: 2026-11-01, 2026-11-02.\n',
    ],
    [['2026-11-01', '--until', '2026-11-20'], '2026-11-01 is in the past.\n'],
    [['tomorrow', '--list'], '--list does not take dates; run it on its own.\n'],
    [[], 'Give a date to skip (today, tomorrow or YYYY-MM-DD) or --list.\n'],
    [['2026-12-24', '--until', '2026-12-01'], '--until 2026-12-01 is before 2026-12-24.\n'],
    [['a', 'b', '--until', '2026-12-01'], 'Not a date: "a" (use today, tomorrow or YYYY-MM-DD)\n'],
    [['today', 'tomorrow', '--until', '2026-12-01'], '--until takes exactly one start date.\n'],
    [['today', '--until', '2062-01-01'], 'That is 12832 days; at most 366 at once.\n'],
  ])('rejects %j', async (args, message) => {
    expect(await t.run('skip', ...args)).toEqual({ code: 1, stdout: '', stderr: message });
  });

  it('shows the right weekday east of UTC+12', async () => {
    // 2026-11-21 is a Saturday everywhere, also in Auckland (UTC+13).
    await t.run('config', 'set', 'timezone', 'Pacific/Auckland');
    expect((await t.run('skip', '2026-11-21')).stdout).toBe(
      'Skipping 2026-11-21 (Sat, already a rest day)\n',
    );
    expect((await t.run('skip', '2026-11-20')).stdout).toBe('Skipping 2026-11-20 (Fri)\n');
  });

  it('asks for a time zone when the system one is unusable', async () => {
    const e = await createTestContext({ systemTimeZone: 'Etc/Unknown' });
    try {
      expect((await e.run('skip', 'tomorrow')).stderr).toBe(
        'The system time zone "Etc/Unknown" is not an IANA zone like Europe/Istanbul.\n' +
          'Set yours with: dawnping config set timezone <zone>\n',
      );
    } finally {
      await e.cleanup();
    }
  });

  it('lists upcoming skipped dates', async () => {
    expect((await t.run('skip', '--list')).stdout).toBe('No skipped dates.\n');
    await t.run('config', 'set', 'skip', '2026-11-01,2026-11-20');
    expect((await t.run('skip', '--list')).stdout).toBe('2026-11-20 (Fri)\n');
  });
});

describe('unskip', () => {
  it('removes a skipped date', async () => {
    await t.run('skip', 'tomorrow', '2026-11-20');
    expect((await t.run('unskip', 'tomorrow')).stdout).toBe('No longer skipping 2026-11-16\n');
    expect(await savedSkip()).toEqual(['2026-11-20']);
  });

  it('does not leave an empty skip list in a file that had none', async () => {
    await t.run('config', 'set', 'timezone', 'Europe/Istanbul');
    await t.run('skip', 'tomorrow');
    await t.run('unskip', 'tomorrow');
    expect(await savedSkip()).toBeUndefined();
  });

  it('refuses past dates', async () => {
    await t.run('config', 'set', 'skip', '2026-11-01,2026-11-20');
    expect((await t.run('unskip', '2026-11-01')).stderr).toBe('2026-11-01 is in the past.\n');
  });

  it('fails for a date that is not skipped', async () => {
    expect((await t.run('unskip', '2026-11-20')).stderr).toBe('2026-11-20 is not skipped.\n');
  });
});
