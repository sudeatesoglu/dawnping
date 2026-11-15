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

  it('rejects when the program cannot start', async () => {
    await expect(runCommand('dawnping-no-such-program', [])).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
