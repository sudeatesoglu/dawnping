import { mkdir } from 'node:fs/promises';
import { PING_PROMPT, type Pinger, type PingResult } from '../../core/pinger.ts';
import type { CommandRunner } from '../process.ts';

export interface ClaudePingerOptions {
  /** The fixed, empty directory every ping runs in (ADR-0003). */
  directory: string;
  run: CommandRunner;
  /** Default 60 s; a ping normally takes a few seconds. */
  timeoutMs?: number;
  now?: () => number;
}

/** Claude Code's reply when no account is set up. */
const NOT_LOGGED_IN = /not logged in|please run \/login|\/login|invalid api key/i;

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? '';
}

/**
 * Pings by running `claude -p` from one fixed directory, so no project
 * context is loaded and every ping's log lands in the same project folder.
 */
export function createClaudePinger(options: ClaudePingerOptions): Pinger {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const now = options.now ?? Date.now;
  const args = (model: string) => ['-p', '--model', model, PING_PROMPT];

  return {
    describe: (model) => ({ command: ['claude', ...args(model)], directory: options.directory }),

    async ping(model): Promise<PingResult> {
      await mkdir(options.directory, { recursive: true, mode: 0o700 });
      const started = now();
      let result: Awaited<ReturnType<CommandRunner>>;
      try {
        result = await options.run('claude', args(model), { cwd: options.directory, timeoutMs });
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return { ok: false, failure: 'not-found', detail: 'claude is not on PATH' };
        }
        throw error;
      }

      if (result.timedOut) {
        return { ok: false, failure: 'timeout', detail: `no answer within ${timeoutMs / 1000}s` };
      }
      if (result.code !== 0) {
        const output = `${result.stderr}\n${result.stdout}`;
        return {
          ok: false,
          failure: NOT_LOGGED_IN.test(output) ? 'not-logged-in' : 'failed',
          detail:
            firstLine(result.stderr) || firstLine(result.stdout) || `exit code ${result.code}`,
        };
      }
      return { ok: true, durationMs: now() - started };
    },
  };
}
