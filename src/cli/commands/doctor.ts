import { join } from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../adapters/config-store.ts';
import { readTextFile } from '../../adapters/file-store.ts';
import { effectiveTimeZone } from '../../core/config/resolve.ts';
import type { Config } from '../../core/config/schema.ts';
import { earliestPing, nextPing } from '../../core/next-ping.ts';
import { parseState } from '../../core/state.ts';
import { formatTime, toLocalTime } from '../../core/time.ts';
import { parseRepeatingWakes, wakeCommand, wakeCovers } from '../../core/wake.ts';
import { type CliContext, CliError } from '../context.ts';

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

/** The agent normally runs every 5 minutes while the Mac is awake. */
const STALE_TICK_MS = 15 * 60_000;

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** The time and text of the last line in tick.log, if any. */
async function lastTick(stateDir: string): Promise<{ at: number; text: string } | undefined> {
  const log = await readTextFile(join(stateDir, 'tick.log'));
  const line = log?.trimEnd().split('\n').at(-1);
  const match = line === undefined ? null : /^(\S+) (.*)$/.exec(line);
  const at = match?.[1] === undefined ? Number.NaN : Date.parse(match[1]);
  return match?.[2] === undefined || Number.isNaN(at) ? undefined : { at, text: match[2] };
}

/**
 * Checks everything dawnping depends on and says how to fix what is wrong.
 * Read-only, and it never sends a message to Claude.
 */
