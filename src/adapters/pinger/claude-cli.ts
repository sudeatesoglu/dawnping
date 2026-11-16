import { chmod, mkdir, realpath } from 'node:fs/promises';
import { PING_PROMPT, type Pinger, type PingResult } from '../../core/pinger.ts';
import { projectFolderName } from '../../core/session-logs.ts';
import { errorCode } from '../errors.ts';
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
 * Claude Code's reply when a subscription usage limit is reached, e.g.
 * "You've hit your weekly limit · resets 4pm (Europe/Istanbul)", "You've
 * hit your limit", "5-hour limit reached". Deliberately narrow: a passing
 * API rate limit ("Rate limit reached for requests") is a normal failure
 * that is retried, not a reason to stop for the day.
 */
export const LIMIT_REACHED =
  /hit your (?:[\w-]+ ){0,3}limit|(?:5-hour|weekly|session|usage|daily) limit reached/i;

/**
 * The environment for the ping. Anything that could make claude bill
 * something other than the logged-in subscription is removed: API keys,
 * proxy tokens and base URLs (ANTHROPIC_*), and provider switches such as
 * Bedrock or Vertex (CLAUDE_CODE_USE_*), including ones added in later
 * Claude Code releases. A ping billed elsewhere does not start the usage
 * window (ADR-0003). The user's own claude sessions are not affected.
 *
 * A relative CLAUDE_CONFIG_DIR would resolve against the ping folder, not
 * the user's directory, so it is dropped (dawnping ignores it as well).
 */
export function subscriptionEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([name, value]) =>
        !name.startsWith('ANTHROPIC_') &&
        !name.startsWith('CLAUDE_CODE_USE_') &&
        !(name === 'CLAUDE_CONFIG_DIR' && !value?.startsWith('/')),
    ),
  );
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
      let logFolder: string;
      try {
        await mkdir(options.directory, { recursive: true, mode: 0o700 });
        // mkdir only sets the mode on a folder it creates.
        await chmod(options.directory, 0o700);
        // claude names the log folder after the real path (/tmp is /private/tmp).
        logFolder = projectFolderName(await realpath(options.directory));
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
        if (errorCode(error) === 'ENOENT') {
          return { ok: false, failure: 'not-found', detail: 'claude is not on PATH' };
        }
        throw error;
      }

      if (result.timedOut) {
        return { ok: false, failure: 'timeout', detail: `no answer within ${timeoutMs / 1000}s` };
      }
      const output = `${result.stderr}\n${result.stdout}`;
      // A limit message is a failure even if claude exited 0.
      if (result.code !== 0 || LIMIT_REACHED.test(output)) {
        return {
          ok: false,
          failure: LIMIT_REACHED.test(output)
            ? 'limit-reached'
            : NOT_LOGGED_IN.test(output)
              ? 'not-logged-in'
              : 'failed',
          detail:
            firstLine(result.stderr) || firstLine(result.stdout) || `exit code ${result.code}`,
        };
      }
      return { ok: true, durationMs: now() - started, logFolder };
    },
  };
}
