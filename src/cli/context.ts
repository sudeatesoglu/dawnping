import type { Paths } from '../adapters/paths.ts';

/**
 * Everything a command needs from the outside world.
 *
 * Commands receive this object instead of using `process`, the file system
 * locations or the terminal directly, so tests can run any command
 * in-process with a temporary directory and captured output.
 */
export interface CliContext {
  paths: Paths;
  stdout(text: string): void;
  stderr(text: string): void;
  /** Opens a file in the user's editor and resolves with its exit code. */
  openEditor(file: string): Promise<number>;
  /** Asks a yes/no question; only called when `interactive` is true. */
  confirm(question: string): Promise<boolean>;
  /** True when a person is at the terminal and can answer questions. */
  interactive: boolean;
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
