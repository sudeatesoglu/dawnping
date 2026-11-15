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
      stdout: 'Pinged sonnet in 2.1s. Your 5-hour window has started. It resets around 14:00.\n',
      stderr: '',
    });
    expect(pinger.pinged).toEqual(['sonnet']);
  });

  it('prints the command without running it on --dry-run', async () => {
    const pinger = createFakePinger();
    const t = await context({ pinger });
    expect((await t.run('ping', '--dry-run')).stdout).toBe(
      'Would run: claude -p --model haiku "Reply with the single word: ok"\n  in /state/ping\n',
    );
    expect(pinger.pinged).toEqual([]);
  });

  it.each([
    ['not-found', 'claude is not on PATH', 'Install Claude Code'],
    ['not-logged-in', 'Please run /login', 'Log in to Claude Code first'],
    ['timeout', 'no answer within 60s', 'Check your network connection'],
    ['failed', 'exit code 2', 'Run `claude -p "hi"` yourself'],
  ] as const)('explains a %s failure', async (failure, detail, hint) => {
    const t = await context({ pinger: createFakePinger({ ok: false, failure, detail }) });
    const result = await t.run('ping');
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(`Ping failed: ${detail}.\n${result.stderr.split('\n')[1]}\n`);
    expect(result.stderr).toContain(hint);
  });

  it('warns when an API key could take over billing', async () => {
    const t = await context({ env: { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-test' } });
    const result = await t.run('ping');
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('ANTHROPIC_API_KEY is set');
    expect(result.stderr).not.toContain('sk-test');
  });

  it('leaves out the reset time when no time zone is usable', async () => {
    const t = await context({ systemTimeZone: 'Etc/Unknown' });
    expect((await t.run('ping')).stdout).toBe(
      'Pinged haiku in 2.1s. Your 5-hour window has started.\n',
    );
  });
});
