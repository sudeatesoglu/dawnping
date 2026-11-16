import type { SystemProbe } from '../core/system.ts';
import type { CommandRunner } from './process.ts';

/** Runs read-only system commands. Nothing here talks to Claude's servers. */
export function createSystemProbe(run: CommandRunner): SystemProbe {
  const output = async (program: string, args: string[]) => {
    try {
      const result = await run(program, args, { timeoutMs: 10_000 });
      return result.code === 0 ? result.stdout : undefined;
    } catch {
      return undefined;
    }
  };
  return {
    claudeVersion: async () => (await output('claude', ['--version']))?.trim().split('\n')[0],
    wakeSchedule: () => output('pmset', ['-g', 'sched']),
  };
}
