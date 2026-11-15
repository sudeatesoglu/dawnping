import { describe, expect, it } from 'vitest';
import type { CommandRunner } from '../process.ts';
import { createMacNotifier, silentNotifier } from './macos.ts';

describe('createMacNotifier', () => {
  it('passes title and message as arguments, never as script code', async () => {
    const calls: (readonly string[])[] = [];
    const run: CommandRunner = async (_program, args) => {
      calls.push(args);
      return { code: 0, stdout: '', stderr: '' };
    };
    const message = 'say "hi" & do shell script "rm -rf ~"';
    expect(await createMacNotifier(run).notify('dawnping', message)).toBe(true);
    const [args] = calls;
    expect(args?.slice(-2)).toEqual(['dawnping', message]);
    expect(args?.filter((arg) => arg.includes('rm -rf'))).toEqual([message]);
  });

  it('reports a notification that could not be shown', async () => {
    const failing: CommandRunner = async () => ({ code: 1, stdout: '', stderr: 'error' });
    const missing: CommandRunner = async () => {
      throw new Error('spawn osascript ENOENT');
    };
    expect(await createMacNotifier(failing).notify('t', 'm')).toBe(false);
    expect(await createMacNotifier(missing).notify('t', 'm')).toBe(false);
    expect(await silentNotifier.notify('t', 'm')).toBe(false);
  });
});
