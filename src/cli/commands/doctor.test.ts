import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CliContext } from '../context.ts';
import { createFakeScheduler, createFakeSessionLogs, createTestContext } from '../test-context.ts';

/** Monday 2026-11-16, 04:00 in Istanbul: before the 06:00 auto ping for 09:00-18:00. */
const NOW = Date.parse('2026-11-16T04:00:00+03:00');
const WAKES = 'Repeating power events:\n  wakepoweron at 5:58AM weekdays only\n';

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

/** A healthy setup: installed, recently run, pinged and woken in time. */
async function context(overrides: Partial<CliContext> = {}, state?: object) {
  const scheduler = createFakeScheduler();
  scheduler.installed = {
    programArguments: [],
    intervalSeconds: 300,
    logFile: '',
    environment: {},
  };
  const t = await createTestContext({
    clock: { now: () => NOW },
    scheduler,
    system: { claudeVersion: async () => '2.1.325 (Claude Code)', wakeSchedule: async () => WAKES },
    ...overrides,
  });
  cleanup = t.cleanup;
  await mkdir(t.ctx.paths.stateDir, { recursive: true });
  await writeFile(
    join(t.ctx.paths.stateDir, 'tick.log'),
    `${new Date(NOW - 2 * 60_000).toISOString()} no ping: next ping at 06:00\n`,
  );
  const lastPing = {
    date: '2026-11-13',
    at: NOW - 3 * 86_400_000,
    outcome: 'verified',
    attempts: 1,
  };
  await writeFile(
    join(t.ctx.paths.stateDir, 'state.json'),
    JSON.stringify(state ?? { version: 1, lastPing }),
  );
  return t;
}

