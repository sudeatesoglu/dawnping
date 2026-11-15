import type { Command } from 'commander';
import { effectiveTimeZone } from '../../core/config/resolve.ts';
import { WINDOW_MS } from '../../core/pinger.ts';
import { formatTime, toLocalTime } from '../../core/time.ts';
import { loadOrFail } from '../config-file.ts';
import { type CliContext, CliError } from '../context.ts';
import {
  HINTS,
  NOTIFICATIONS,
  type PingOutcome,
  type PingReport,
  pingAndVerify,
} from '../ping-flow.ts';

/** Shell-quotes an argument so the printed command can be pasted as is. */
function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
}

export function registerPingCommand(program: Command, ctx: CliContext): void {
  program
    .command('ping')
    .description('start the usage window now with one tiny message')
    .option('--dry-run', 'print what would run, without sending anything')
    .option('--notify', 'also show the result as a desktop notification')
    .action(async (options: { dryRun?: boolean; notify?: boolean }) => {
      const { config } = await loadOrFail(ctx);
      const model = config.ping.model;

      if (options.dryRun) {
        const { command, directory } = ctx.pinger.describe(model);
        ctx.stdout(`Would run: ${command.map(quote).join(' ')}\n  in ${directory}\n`);
        return;
      }

      const notify = async (outcome: PingOutcome) => {
        if (options.notify && !(await ctx.notifier.notify('dawnping', NOTIFICATIONS[outcome]))) {
          ctx.stderr('(Could not show a desktop notification.)\n');
        }
      };

      let report: PingReport;
      try {
        report = await pingAndVerify(ctx, model);
      } catch (error) {
        // An unexpected error must still reach a user who is not watching.
        await notify('failed');
        throw error;
      }
      await notify(report.outcome);

      if ('detail' in report) {
        throw new CliError(`Ping failed: ${report.detail}.`, HINTS[report.outcome]);
      }

      // The ping starts a window only if none was active, and this command
      // cannot tell; `tick` checks the session logs for that before pinging.
      const seconds = (report.durationMs / 1000).toFixed(1);
      const timeZone = effectiveTimeZone(config, ctx.systemTimeZone);
      const reset =
        timeZone === undefined
          ? ''
          : `, resetting around ${formatTime(toLocalTime(report.startedAt + WINDOW_MS, timeZone).minutes)}`;
      ctx.stdout(
        `Pinged ${model} in ${seconds}s.\n` +
          `If no usage window was active, one started now${reset}.\n`,
      );

      if (report.outcome === 'verified') {
        ctx.stdout('Confirmed: Claude Code logged the ping.\n');
        return;
      }
      // A ping that is not in the session log may not have counted toward
      // the subscription (e.g. billed elsewhere, or Claude Code changed).
      throw new CliError(
        "The ping is not in Claude Code's session log, so it may not have counted.",
        (await ctx.sessionLogs.available())
          ? `Expected it in ${ctx.paths.claudeProjectsDir}/${report.logFolder}`
          : `No session logs found at ${ctx.paths.claudeProjectsDir}. Set CLAUDE_CONFIG_DIR if Claude Code keeps them elsewhere.`,
      );
    });
}
