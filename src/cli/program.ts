import { Command, CommanderError } from 'commander';
import packageJson from '../../package.json' with { type: 'json' };
import { registerAgentCommands } from './commands/agent.ts';
import { registerConfigCommands } from './commands/config.ts';
import { registerDoctorCommand } from './commands/doctor.ts';
import { registerPingCommand } from './commands/ping.ts';
import { registerPlanCommand } from './commands/plan.ts';
import { registerProfileCommands } from './commands/profile.ts';
import { registerSkipCommands } from './commands/skip.ts';
import { registerTickCommand } from './commands/tick.ts';
import { type CliContext, CliError } from './context.ts';

/** Builds the command-line interface around the given context. */
export function createProgram(ctx: CliContext): Command {
  const program = new Command()
    .name('dawnping')
    .description(packageJson.description)
    .version(packageJson.version)
    .configureOutput({
      writeOut: (text) => ctx.stdout(text),
      writeErr: (text) => ctx.stderr(text),
    })
    // Throw instead of calling process.exit, for every subcommand too.
    .exitOverride();

  registerConfigCommands(program, ctx);
  registerProfileCommands(program, ctx);
  registerSkipCommands(program, ctx);
  registerPingCommand(program, ctx);
  registerPlanCommand(program, ctx);
  registerAgentCommands(program, ctx);
  registerTickCommand(program, ctx);
  registerDoctorCommand(program, ctx);
  return program;
}

/**
 * Runs the CLI and returns the exit code. Expected failures (CliError) are
 * printed without a stack trace; anything else is a bug and is rethrown.
 */
export async function runCli(args: readonly string[], ctx: CliContext): Promise<number> {
  try {
    await createProgram(ctx).parseAsync([...args], { from: 'user' });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    if (error instanceof CliError) {
      ctx.stderr(`${error.lines.map((line) => `${line}\n`).join('')}`);
      return 1;
    }
    throw error;
  }
}
