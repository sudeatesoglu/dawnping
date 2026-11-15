import type { Notifier } from '../../core/notifier.ts';
import type { CommandRunner } from '../process.ts';

/**
 * macOS notifications through osascript. The title and message are passed
 * as script arguments (argv), never pasted into the AppleScript source, so
 * a quote in the text cannot turn into code.
 */
export function createMacNotifier(run: CommandRunner): Notifier {
  return {
    async notify(title, message) {
      try {
        const result = await run('osascript', [
          '-e',
          'on run argv',
          '-e',
          'display notification (item 2 of argv) with title (item 1 of argv)',
          '-e',
          'end run',
          title,
          message,
        ]);
        return result.code === 0;
      } catch {
        return false;
      }
    },
  };
}

/** For platforms without a notification adapter yet. */
export const silentNotifier: Notifier = { notify: async () => false };
