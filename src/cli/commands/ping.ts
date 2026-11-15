import type { Command } from 'commander';
import { effectiveTimeZone } from '../../core/config/resolve.ts';
import { type PingFailure, WINDOW_MS } from '../../core/pinger.ts';
import { findPingEntry, LOG_TOLERANCE_MS } from '../../core/session-logs.ts';
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

/**
 * Notification texts. Fixed strings only: a notification can be seen by
 * anyone near the screen, so no error details, paths or prompts.
 */
const NOTIFICATIONS: Record<PingFailure | 'verified' | 'unverified', string> = {
  verified: 'Ping sent and confirmed in the session log.',
  unverified: 'Ping sent, but it is not in the session log, so it may not have counted.',
  'not-found': 'Ping failed: the claude command was not found.',
  'not-logged-in': 'Ping failed: Claude Code is not logged in.',
  timeout: 'Ping failed: no answer in time.',
  failed: 'Ping failed.',
};

/** Claude Code may write the log a moment after `claude -p` exits. */
const VERIFY_ATTEMPTS = 5;
const VERIFY_INTERVAL_MS = 200;

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

      const notify = async (outcome: keyof typeof NOTIFICATIONS) => {
        if (options.notify && !(await ctx.notifier.notify('dawnping', NOTIFICATIONS[outcome]))) {
          ctx.stderr('(Could not show a desktop notification.)\n');
        }
      };

      let notified = false;
      try {
        const startedAt = ctx.clock.now();
        const result = await ctx.pinger.ping(model);
        if (!result.ok) {
          notified = true;
          await notify(result.failure);
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

        // A ping that is not in the session log may not have counted toward
        // the subscription (e.g. billed elsewhere, or Claude Code changed).
        for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt++) {
          const entries = await ctx.sessionLogs.entriesSince(
            startedAt - LOG_TOLERANCE_MS,
            result.logFolder,
          );
          if (findPingEntry(entries, result.logFolder, startedAt)) {
            notified = true;
            await notify('verified');
            ctx.stdout('Confirmed: Claude Code logged the ping.\n');
            return;
          }
          if (attempt < VERIFY_ATTEMPTS) await ctx.sleep(VERIFY_INTERVAL_MS);
        }

        notified = true;
        await notify('unverified');
        throw new CliError(
          "The ping is not in Claude Code's session log, so it may not have counted.",
          (await ctx.sessionLogs.available())
            ? `Expected it in ${ctx.paths.claudeProjectsDir}/${result.logFolder}`
            : `No session logs found at ${ctx.paths.claudeProjectsDir}. Set CLAUDE_CONFIG_DIR if Claude Code keeps them elsewhere.`,
        );
      } catch (error) {
        // An unexpected error must still reach a user who is not watching.
        if (!notified) await notify('failed');
        throw error;
      }
    });
}
