import type { Command } from 'commander';
import { effectiveTimeZone } from '../../core/config/resolve.ts';
import { type PingFailure, WINDOW_MS } from '../../core/pinger.ts';
import { formatTime, toLocalTime } from '../../core/time.ts';
import { loadOrFail } from '../config-file.ts';
import { type CliContext, CliError } from '../context.ts';

/** What to tell the user for each way a ping can fail. */
const HINTS: Record<PingFailure, string> = {
  'not-found': 'Install Claude Code, or make sure `claude` is on your PATH.',
  'not-logged-in': 'Log in to Claude Code first: run `claude` and follow the login steps.',
  timeout: 'Check your network connection and try again.',
  failed: 'Run `claude -p "hi"` yourself to see the full error.',
};

/** Shell-quotes an argument so the printed command can be pasted as is. */
function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
}

export function registerPingCommand(program: Command, ctx: CliContext): void {
  program
    .command('ping')
    .description('start the usage window now with one tiny message')
    .option('--dry-run', 'print what would run, without sending anything')
    .action(async (options: { dryRun?: boolean }) => {
      const { config } = await loadOrFail(ctx);
      const model = config.ping.model;

      if (options.dryRun) {
        const { command, directory } = ctx.pinger.describe(model);
        ctx.stdout(`Would run: ${command.map(quote).join(' ')}\n  in ${directory}\n`);
        return;
      }

      const result = await ctx.pinger.ping(model);
      if (!result.ok) {
        throw new CliError(`Ping failed: ${result.detail}.`, HINTS[result.failure]);
      }

      // The ping starts a window only if none was active, and this command
      // cannot tell yet; the planner checks the session logs for that.
      const seconds = (result.durationMs / 1000).toFixed(1);
      const timeZone = effectiveTimeZone(config, ctx.systemTimeZone);
      const reset =
        timeZone === undefined
          ? ''
          : `, resetting around ${formatTime(toLocalTime(ctx.clock.now() + WINDOW_MS, timeZone).minutes)}`;
      ctx.stdout(
        `Pinged ${model} in ${seconds}s.\n` +
          `If no usage window was active, one started now${reset}.\n`,
      );
    });
}
