import { CommanderError } from 'commander';
import { describe, expect, it } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import { createProgram } from './program.ts';

/** Runs the CLI in-process and returns what it printed. */
function run(args: string[]): { stdout: string; exitCode: number } {
  let stdout = '';
  const program = createProgram()
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        stdout += text;
      },
      writeErr: () => {},
    });

  try {
    program.parse(args, { from: 'user' });
    return { stdout, exitCode: 0 };
  } catch (error) {
    if (error instanceof CommanderError) {
      return { stdout, exitCode: error.exitCode };
    }
    throw error;
  }
}

describe('dawnping CLI', () => {
  it('prints the package version', () => {
    expect(run(['--version'])).toEqual({ stdout: `${packageJson.version}\n`, exitCode: 0 });
  });

  it('prints help with the program name', () => {
    const { stdout, exitCode } = run(['--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('Usage: dawnping');
  });

  it('rejects unknown options', () => {
    expect(run(['--nope']).exitCode).toBe(1);
  });
});
