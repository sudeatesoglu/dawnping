/**
 * Port: sends the smallest possible message that starts the usage window.
 * See ADR-0003 for how a headless ping behaves.
 */

/** Short and fixed: the reply does not matter, only that a message was sent. */
export const PING_PROMPT = 'Reply with the single word: ok';

/** How long a usage window lasts once a message starts it. */
export const WINDOW_MS = 5 * 60 * 60 * 1000;

export type PingFailure =
  /** The `claude` command is not on PATH. */
  | 'not-found'
  /** Claude Code is not logged in. */
  | 'not-logged-in'
  /** No answer within the time limit. */
  | 'timeout'
  /** Any other non-zero exit. */
  | 'failed';

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
