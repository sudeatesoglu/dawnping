import { describe, expect, it } from 'vitest';
import { runCommand } from './process.ts';

describe('runCommand', () => {
  it('reports output and exit codes without rejecting', async () => {
    expect(await runCommand('sh', ['-c', 'echo out; echo err >&2; exit 3'])).toEqual({
      code: 3,
      stdout: 'out\n',
      stderr: 'err\n',
    });
    expect((await runCommand('true', [])).code).toBe(0);
  });

  it('passes arguments without a shell', async () => {
    expect((await runCommand('echo', ['$HOME; exit 7'])).stdout).toBe('$HOME; exit 7\n');
  });

  it('runs in the given directory', async () => {
    expect((await runCommand('pwd', [], { cwd: '/' })).stdout).toBe('/\n');
  });

  it('stops a program that runs past the timeout', async () => {
    expect(await runCommand('sleep', ['5'], { timeoutMs: 50 })).toMatchObject({
      code: -1,
      timedOut: true,
    });
  });

  it('reports a program stopped by a signal without a timeout', async () => {
    expect(await runCommand('sh', ['-c', 'kill -TERM $$'])).toMatchObject({
      code: -1,
      timedOut: false,
    });
  });

  it('rejects when the program cannot start', async () => {
    await expect(runCommand('dawnping-no-such-program', [])).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
