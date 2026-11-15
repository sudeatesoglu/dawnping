import { afterEach, describe, expect, it } from 'vitest';
import { createFakePinger, createTestContext } from '../test-context.ts';

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
        'If no usage window was active, one started now, resetting around 14:00.\n',
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
      'Pinged haiku in 2.1s.\nIf no usage window was active, one started now.\n',
    );
  });
});
