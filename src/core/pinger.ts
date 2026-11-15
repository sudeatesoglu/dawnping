/**
 * Port: sends the smallest possible message that starts the usage window.
 * See ADR-0003 for how a headless ping behaves.
 */

/** Short and fixed: the reply does not matter, only that a message was sent. */
export const PING_PROMPT = 'Reply with the single word: ok';

/** How long a usage window lasts once a message starts it. */
export const WINDOW_MS = 5 * 60 * 60 * 1000;

/**
 * How a ping can fail:
 * - not-found: the `claude` command is not on PATH
 * - not-logged-in: Claude Code is not logged in
 * - timeout: no answer within the time limit
 * - failed: any other non-zero exit
 *
 * One list, so the state file and the CLI never disagree about the kinds.
 */
export const PING_FAILURES = ['not-found', 'not-logged-in', 'timeout', 'failed'] as const;
export type PingFailure = (typeof PING_FAILURES)[number];

/** Every way a ping attempt can end. */
export const PING_OUTCOMES = ['verified', 'unverified', ...PING_FAILURES] as const;
export type PingOutcome = (typeof PING_OUTCOMES)[number];

export type PingResult =
  | {
      ok: true;
      durationMs: number;
      /** The project folder Claude Code logs this ping in (ADR-0003). */
      logFolder: string;
    }
  | { ok: false; failure: PingFailure; detail: string };

export interface Pinger {
  ping(model: string): Promise<PingResult>;
  /** The exact command and directory, for --dry-run and messages. */
  describe(model: string): { command: string[]; directory: string };
}
