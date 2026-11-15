import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import { createTestContext } from './test-context.ts';

let t: Awaited<ReturnType<typeof createTestContext>>;

beforeEach(async () => {
  t = await createTestContext();
});

afterEach(async () => {
  await t.cleanup();
});

describe('dawnping CLI', () => {
  it('prints the package version', async () => {
    expect(await t.run('--version')).toEqual({
      code: 0,
      stdout: `${packageJson.version}\n`,
      stderr: '',
    });
  });

  it('prints help with the program name and commands', async () => {
    const { stdout, code } = await t.run('--help');
    expect(code).toBe(0);
    expect(stdout).toContain('Usage: dawnping');
    expect(stdout).toContain('config');
    expect(stdout).toContain('profile');
  });

  it('rejects unknown options', async () => {
    const { code, stderr } = await t.run('--nope');
    expect(code).toBe(1);
    expect(stderr).toContain("unknown option '--nope'");
  });
});