async function runChecks(ctx: CliContext): Promise<Check[]> {
  const checks: Check[] = [];
  const now = ctx.clock.now();

  const version = await ctx.system.claudeVersion();
  checks.push(
    version === undefined
      ? {
          name: 'claude',
          status: 'fail',
          detail: 'the claude command was not found',
          fix: 'install Claude Code, or make sure `claude` is on your PATH',
        }
      : { name: 'claude', status: 'ok', detail: version },
  );

  const loaded = await loadConfig(ctx.paths.configFile);
  let config: Config | undefined;
  if (!loaded.ok) {
    checks.push({
      name: 'config',
      status: 'fail',
      detail: `invalid: ${loaded.errors[0]}`,
      fix: 'dawnping config edit',
    });
  } else {
    config = loaded.config;
    const profiles = Object.keys(config.profiles).length;
    checks.push(
      profiles === 0
        ? {
            name: 'config',
            status: 'warn',
            detail: 'no profiles: every day is a rest day, so dawnping never pings',
            fix: 'dawnping profile add <name> --days mon,tue,wed,thu,fri --work 09:00-18:00',
          }
        : {
            name: 'config',
            status: 'ok',
            detail: `${loaded.source === 'file' ? 'valid' : 'defaults (no config file yet)'}, ${profiles} profile${profiles === 1 ? '' : 's'}`,
          },
    );
  }

  const timeZone = config === undefined ? undefined : effectiveTimeZone(config, ctx.systemTimeZone);
  if (config !== undefined) {
    checks.push(
      timeZone === undefined
        ? {
            name: 'time zone',
            status: 'fail',
            detail: `"${ctx.systemTimeZone}" is not an IANA zone`,
            fix: 'dawnping config set timezone <zone>, e.g. Europe/Istanbul',
          }
        : { name: 'time zone', status: 'ok', detail: timeZone },
    );
  }

  const next =
    config === undefined || timeZone === undefined ? undefined : nextPing(config, now, timeZone);
  if (config !== undefined && timeZone !== undefined) {
    checks.push(
      next === undefined
        ? { name: 'next ping', status: 'warn', detail: 'none planned in the coming week' }
        : {
            name: 'next ping',
            status: 'ok',
            detail: `${next.date} (${next.weekday}) at ${formatTime(next.minutes)}`,
          },
    );
  }

  let installed: boolean | undefined;
  try {
    installed = await ctx.scheduler.isInstalled();
  } catch (error) {
    checks.push({
      name: 'agent',
      status: 'warn',
      detail: `could not check: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  if (installed === false) {
    checks.push({
      name: 'agent',
      status: 'warn',
      detail: 'not installed: dawnping only pings when you run it yourself',
      fix: 'dawnping install',
    });
  } else if (installed === true) {
    const tick = await lastTick(ctx.paths.stateDir);
    if (tick === undefined) {
      checks.push({ name: 'agent', status: 'warn', detail: 'installed, but it has not run yet' });
    } else if (now - tick.at > STALE_TICK_MS) {
      checks.push({
        name: 'agent',
        status: 'warn',
        detail: `installed, but its last run was ${ago(now - tick.at)}`,
        fix: 'dawnping uninstall && dawnping install',
      });
    } else {
      checks.push({
        name: 'agent',
        status: 'ok',
        detail: `runs every 5 minutes; last run ${ago(now - tick.at)}: ${tick.text}`,
      });
    }
  }

  checks.push(
    (await ctx.sessionLogs.available())
      ? { name: 'session logs', status: 'ok', detail: 'readable' }
      : {
          name: 'session logs',
          status: 'fail',
          detail: `not found at ${ctx.paths.claudeProjectsDir}`,
          fix: 'set CLAUDE_CONFIG_DIR if Claude Code keeps its files elsewhere',
        },
  );

  checks.push(
    lastPingCheck(parseState(await readTextFile(join(ctx.paths.stateDir, 'state.json'))), timeZone),
  );

  const wakeCheck = await wakeScheduleCheck(ctx, config, next);
  if (wakeCheck) checks.push(wakeCheck);
  return checks;
}

function lastPingCheck(state: ReturnType<typeof parseState>, timeZone: string | undefined): Check {
  const last = state.lastPing;
  if (last === undefined) {
    return {
      name: 'last ping',
      status: 'warn',
      detail: 'none yet',
      fix: 'dawnping ping sends one tiny message to check that pinging works',
    };
  }
  const when = `${last.date}${timeZone ? ` ${formatTime(toLocalTime(last.at, timeZone).minutes)}` : ''}`;
  const tries = last.attempts > 1 ? ` after ${last.attempts} attempts` : '';
  switch (last.outcome) {
    case 'verified':
      return { name: 'last ping', status: 'ok', detail: `${when}, confirmed in the session log` };
    case 'unverified':
      return {
        name: 'last ping',
        status: 'warn',
        detail: `${when}, sent but not found in the session log, so it may not have counted`,
      };
    case 'timeout':
      return {
        name: 'last ping',
        status: 'warn',
        detail: `${when}, no answer in time${tries}`,
        fix: 'the Mac needs an internet connection at ping time',
      };
    case 'pending':
      return {
        name: 'last ping',
        status: 'warn',
        detail: `${when}, interrupted before it finished`,
      };
    case 'not-logged-in':
      return {
        name: 'last ping',
        status: 'fail',
        detail: `${when}, Claude Code is not logged in`,
        fix: 'run `claude` and log in',
      };
    case 'not-found':
      return {
        name: 'last ping',
        status: 'fail',
        detail: `${when}, the claude command was not found`,
        fix: 'install Claude Code, or make sure `claude` is on your PATH',
      };
    default:
      return {
        name: 'last ping',
        status: 'fail',
        detail: `${when}, failed${tries}`,
        fix: 'run `dawnping ping` to see the error',
      };
  }
}

/**
 * A sleeping Mac cannot ping. Checks that a repeating wake brings it up
 * shortly before the next ping, and otherwise shows the command for it.
 */
async function wakeScheduleCheck(
  ctx: CliContext,
  config: Config | undefined,
  next: ReturnType<typeof nextPing> | undefined,
): Promise<Check | undefined> {
  const schedule = await ctx.system.wakeSchedule();
  if (schedule === undefined || config === undefined || next === undefined) return undefined;
  const earliest = earliestPing(config) ?? next.minutes;
  const days = [...new Set(Object.values(config.profiles).flatMap((p) => p.days))];
  const fix = `${wakeCommand(earliest, days)}   (undo: sudo pmset repeat cancel)`;
  const wakes = parseRepeatingWakes(schedule);
  if (wakeCovers(wakes, next.weekday, next.minutes)) {
    const unknownDays = wakes.some((w) => w.days === 'unknown');
    return {
      name: 'wake',
      status: 'ok',
      detail: `the Mac wakes before the ${formatTime(next.minutes)} ping${unknownDays ? ' (days not checked)' : ''}`,
    };
  }
  return {
    name: 'wake',
    status: 'warn',
    detail: `the Mac is not set to wake before the ${formatTime(next.minutes)} ping; if it sleeps then, the ping waits until you wake it`,
    fix,
  };
}

const LABELS: Record<Status, string> = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };

export function registerDoctorCommand(program: Command, ctx: CliContext): void {
  program
    .command('doctor')
    .description('check that everything dawnping needs is in place')
    .action(async () => {
      const checks = await runChecks(ctx);
      const width = Math.max(...checks.map((c) => c.name.length));
      for (const check of checks) {
        ctx.stdout(`${LABELS[check.status]}  ${check.name.padEnd(width)}  ${check.detail}\n`);
        if (check.fix) ctx.stdout(`${' '.repeat(width + 8)}fix: ${check.fix}\n`);
      }
      const failures = checks.filter((c) => c.status === 'fail').length;
      const warnings = checks.filter((c) => c.status === 'warn').length;
      if (failures > 0) {
        throw new CliError(
          `${failures} problem${failures === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.`,
        );
      }
      ctx.stdout(
        warnings === 0
          ? 'Everything looks good.\n'
          : `No problems, ${warnings} warning${warnings === 1 ? '' : 's'}.\n`,
      );
    });
}
