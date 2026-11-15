import { execFile } from 'node:child_process';

export interface CommandResult {
  /** Exit code; -1 when the program was stopped by a signal. */
  code: number;
  stdout: string;
  stderr: string;
  /** True when the program was stopped because it ran past `timeoutMs`. */
  timedOut?: boolean;
}

export interface CommandOptions {
  cwd?: string;
  /** Stop the program (SIGTERM) after this many milliseconds. */
  timeoutMs?: number;
}

/** Runs a program with arguments (no shell) and reports how it ended. */
export type CommandRunner = (
  program: string,
  args: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

/**
 * The real runner. Never rejects because of how the program ended: callers
 * decide what a failure means (for `launchctl print`, "not loaded" is a
 * normal answer). Rejects only when the program cannot start (ENOENT).
 */
export const runCommand: CommandRunner = (program, args, options = {}) =>
  new Promise((resolve, reject) => {
    execFile(
      program,
      [...args],
      {
        encoding: 'utf8',
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
        } else if (typeof error.code === 'number') {
          resolve({ code: error.code, stdout, stderr });
        } else if (error.killed || error.signal) {
          resolve({
            code: -1,
            stdout,
            stderr,
            timedOut: Boolean(error.killed && options.timeoutMs),
          });
        } else {
          // The program could not be started at all (e.g. ENOENT).
          reject(error);
        }
      },
    );
  });
