import { join } from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../adapters/config-store.ts';
import { readTextFile, writeFileAtomic } from '../../adapters/file-store.ts';
import { acquireLock } from '../../adapters/lock.ts';
import { rotateLog } from '../../adapters/log-rotation.ts';
import { effectiveTimeZone } from '../../core/config/resolve.ts';
import {
  activeWindowEnd,
  decideTick,
  MAX_ATTEMPTS_PER_DAY,
  type TickInput,
} from '../../core/planner/tick.ts';
import { type PingRecord, parseState, type State } from '../../core/state.ts';
import { type CliContext, CliError } from '../context.ts';
import { NOTIFICATIONS, pingAndVerify } from '../ping-flow.ts';

/** tick.log is rotated above this size (a quiet day adds about 20 KB). */
const MAX_LOG_BYTES = 512 * 1024;

/**
 * How far back the session logs are read to rebuild the window chain. Long
 * enough to usually contain a 5-hour gap that anchors it exactly.
 */
const HISTORY_MS = 24 * 60 * 60 * 1000;

/**
 * Run by the background agent every few minutes: decides whether to ping
 * now, pings, verifies and records the result. Writes one log line per
 * run; problems exit 1 and, since nobody watches the terminal, also show
 * a desktop notification.
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
      const saveState = (lastPing: PingRecord) =>
        writeFileAtomic(
          statePath,
          `${JSON.stringify({ version: 1, lastPing } satisfies State, null, 2)}\n`,
        );

      let release: (() => Promise<void>) | undefined;
      try {
        await rotateLog(join(ctx.paths.stateDir, 'tick.log'), MAX_LOG_BYTES);
        release = await acquireLock(join(ctx.paths.stateDir, 'tick.lock'));
        if (release === undefined) {
          log('another tick is running; skipped');
          return;
        }

        const loaded = await loadConfig(ctx.paths.configFile);
        if (!loaded.ok) {
          throw fail(
            `no ping: the config is invalid (${loaded.errors[0]}); run: dawnping config edit`,
          );
        }
        const timeZone = effectiveTimeZone(loaded.config, ctx.systemTimeZone);
        if (timeZone === undefined) {
          throw fail('no ping: no usable time zone; run: dawnping config set timezone <zone>');
        }

        const now = ctx.clock.now();
        const input: TickInput = {
          config: loaded.config,
          now,
          timeZone,
          state: parseState(await readTextFile(statePath)),
          activeWindowEnd: 'unchecked',
        };
        let decision = decideTick(input);
        if (decision.action === 'check-window') {
          // Only now are the session logs worth reading.
          const answers = await ctx.sessionLogs.entriesSince(now - HISTORY_MS);
          const end = activeWindowEnd(
            answers.map((entry) => entry.timestamp),
            now,
          );
          decision = decideTick({ ...input, activeWindowEnd: end });
        }
        if (decision.action !== 'ping') {
          log(`no ping: ${decision.action === 'wait' ? decision.reason : 'unknown'}`);
          return;
        }

        // Recorded before pinging: if this run dies, the attempt still counts
        // and the next tick does not ping again right away.
        const record = { date: decision.date, attempts: decision.attempt };
        await saveState({ ...record, at: now, outcome: 'pending' });
        const report = await pingAndVerify(ctx, decision.model);
        await saveState({
          ...record,
          at: report.startedAt,
          outcome: report.outcome,
          ...('detail' in report ? { detail: report.detail.slice(0, 300) } : {}),
        });

        const what = `pinged ${decision.model} at ${decision.reason}`;
        if (!('detail' in report)) {
          if (report.outcome === 'verified') {
            log(`${what}: confirmed in the session log`);
            return;
          }
          await ctx.notifier.notify('dawnping', NOTIFICATIONS.unverified);
          throw fail(`${what}: unverified, not in the session log`);
        }
        // Notify the first failure and the last one, not every retry. A
        // reached limit ends the day at once.
        const limit = report.outcome === 'limit-reached';
        const giveUp = limit || decision.attempt >= MAX_ATTEMPTS_PER_DAY;
        if (decision.attempt === 1 || giveUp) {
          await ctx.notifier.notify('dawnping', NOTIFICATIONS[report.outcome]);
        }
        const suffix = limit
          ? '; no more pings today'
          : giveUp
            ? `; giving up for today after ${decision.attempt} attempts`
            : '';
        throw fail(`${what}: ${report.outcome} (${report.detail})${suffix}`);
      } catch (error) {
        if (error instanceof CliError) throw error;
        await ctx.notifier.notify('dawnping', NOTIFICATIONS.failed);
        throw fail(`error: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await release?.();
      }
    });
}
