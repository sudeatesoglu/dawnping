import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PING_PROMPT } from '../../core/pinger.ts';
import type { CommandOptions, CommandResult } from '../process.ts';
import { createClaudePinger } from './claude-cli.ts';

let dir: string;
let calls: { program: string; args: readonly string[]; options: CommandOptions | undefined }[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dawnping-pinger-'));
  calls = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A pinger whose `claude` answers with the given result (or error). */
function pinger(answer: CommandResult | Error) {
  let time = 1_000;
  return createClaudePinger({
    directory: join(dir, 'ping'),
    timeoutMs: 30_000,
    env: {
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_AUTH_TOKEN: 'token',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
    },
    now: () => {
      time += 1_500;
      return time;
    },
    run: async (program, args, options) => {
      calls.push({ program, args, options });
      if (answer instanceof Error) throw answer;
      return answer;
    },
  });
}

describe('createClaudePinger', () => {
  it('runs claude -p from the fixed ping directory', async () => {
    const result = await pinger({ code: 0, stdout: 'ok\n', stderr: '' }).ping('haiku');
    expect(result).toEqual({ ok: true, durationMs: 1_500 });
    expect(calls).toEqual([
      {
        program: 'claude',
        args: ['-p', '--model', 'haiku', PING_PROMPT],
        // Billing overrides are removed so the ping uses the subscription.
        options: { cwd: join(dir, 'ping'), timeoutMs: 30_000, env: { PATH: '/usr/bin' } },
      },
    ]);
    expect((await stat(join(dir, 'ping'))).mode & 0o777).toBe(0o700);
  });

  it('tightens an existing ping folder to 0700', async () => {
    await mkdir(join(dir, 'ping'), { mode: 0o755 });
    await pinger({ code: 0, stdout: '', stderr: '' }).ping('haiku');
    expect((await stat(join(dir, 'ping'))).mode & 0o777).toBe(0o700);
  });

  it('reports a ping folder that cannot be created', async () => {
    await writeFile(join(dir, 'ping'), 'not a folder');
    const result = await pinger({ code: 0, stdout: '', stderr: '' }).ping('haiku');
    expect(result).toMatchObject({ ok: false, failure: 'failed' });
    expect(result.ok || result.detail).toMatch(/^cannot use the ping folder: /);
    expect(calls).toEqual([]);
  });

  it('describes the command for --dry-run', () => {
    expect(pinger({ code: 0, stdout: '', stderr: '' }).describe('sonnet')).toEqual({
      command: ['claude', '-p', '--model', 'sonnet', PING_PROMPT],
      directory: join(dir, 'ping'),
    });
  });

  it('reports a missing claude command', async () => {
    const missing = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    expect(await pinger(missing).ping('haiku')).toEqual({
      ok: false,
      failure: 'not-found',
      detail: 'claude is not on PATH',
    });
  });

  it('rethrows unexpected start errors', async () => {
    const odd = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
    await expect(pinger(odd).ping('haiku')).rejects.toThrow('spawn EACCES');
  });

  it('reports a timeout', async () => {
    expect(
      await pinger({ code: -1, stdout: '', stderr: '', timedOut: true }).ping('haiku'),
    ).toEqual({ ok: false, failure: 'timeout', detail: 'no answer within 30s' });
  });

  it('recognizes a missing login', async () => {
    const result = await pinger({
      code: 1,
      stdout: 'Invalid API key · Please run /login\n',
      stderr: '',
    }).ping('haiku');
    expect(result).toEqual({
      ok: false,
      failure: 'not-logged-in',
      detail: 'Invalid API key · Please run /login',
    });
  });

  it('does not treat every mention of /login as a missing login', async () => {
    const result = await pinger({
      code: 1,
      stdout: '',
      stderr: 'Usage limit reached. Use /login to switch accounts.\n',
    }).ping('haiku');
    expect(result).toMatchObject({ failure: 'failed' });
  });

  it('reports other failures with the first line of the error', async () => {
    expect(
      await pinger({ code: 2, stdout: '', stderr: 'model not found: haikoo\nmore\n' }).ping(
        'haikoo',
      ),
    ).toEqual({ ok: false, failure: 'failed', detail: 'model not found: haikoo' });
    expect(await pinger({ code: 3, stdout: '', stderr: '' }).ping('haiku')).toMatchObject({
      detail: 'exit code 3',
    });
  });
});
