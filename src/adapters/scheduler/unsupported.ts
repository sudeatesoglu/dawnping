import type { Scheduler } from '../../core/scheduler.ts';

/** Used on platforms without a scheduler adapter yet. */
export function createUnsupportedScheduler(platform: string): Scheduler {
  const fail = async (): Promise<never> => {
    throw new Error(`background mode is only available on macOS for now (this is ${platform})`);
  };
  return { location: '(none)', install: fail, uninstall: fail, isInstalled: async () => false };
}
