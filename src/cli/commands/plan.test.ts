import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../test-context.ts';

// The test clock: Sunday 2026-11-15, 09:00 in Istanbul.
let t: Awaited<ReturnType<typeof createTestContext>>;

beforeEach(async () => {
  t = await createTestContext();
  await t.run('config', 'set', 'profiles.default.work', '12:00-17:00');
});

afterEach(async () => {
  await t.cleanup();
});

describe('plan', () => {
  it('explains the automatic choice window by window', async () => {
    expect((await t.run('plan', 'monday')).stdout).toBe(
      [
        'mon: profile "default", work 12:00-17:00',
        'Ping at 09:30 (chosen automatically)',
        "  09:30-14:30  2.5h  of work   50% of the day's load",
        "  14:30-19:30  2.5h  of work   50% of the day's load",
        '2 fresh windows during your working hours.',
        '',
      ].join('\n'),
    );
  });

  it('follows busy ranges and compares a fixed trigger with auto', async () => {
    await t.run('profile', 'busy', 'add', 'default', '15:00-17:00');
    await t.run('config', 'set', 'profiles.default.trigger', '09:00');
    const { stdout } = await t.run('plan', 'mon');
    expect(stdout).toContain('work 12:00-17:00, busy 15:00-17:00\n');
    expect(stdout).toContain('Ping at 09:00 (fixed in your config; auto would choose 10:15)\n');
    expect(stdout).toContain("  14:00-19:00  3h    of work   71% of the day's load\n");
  });

  it('plans today and tomorrow from the clock', async () => {
    // Sunday is a rest day, Monday is not.
    expect((await t.run('plan')).stdout).toBe('2026-11-15 (sun) is a rest day: no ping.\n');
    expect((await t.run('plan', 'tomorrow')).stdout).toContain('2026-11-16 (mon): profile');
  });

  it('reports skipped dates', async () => {
    await t.run('skip', '2026-11-16');
    expect((await t.run('plan', '2026-11-16')).stdout).toBe(
      '2026-11-16 (mon) is skipped: no ping.\n',
    );
  });

  it('says when one window is all there is', async () => {
    await t.run('config', 'set', 'profiles.default.work', '09:00-09:30');
    expect((await t.run('plan', 'mon')).stdout).toContain('2 fresh windows');
    await t.run('config', 'set', 'profiles.default.trigger', '09:00');
    expect((await t.run('plan', 'mon')).stdout).toContain('1 fresh window during');
  });

  it('rejects something that is not a day', async () => {
    expect((await t.run('plan', 'someday')).stderr).toBe(
      'Not a day: "someday" (use today, tomorrow, a weekday (mon..sun) or YYYY-MM-DD)\n',
    );
  });
});
