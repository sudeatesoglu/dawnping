import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readTextFile } from '../../adapters/file-store.ts';
import type { CliContext } from '../context.ts';
import {
  createFakeNotifier,
  createFakePinger,
  createFakeSessionLogs,
  createTestContext,
} from '../test-context.ts';

/** Monday 2026-11-16, 07:00 in Istanbul: after the 06:00 auto ping for 09:00-18:00. */
const MONDAY_7AM = Date.parse('2026-11-16T07:00:00+03:00');

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function context(overrides: Partial<CliContext> = {}) {
  const t = await createTestContext({ clock: { now: () => MONDAY_7AM }, ...overrides });
  cleanup = t.cleanup;
  return t;
}

const readState = async (stateDir: string) =>
  JSON.parse(await readFile(join(stateDir, 'state.json'), 'utf8'));

describe('tick', () => {
  it('pings, verifies and records the result once a day', async () => {
    const pinger = createFakePinger();
    const t = await context({ pinger });

    expect(await t.run('tick')).toEqual({
      code: 0,
      stdout:
        '2026-11-16T04:00:00.000Z pinged haiku at ping time (planned for 06:00): confirmed in the session log\n',
      stderr: '',
    });
    expect(await readState(t.ctx.paths.stateDir)).toEqual({
      version: 1,
      lastPing: { date: '2026-11-16', at: MONDAY_7AM, outcome: 'verified', attempts: 1 },
    });

    expect((await t.run('tick')).stdout).toBe(
      '2026-11-16T04:00:00.000Z no ping: already pinged today at 07:00\n',
    );
    expect(pinger.pinged).toEqual(['haiku']);
  });

  it('logs why it waits', async () => {
    const t = await context({ clock: { now: () => Date.parse('2026-11-15T08:00:00+03:00') } });
    expect((await t.run('tick')).stdout).toBe(
      '2026-11-15T05:00:00.000Z no ping: 2026-11-15 is a rest day\n',
    );
  });

  it('does not ping while a usage window is active', async () => {
    const pinger = createFakePinger();
    // The user worked at 05:30, so a window runs until 10:30.
    const sessionLogs = createFakeSessionLogs(() => [
      {
        timestamp: Date.parse('2026-11-16T05:30:00+03:00'),
        model: 'claude-opus-5-5',
        folder: '-work',
      },
    ]);
    const t = await context({ pinger, sessionLogs });
    expect((await t.run('tick')).stdout).toBe(
      '2026-11-16T04:00:00.000Z no ping: a usage window is already active until 10:30\n',
    );
    expect(pinger.pinged).toEqual([]);
  });

  it('retries a failed ping, notifies, and gives up after three attempts', async () => {
    const notifier = createFakeNotifier();
    const pinger = createFakePinger({
      ok: false,
      failure: 'not-logged-in',
      detail: 'Please run /login',
    });
    const t = await context({ pinger, notifier });

    const first = await t.run('tick');
    expect(first.code).toBe(1);
    expect(first.stderr).toBe(
      '2026-11-16T04:00:00.000Z pinged haiku at ping time (planned for 06:00): not-logged-in (Please run /login)\n',
    );
    await t.run('tick');
    const third = await t.run('tick');
    expect(third.stderr).toContain('; giving up for today after 3 attempts\n');
    expect((await t.run('tick')).stdout).toContain('no ping: gave up after 3 failed pings today');
    expect(pinger.pinged).toHaveLength(3);
    expect(notifier.shown).toEqual(
      new Array(3).fill('dawnping: Ping failed: Claude Code is not logged in.'),
    );
  });

  it('reports an unverified ping and does not repeat it', async () => {
    const notifier = createFakeNotifier();
    const t = await context({ notifier, sessionLogs: createFakeSessionLogs(() => []) });
    const result = await t.run('tick');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(': unverified\n');
    expect(notifier.shown).toHaveLength(1);
    expect((await t.run('tick')).stdout).toContain('no ping: already pinged today');
  });

  it('fails with a hint when the config is invalid', async () => {
    const t = await context();
    await mkdir(join(t.ctx.paths.configFile, '..'), { recursive: true });
    await writeFile(t.ctx.paths.configFile, '{');
    const result = await t.run('tick');
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(
      /no ping: the config is invalid \(config: not valid JSON .*\); run: dawnping config edit\n$/,
    );
  });

  it('fails with a hint when no time zone is usable', async () => {
    const t = await context({ systemTimeZone: 'Etc/Unknown' });
    expect((await t.run('tick')).stderr).toContain(
      'no ping: no usable time zone; run: dawnping config set timezone <zone>',
    );
  });

  it('skips the run while another tick holds the lock', async () => {
    const pinger = createFakePinger();
    const t = await context({ pinger });
    await mkdir(t.ctx.paths.stateDir, { recursive: true });
    await writeFile(join(t.ctx.paths.stateDir, 'tick.lock'), '');
    expect((await t.run('tick')).stdout).toBe(
      '2026-11-16T04:00:00.000Z another tick is running; skipped\n',
    );
    expect(pinger.pinged).toEqual([]);
  });

  it('notifies and logs unexpected errors, and releases the lock', async () => {
    const notifier = createFakeNotifier();
    const t = await context({
      notifier,
      sessionLogs: {
        entriesSince: async () => {
          throw new Error('disk on fire');
        },
        available: async () => true,
      },
    });
    const result = await t.run('tick');
    expect(result).toMatchObject({
      code: 1,
      stderr: '2026-11-16T04:00:00.000Z error: disk on fire\n',
    });
    expect(notifier.shown).toEqual(['dawnping: Ping failed.']);
    expect(await readTextFile(join(t.ctx.paths.stateDir, 'tick.lock'))).toBeUndefined();
  });

  it('keeps tick.log bounded', async () => {
    const t = await context();
    await mkdir(t.ctx.paths.stateDir, { recursive: true });
    const log = join(t.ctx.paths.stateDir, 'tick.log');
    await writeFile(log, 'x'.repeat(600 * 1024));
    await t.run('tick');
    expect((await readFile(`${log}.1`, 'utf8')).length).toBe(600 * 1024);
  });

  it('is hidden from help', async () => {
    const t = await context();
    expect((await t.run('--help')).stdout).not.toContain('tick');
  });
});
