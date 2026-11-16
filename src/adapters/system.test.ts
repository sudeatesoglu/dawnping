import { describe, expect, it } from 'vitest';
import type { CommandRunner } from './process.ts';
import { createSystemProbe } from './system.ts';

describe('createSystemProbe', () => {
  it('reads the claude version and the wake schedule', async () => {
    const calls: string[] = [];
    const run: CommandRunner = async (program, args) => {
      calls.push([program, ...args].join(' '));
      return {
        code: 0,
        stdout: program === 'claude' ? '2.1.325 (Claude Code)\n' : 'sched\n',
        stderr: '',
      };
    };
    const probe = createSystemProbe(run);
    expect(await probe.claudeVersion()).toBe('2.1.325 (Claude Code)');
    expect(await probe.wakeSchedule()).toBe('sched\n');
    expect(calls).toEqual(['claude --version', 'pmset -g sched']);
  });

  it('reports missing or failing commands as unknown', async () => {
    const missing: CommandRunner = async () => {
      throw new Error('spawn ENOENT');
    };
    const failing: CommandRunner = async () => ({ code: 1, stdout: '', stderr: 'no' });
    expect(await createSystemProbe(missing).claudeVersion()).toBeUndefined();
    expect(await createSystemProbe(failing).wakeSchedule()).toBeUndefined();
  });
});
