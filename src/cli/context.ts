import type { Paths } from '../adapters/paths.ts';
import type { Clock } from '../core/clock.ts';
import type { Pinger } from '../core/pinger.ts';
import type { Scheduler } from '../core/scheduler.ts';

/**
 * Everything a command needs from the outside world.
 *
 * Commands receive this object instead of using `process`, the file system
 * locations or the terminal directly, so tests can run any command
 * in-process with a temporary directory and captured output.
 */
export interface CliContext {
  paths: Paths;
  /** The current time; a fixed value in tests. */
  clock: Clock;
  /** The system's IANA time zone, used when the config sets none. */
  systemTimeZone: string;
  /** Sends the message that starts the usage window. */
  pinger: Pinger;
  /** Runs `dawnping tick` in the background (launchd on macOS). */
  scheduler: Scheduler;
  /**
   * How this CLI was started, resolved only when needed (install): node,
   * its flags (e.g. --import) and the real path of the script.
   */
  invocation(): Invocation;
  /** Environment variables, e.g. PATH for the background agent. */
  env: Readonly<Record<string, string | undefined>>;
  stdout(text: string): void;
  stderr(text: string): void;
  /** Opens a file in the user's editor and resolves with its exit code. */
  openEditor(file: string): Promise<number>;
  /** Asks a yes/no question; only called when `interactive` is true. */
  confirm(question: string): Promise<boolean>;
  /** True when a person is at the terminal and can answer questions. */
  interactive: boolean;
}

export interface Invocation {
  node: string;
  nodeArgs: string[];
  script: string;
}

/** An expected failure: printed as is, without a stack trace, exit code 1. */
export class CliError extends Error {
  readonly lines: readonly string[];

  constructor(...lines: string[]) {
    super(lines.join('\n'));
    this.name = 'CliError';
    this.lines = lines;
  }
}
