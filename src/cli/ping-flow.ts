import type { PingFailure, PingOutcome } from '../core/pinger.ts';
import { findPingEntry, LOG_TOLERANCE_MS } from '../core/session-logs.ts';
import type { CliContext } from './context.ts';

export type { PingOutcome };

export type PingReport =
  | {
      outcome: 'verified' | 'unverified';
      startedAt: number;
      durationMs: number;
      /** The project folder the ping should be logged in. */
      logFolder: string;
    }
  | {
      outcome: PingFailure;
      startedAt: number;
      /** The first line of the error. */
      detail: string;
    };

/** What to tell the user at the terminal for each way a ping can fail. */
export const HINTS: Record<PingFailure, string> = {
  'not-found': 'Install Claude Code, or make sure `claude` is on your PATH.',
  'not-logged-in': 'Log in to Claude Code first: run `claude` and follow the login steps.',
  'limit-reached': 'No ping can start a window until the limit resets.',
  timeout: 'Check your network connection and try again.',
  failed: 'Run `claude -p "hi"` yourself to see the full error.',
};

/**
 * Notification texts. Fixed strings only: a notification can be seen by
 * anyone near the screen, so no error details, paths or prompts.
 */
export const NOTIFICATIONS: Record<PingOutcome, string> = {
  verified: 'Ping sent and confirmed in the session log.',
  unverified: 'Ping sent, but it is not in the session log, so it may not have counted.',
  'not-found': 'Ping failed: the claude command was not found.',
  'not-logged-in': 'Ping failed: Claude Code is not logged in.',
  'limit-reached': 'No ping today: a usage limit is reached.',
  timeout: 'Ping failed: no answer in time.',
  failed: 'Ping failed.',
};

/** Claude Code may write the log a moment after `claude -p` exits. */
const VERIFY_ATTEMPTS = 5;
const VERIFY_INTERVAL_MS = 200;

/**
 * Pings and checks the session log for the ping's answer. Shared by the
 * `ping` command and the background `tick`, so both decide the same way
 * whether a ping counted.
 */
export async function pingAndVerify(ctx: CliContext, model: string): Promise<PingReport> {
  const startedAt = ctx.clock.now();
  const result = await ctx.pinger.ping(model);
  if (!result.ok) return { outcome: result.failure, startedAt, detail: result.detail };

  const report = { startedAt, durationMs: result.durationMs, logFolder: result.logFolder };
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
    const entries = await ctx.sessionLogs.entriesSince(
      startedAt - LOG_TOLERANCE_MS,
      result.logFolder,
    );
    if (findPingEntry(entries, result.logFolder, startedAt)) {
      return { outcome: 'verified', ...report };
    }
    if (attempt < VERIFY_ATTEMPTS) await ctx.sleep(VERIFY_INTERVAL_MS);
  }
  return { outcome: 'unverified', ...report };
}
