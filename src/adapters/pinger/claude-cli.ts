import { chmod, mkdir } from 'node:fs/promises';
import { PING_PROMPT, type Pinger, type PingResult } from '../../core/pinger.ts';
import type { CommandRunner } from '../process.ts';

export interface ClaudePingerOptions {
  /** The fixed, empty directory every ping runs in (ADR-0003). */
  directory: string;
  run: CommandRunner;
  /** The environment claude runs with (usually process.env). */
  env: Readonly<Record<string, string | undefined>>;
  /** Default 60 s; a ping normally takes a few seconds. */
  timeoutMs?: number;
  now?: () => number;
}

/** Claude Code's reply when no account is set up. */
const NOT_LOGGED_IN = /not logged in|please run \/login|invalid api key/i;

/**
 * With an API key in the environment, claude can bill the API instead of
 * the subscription, and then the ping does not start the usage window
 * (ADR-0003). The ping always uses the logged-in subscription.
 */
function subscriptionEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const { ANTHROPIC_API_KEY: _apiKey, ...rest } = env;
  return rest;
}

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
      try {
        await mkdir(options.directory, { recursive: true, mode: 0o700 });
        // mkdir only sets the mode on a folder it creates.
        await chmod(options.directory, 0o700);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { ok: false, failure: 'failed', detail: `cannot use the ping folder: ${reason}` };
      }

      const started = now();
      let result: Awaited<ReturnType<CommandRunner>>;
      try {
        result = await options.run('claude', args(model), {
          cwd: options.directory,
          timeoutMs,
          env: subscriptionEnvironment(options.env),
        });
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
