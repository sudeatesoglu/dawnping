import { Command } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };

/**
 * Builds the command-line interface.
 *
 * Kept separate from the entry point so tests can run commands in-process
 * and capture their output without spawning a child process.
 */
export function createProgram(): Command {
  return new Command()
    .name('dawnping')
    .description(packageJson.description)
    .version(packageJson.version);
}