describe('doctor', () => {
  it('reports a healthy setup', async () => {
    const t = await context();
    const { code, stdout } = await t.run('doctor');
    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        'ok    claude        2.1.325 (Claude Code)',
        'ok    config        defaults (no config file yet), 1 profile',
        'ok    time zone     Europe/Istanbul',
        'ok    today         next ping at 06:00; next: 2026-11-17 (tue) at 06:00',
        'ok    agent         runs every 5 minutes; last run 2 min ago: no ping: next ping at 06:00',
        'ok    session logs  readable',
        'ok    last ping     2026-11-13 04:00, confirmed in the session log',
        'ok    wake          the Mac is set to wake shortly before every ping',
        'Everything looks good.',
        '',
      ].join('\n'),
    );
  });

  it('fails without claude and says how to fix it', async () => {
    const t = await context({
      system: { claudeVersion: async () => undefined, wakeSchedule: async () => WAKES },
    });
    const result = await t.run('doctor');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL  claude        the claude command was not found\n');
    expect(result.stdout).toContain('fix: install Claude Code');
    expect(result.stderr).toBe('1 problem, 0 warnings.\n');
  });

  it('shows the pmset command when the Mac will not wake in time', async () => {
    const t = await context({
      system: {
        claudeVersion: async () => 'v',
        wakeSchedule: async () => 'Scheduled power events:\n',
      },
    });
    const { stdout, code } = await t.run('doctor');
    expect(code).toBe(0);
    expect(stdout).toContain(
      'warn  wake          the Mac is not set to wake before the ping at 06:00 (default)',
    );
    expect(stdout).toContain(
      'fix: sudo pmset repeat wakeorpoweron MTWRF 05:58:00   (undo: sudo pmset repeat cancel)',
    );
    expect(stdout).toContain('No problems, 1 warning.\n');
  });

  it('skips the wake check where there is no pmset', async () => {
    const t = await context({
      system: { claudeVersion: async () => 'v', wakeSchedule: async () => undefined },
    });
    expect((await t.run('doctor')).stdout).not.toContain('wake');
  });

  it('warns about a missing or stalled agent', async () => {
    const t = await context({ scheduler: createFakeScheduler() });
    expect((await t.run('doctor')).stdout).toContain('warn  agent         not installed');

    const stalled = await context({ clock: { now: () => NOW + 3 * 3_600_000 } });
    expect((await stalled.run('doctor')).stdout).toContain(
      'warn  agent         installed, but its last run was 3 h ago',
    );
  });

  it('explains the last ping outcome', async () => {
    const ping = (outcome: string, attempts = 1) => ({
      version: 1,
      lastPing: { date: '2026-11-16', at: NOW, outcome, attempts },
    });
    const cases: [string, string][] = [
      ['timeout', 'warn  last ping     2026-11-16 04:00, no answer in time after 2 attempts'],
      ['not-logged-in', 'FAIL  last ping     2026-11-16 04:00, Claude Code is not logged in'],
      ['unverified', 'warn  last ping     2026-11-16 04:00, sent but not found in the session log'],
      ['pending', 'warn  last ping     2026-11-16 04:00, interrupted before it finished'],
      ['failed', 'FAIL  last ping     2026-11-16 04:00, failed after 2 attempts'],
      ['not-found', 'FAIL  last ping     2026-11-16 04:00, the claude command was not found'],
    ];
    for (const [outcome, line] of cases) {
      const t = await context({}, ping(outcome, 2));
      expect((await t.run('doctor')).stdout).toContain(line);
      await t.cleanup();
    }
  });

  it('shows why the last ping failed', async () => {
    const lastPing = { date: '2026-11-16', at: NOW, attempts: 1 };
    const limit = await context(
      {},
      {
        version: 1,
        lastPing: {
          ...lastPing,
          outcome: 'limit-reached',
          detail: "You've hit your weekly limit · resets 4pm",
        },
      },
    );
    expect((await limit.run('doctor')).stdout).toContain(
      "warn  last ping     2026-11-16 04:00, a usage limit was reached: You've hit your weekly limit · resets 4pm",
    );
    await limit.cleanup();
    const failed = await context(
      {},
      {
        version: 1,
        lastPing: { ...lastPing, outcome: 'failed', detail: 'model not found' },
      },
    );
    expect((await failed.run('doctor')).stdout).toContain(
      'FAIL  last ping     2026-11-16 04:00, failed: model not found',
    );
  });

  it('suggests a first ping when there was none', async () => {
    const t = await context({}, { version: 1 });
    expect((await t.run('doctor')).stdout).toContain('warn  last ping     none yet');
  });

  it('fails on an invalid config or missing session logs', async () => {
    const t = await context({ sessionLogs: createFakeSessionLogs(() => [], false) });
    await mkdir(join(t.ctx.paths.configFile, '..'), { recursive: true });
    await writeFile(t.ctx.paths.configFile, '{');
    const { stdout, stderr } = await t.run('doctor');
    expect(stdout).toContain('FAIL  config        invalid: config: not valid JSON');
    expect(stdout).toContain(`FAIL  session logs  not found at ${t.ctx.paths.claudeProjectsDir}`);
    expect(stderr).toMatch(/^2 problems/);
  });

  it('warns when there are no profiles', async () => {
    const t = await context();
    await t.run('config', 'unset', 'profiles.default');
    const { stdout } = await t.run('doctor');
    expect(stdout).toContain('warn  config        no profiles: every day is a rest day');
    expect(stdout).toContain('ok    today         2026-11-16 is a rest day');
  });

  it('shows what a crashing agent wrote last', async () => {
    const t = await context();
    await writeFile(
      join(t.ctx.paths.stateDir, 'tick.log'),
      `${new Date(NOW - 10 * 60_000).toISOString()} no ping: next ping at 06:00\nenv: node: No such file or directory\n`,
    );
    const result = await t.run('doctor');
    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      'FAIL  agent         its last run wrote: env: node: No such file or directory',
    );
  });

  it('reads the rotated log while tick.log does not exist yet', async () => {
    const t = await context();
    const log = join(t.ctx.paths.stateDir, 'tick.log');
    await writeFile(
      `${log}.1`,
      `${new Date(NOW - 60_000).toISOString()} no ping: next ping at 06:00\n`,
    );
    await rm(log);
    expect((await t.run('doctor')).stdout).toContain(
      'ok    agent         runs every 5 minutes; last run 1 min ago',
    );
  });

  it('turns an unreadable file into a failed check instead of crashing', async () => {
    const t = await context();
    await rm(join(t.ctx.paths.stateDir, 'state.json'));
    await mkdir(join(t.ctx.paths.stateDir, 'state.json'));
    const { stdout, code } = await t.run('doctor');
    expect(code).toBe(1);
    expect(stdout).toMatch(/FAIL {2}last ping {5}could not check: /);
    expect(stdout).toContain('ok    claude');
  });

  it('agrees with tick about a fixed trigger that has no effect', async () => {
    const t = await context();
    await t.run('config', 'set', 'profiles.default.trigger', '11:00');
    expect((await t.run('doctor')).stdout).toContain(
      'warn  today         no ping: the fixed trigger 11:00 has no effect',
    );
  });

  it('says only the earliest of several ping times can be covered', async () => {
    const t = await context();
    await t.run('profile', 'add', 'friday', '--days', 'fri', '--work', '12:00-17:00', '--take');
    const { stdout } = await t.run('doctor');
    expect(stdout).toContain('the ping at 09:30 (friday)');
    expect(stdout).toContain(
      'pmset allows one repeating wake, so only the earliest ping time can be covered',
    );
  });

  it('never sends a message to Claude', async () => {
    const t = await context();
    await t.run('doctor');
    // The fake pinger records every ping; doctor must not use it.
    expect((t.ctx.pinger as unknown as { pinged: string[] }).pinged).toEqual([]);
  });
});
