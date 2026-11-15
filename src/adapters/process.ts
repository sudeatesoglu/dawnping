import { execFile } from 'node:child_process';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a program with arguments (no shell) and reports how it ended. */
export type CommandRunner = (program: string, args: readonly string[]) => Promise<CommandResult>;

/**
 * The real runner. Never rejects on a non-zero exit: callers decide what a
 * failure means (for `launchctl print`, "not loaded" is a normal answer).
 */
export const runCommand: CommandRunner = (program, args) =>
  new Promise((resolve, reject) => {
    execFile(program, [...args], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') {
        // The program could not be started at all (e.g. ENOENT).
        reject(error);
        return;
      }
      resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
    });
  });
