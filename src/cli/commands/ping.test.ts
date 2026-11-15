import { afterEach, describe, expect, it } from 'vitest';
import {
  createFakeNotifier,
  createFakePinger,
  createFakeSessionLogs,
  createTestContext,
  FAKE_PING_FOLDER,
} from '../test-context.ts';

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

async function context(...args: Parameters<typeof createTestContext>) {
  const t = await createTestContext(...args);
  cleanup = t.cleanup;
  return t;
}

describe('ping', () => {
  it('pings the configured model and says when the window resets', async () => {
    const pinger = createFakePinger();
    const t = await context({ pinger });
    await t.run('config', 'set', 'ping.model', 'sonnet');
    // The test clock is 09:00 in Istanbul, so the window resets at 14:00.
    expect(await t.run('ping')).toEqual({
      code: 0,
      stdout:
        'Pinged sonnet in 2.1s.\n' +
        'If no usage window was active, one started now, resetting around 14:00.\n' +
        'Confirmed: Claude Code logged the ping.\n',
      stderr: '',
    });
    expect(pinger.pinged).toEqual(['sonnet']);
  });

  it('prints the command without running it on --dry-run', async () => {
    const pinger = createFakePinger();
    const t = await context({ pinger });
    expect((await t.run('ping', '--dry-run')).stdout).toBe(
      "Would run: claude -p --model haiku 'Reply with the single word: ok'\n  in /state/ping\n",
    );
    expect(pinger.pinged).toEqual([]);
  });

  it.each([
    [
      'not-found',
      'claude is not on PATH',
      'Install Claude Code, or make sure `claude` is on your PATH.',
    ],
    [
      'not-logged-in',
      'Please run /login',
      'Log in to Claude Code first: run `claude` and follow the login steps.',
    ],
    ['timeout', 'no answer within 60s', 'Check your network connection and try again.'],
    ['failed', 'exit code 2', 'Run `claude -p "hi"` yourself to see the full error.'],
  ] as const)('explains a %s failure', async (failure, detail, hint) => {
    const t = await context({ pinger: createFakePinger({ ok: false, failure, detail }) });
    expect(await t.run('ping')).toEqual({
      code: 1,
      stdout: '',
      stderr: `Ping failed: ${detail}.\n${hint}\n`,
    });
  });

  it('refuses a model name that claude could read as a flag', async () => {
    const t = await context();
    // `--` makes commander pass the value through instead of parsing it.
    const result = await t.run('config', 'set', 'ping.model', '--', '--dangerous');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('ping.model: must be a model name or alias');
  });

  it('leaves out the reset time when no time zone is usable', async () => {
    const t = await context({ systemTimeZone: 'Etc/Unknown' });
    expect((await t.run('ping')).stdout).toBe(
      'Pinged haiku in 2.1s.\n' +
        'If no usage window was active, one started now.\n' +
        'Confirmed: Claude Code logged the ping.\n',
    );
  });
});

describe('ping verification', () => {
  it('confirms a ping that Claude Code logged', async () => {
    const t = await context();
    const result = await t.run('ping');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Confirmed: Claude Code logged the ping.\n');
  });

  it('fails when the ping is not in the session log', async () => {
    const t = await context({ sessionLogs: createFakeSessionLogs(() => []) });
    const result = await t.run('ping');
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      "The ping is not in Claude Code's session log, so it may not have counted.\n" +
        `Expected it in ${t.ctx.paths.claudeProjectsDir}/${FAKE_PING_FOLDER}\n`,
    );
  });

  it('says so when there are no session logs at all', async () => {
    const t = await context({ sessionLogs: createFakeSessionLogs(() => [], false) });
    expect((await t.run('ping')).stderr).toContain(
      `No session logs found at ${t.ctx.paths.claudeProjectsDir}. Set CLAUDE_CONFIG_DIR`,
    );
  });

  it('does not accept an answer from another project as the ping', async () => {
    const other = createFakeSessionLogs((since) => [
      { timestamp: since + 1_000, model: 'claude-opus-5-5', folder: '-Users-u-work' },
    ]);
    const t = await context({ sessionLogs: other });
    expect((await t.run('ping')).code).toBe(1);
  });
});

describe('ping --notify', () => {
  it('notifies a confirmed ping', async () => {
    const notifier = createFakeNotifier();
    const t = await context({ notifier });
    await t.run('ping', '--notify');
    expect(notifier.shown).toEqual(['dawnping: Ping sent and confirmed in the session log.']);
  });

  it('notifies failures with a fixed text, without error details', async () => {
    const notifier = createFakeNotifier();
    const t = await context({
      notifier,
      pinger: createFakePinger({
        ok: false,
        failure: 'failed',
        detail: 'error in /Users/u/secret',
      }),
    });
    await t.run('ping', '--notify');
    expect(notifier.shown).toEqual(['dawnping: Ping failed.']);
  });

  it('notifies an unverified ping', async () => {
    const notifier = createFakeNotifier();
    const t = await context({ notifier, sessionLogs: createFakeSessionLogs(() => []) });
    await t.run('ping', '--notify');
    expect(notifier.shown).toEqual([
      'dawnping: Ping sent, but it is not in the session log, so it may not have counted.',
    ]);
  });

  it('notifies nothing without --notify', async () => {
    const notifier = createFakeNotifier();
    const t = await context({ notifier });
    await t.run('ping');
    expect(notifier.shown).toEqual([]);
  });

  it('mentions a notification that could not be shown', async () => {
    const t = await context({ notifier: createFakeNotifier(false) });
    expect((await t.run('ping', '--notify')).stderr).toBe(
      '(Could not show a desktop notification.)\n',
    );
  });
});
