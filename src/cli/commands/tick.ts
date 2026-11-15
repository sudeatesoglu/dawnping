import { join } from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../adapters/config-store.ts';
import { readTextFile, writeFileAtomic } from '../../adapters/file-store.ts';
import { acquireLock } from '../../adapters/lock.ts';
import { rotateLog } from '../../adapters/log-rotation.ts';
import { effectiveTimeZone } from '../../core/config/resolve.ts';
import { WINDOW_MS } from '../../core/pinger.ts';
import { activeWindowEnd, decideTick, MAX_ATTEMPTS_PER_DAY } from '../../core/planner/tick.ts';
import { parseState, type State } from '../../core/state.ts';
import { type CliContext, CliError } from '../context.ts';
import { NOTIFICATIONS, pingAndVerify } from '../ping-flow.ts';

/** tick.log is rotated above this size (a quiet day adds about 20 KB). */
const MAX_LOG_BYTES = 512 * 1024;

/** How far back the session logs are read to rebuild the window chain. */
const HISTORY_MS = 2 * WINDOW_MS;

/**
 * Run by the background agent every few minutes: decides whether to ping
 * now, pings, verifies and records the result. Writes one log line per
 * run. Exit code 1 when something needs the user's attention.
 */
export function registerTickCommand(program: Command, ctx: CliContext): void {
  program
    .command('tick', { hidden: true })
    .description('internal: run by the background agent')
    .action(async () => {
      const stamp = (text: string) => `${new Date(ctx.clock.now()).toISOString()} ${text}`;
      const log = (text: string) => ctx.stdout(`${stamp(text)}\n`);
      // Printed by runCli with exit code 1. launchd writes stdout and stderr
      // to the same log, so it is still one line in tick.log.
      const fail = (text: string) => new CliError(stamp(text));

      const statePath = join(ctx.paths.stateDir, 'state.json');
      await rotateLog(join(ctx.paths.stateDir, 'tick.log'), MAX_LOG_BYTES);
      const release = await acquireLock(join(ctx.paths.stateDir, 'tick.lock'));
      if (release === undefined) {
        log('another tick is running; skipped');
        return;
      }

      try {
        const loaded = await loadConfig(ctx.paths.configFile);
        if (!loaded.ok) {
          throw fail(
            `no ping: the config is invalid (${loaded.errors[0]}); run: dawnping config edit`,
          );
        }
        const { config } = loaded;
        const timeZone = effectiveTimeZone(config, ctx.systemTimeZone);
        if (timeZone === undefined) {
          throw fail('no ping: no usable time zone; run: dawnping config set timezone <zone>');
        }

        const now = ctx.clock.now();
        const state = parseState(await readTextFile(statePath));
        const answers = await ctx.sessionLogs.entriesSince(now - HISTORY_MS);
        const decision = decideTick({
          config,
          now,
          timeZone,
          state,
          activeWindowEnd: activeWindowEnd(
            answers.map((entry) => entry.timestamp),
            now,
          ),
        });
        if (decision.action === 'wait') {
          log(`no ping: ${decision.reason}`);
          return;
        }

        const report = await pingAndVerify(ctx, decision.model);
        const previous = state.lastPing?.date === decision.date ? state.lastPing.attempts : 0;
        const attempts = previous + 1;
        const next: State = {
          version: 1,
          lastPing: {
            date: decision.date,
            at: report.startedAt,
            outcome: report.outcome,
            attempts,
          },
        };
        await writeFileAtomic(statePath, `${JSON.stringify(next, null, 2)}\n`);

        if (report.outcome === 'verified') {
          log(`pinged ${decision.model} at ${decision.reason}: confirmed in the session log`);
          return;
        }
        const detail = report.detail ? ` (${report.detail})` : '';
        const giveUp =
          report.outcome !== 'unverified' && attempts >= MAX_ATTEMPTS_PER_DAY
            ? `; giving up for today after ${attempts} attempts`
            : '';
        await ctx.notifier.notify('dawnping', NOTIFICATIONS[report.outcome]);
        throw fail(
          `pinged ${decision.model} at ${decision.reason}: ${report.outcome}${detail}${giveUp}`,
        );
      } catch (error) {
        if (error instanceof CliError) throw error;
        // Nobody watches the terminal: say so in the log and on the screen.
        await ctx.notifier.notify('dawnping', NOTIFICATIONS.failed);
        throw fail(`error: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await release();
      }
    });
}
