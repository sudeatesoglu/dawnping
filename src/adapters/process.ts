import { spawn } from 'node:child_process';

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
  /** Stop the program after this many milliseconds (SIGTERM, then SIGKILL). */
  timeoutMs?: number;
  /** The program's environment; defaults to this process's. */
  env?: Readonly<Record<string, string | undefined>>;
}

/** Runs a program with arguments (no shell) and reports how it ended. */
export type CommandRunner = (
  program: string,
  args: readonly string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

/** Output kept per stream; more is dropped instead of killing the program. */
const MAX_OUTPUT = 1024 * 1024;
/** Time a program gets to exit after SIGTERM before SIGKILL. */
const KILL_GRACE_MS = 2_000;

/**
 * The real runner. Never rejects because of how the program ended: callers
 * decide what a failure means (for `launchctl print`, "not loaded" is a
 * normal answer). Rejects only when the program cannot start (ENOENT).
 *
 * stdin is closed: tools such as `claude -p` read a non-terminal stdin and
 * would otherwise wait for input that never comes.
 */
export const runCommand: CommandRunner = (program, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(program, [...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });

    const output = { stdout: '', stderr: '' };
    const collect = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      if (output[stream].length < MAX_OUTPUT) {
        output[stream] += chunk.toString('utf8').slice(0, MAX_OUTPUT - output[stream].length);
      }
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeoutTimer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            // A program that ignores SIGTERM must not hang the caller.
            killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
          }, options.timeoutMs);

    const stopTimers = () => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
    };

    child.on('error', (error) => {
      stopTimers();
      reject(error);
    });
    const finish = (code: number | null) => {
      stopTimers();
      resolve({ code: code ?? -1, ...output, ...(timedOut || code === null ? { timedOut } : {}) });
    };
    // Normally wait for 'close', when all output has been read. After a
    // timeout, 'exit' is enough: a grandchild may still hold the pipes open.
    child.on('close', finish);
    child.on('exit', (code) => {
      if (timedOut) finish(code);
    });
  });
