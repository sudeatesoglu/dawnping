import { join } from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../../adapters/config-store.ts';
import { readTextFile } from '../../adapters/file-store.ts';
import { effectiveTimeZone } from '../../core/config/resolve.ts';
import type { Config } from '../../core/config/schema.ts';
import { nextPlannedPing, pingTimes } from '../../core/next-ping.ts';
import { WINDOW_MS } from '../../core/pinger.ts';
import { activeWindowEnd, decideTick } from '../../core/planner/tick.ts';
import { TICK_INTERVAL_SECONDS } from '../../core/scheduler.ts';
import { parseState, type State } from '../../core/state.ts';
import { formatTime, toLocalTime } from '../../core/time.ts';
import { coveringWake, parseRepeatingWakes, wakeCommand } from '../../core/wake.ts';
import { type CliContext, CliError } from '../context.ts';

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  status: Status;
  detail: string;
  fix?: string;
}

const INTERVAL_MINUTES = TICK_INTERVAL_SECONDS / 60;
/** Three missed runs while the Mac is awake mean the agent is not running. */
const STALE_TICK_MS = 3 * TICK_INTERVAL_SECONDS * 1000;

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

function ago(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

type TickLog =
  | { kind: 'none' }
  | { kind: 'run'; at: number; text: string }
  /** The last line has no timestamp: usually node or launchd complaining. */
  | { kind: 'unreadable'; line: string; at?: number };

/**
 * The latest run in tick.log. Right after a rotation the current run
 * writes to tick.log.1, so that is read when tick.log does not exist.
 */
async function readTickLog(stateDir: string): Promise<TickLog> {
  const text =
    (await readTextFile(join(stateDir, 'tick.log'))) ??
    (await readTextFile(join(stateDir, 'tick.log.1')));
  const lines = text?.trimEnd().split('\n').filter(Boolean) ?? [];
  const stamped = (line: string) => {
    const match = /^(\S+) (.*)$/.exec(line);
    const at = match?.[1] === undefined ? Number.NaN : Date.parse(match[1]);
    return match?.[2] === undefined || Number.isNaN(at) ? undefined : { at, text: match[2] };
  };
  const last = lines.at(-1);
  if (last === undefined) return { kind: 'none' };
  const run = stamped(last);
  if (run) return { kind: 'run', ...run };
  const previous = [...lines].reverse().map(stamped).find(Boolean);
  return { kind: 'unreadable', line: last.slice(0, 160), ...(previous ? { at: previous.at } : {}) };
}

/** Runs a check; an unexpected error becomes a failed check, not a crash. */
async function guarded(
  name: string,
  check: () => Promise<Check | Check[] | undefined>,
): Promise<Check[]> {
  try {
    const result = await check();
    return result === undefined ? [] : [result].flat();
  } catch (error) {
    return [{ name, status: 'fail', detail: `could not check: ${reason(error)}` }];
  }
}

function claudeCheck(version: string | undefined): Check {
  return version === undefined
    ? {
        name: 'claude',
        status: 'fail',
        detail: 'the claude command was not found',
        fix: 'install Claude Code, or make sure `claude` is on your PATH',
      }
    : { name: 'claude', status: 'ok', detail: version };
}

/**
 * Today's status comes from decideTick itself, so doctor and the agent
 * can never disagree about late, retried or ineffective pings.
 */
async function pingCheck(
  ctx: CliContext,
  config: Config,
  timeZone: string,
  state: State,
): Promise<Check> {
  const now = ctx.clock.now();
  const input = { config, now, timeZone, state, activeWindowEnd: 'unchecked' as const };
  let decision = decideTick(input);
  if (decision.action === 'check-window') {
    const answers = await ctx.sessionLogs.entriesSince(now - 2 * WINDOW_MS);
    const end = activeWindowEnd(
      answers.map((entry) => entry.timestamp),
      now,
    );
    decision = decideTick({ ...input, activeWindowEnd: end });
  }
  if (decision.action !== 'wait') {
    return {
      name: 'today',
      status: 'ok',
      detail: 'a ping is due; the agent sends it on its next run',
    };
  }
  if (decision.reason.includes('has no effect')) {
    return {
      name: 'today',
      status: 'warn',
      detail: `no ping: ${decision.reason}`,
      fix: 'dawnping config set profiles.<name>.trigger auto   (see: dawnping plan)',
    };
  }
  const today = toLocalTime(now, timeZone).date;
  const next = nextPlannedPing(config, today);
  const after = next ? `; next: ${next.date} (${next.weekday}) at ${formatTime(next.minutes)}` : '';
  return { name: 'today', status: 'ok', detail: `${decision.reason}${after}` };
}

function agentCheck(ctx: CliContext, installed: boolean, log: TickLog): Check {
  const now = ctx.clock.now();
  if (!installed) {
    return {
      name: 'agent',
      status: 'warn',
      detail: 'not installed: dawnping only pings when you run it yourself',
      fix: 'dawnping install',
    };
  }
  if (log.kind === 'none')
    return { name: 'agent', status: 'warn', detail: 'installed, but it has not run yet' };
  if (log.kind === 'unreadable') {
    return {
      name: 'agent',
      status: 'fail',
      detail: `its last run wrote: ${log.line}`,
      fix: 'dawnping uninstall && dawnping install   (run it with the node you use now)',
    };
  }
  if (now - log.at > STALE_TICK_MS) {
    return {
      name: 'agent',
      status: 'warn',
      detail: `installed, but its last run was ${ago(now - log.at)}`,
      fix: 'dawnping uninstall && dawnping install',
    };
  }
  return {
    name: 'agent',
    status: 'ok',
    detail: `runs every ${INTERVAL_MINUTES} minutes; last run ${ago(now - log.at)}: ${log.text}`,
  };
}

function lastPingCheck(state: State, timeZone: string | undefined): Check {
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
  const why = last.detail ? `: ${last.detail}` : '';
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
    case 'limit-reached':
      return {
        name: 'last ping',
        status: 'warn',
        detail: `${when}, a usage limit was reached${why}`,
        fix: 'nothing to fix: pings resume after the limit resets (the weekly limit cannot be avoided)',
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
        detail: `${when}, failed${tries}${why}`,
        fix: 'run `dawnping ping` to see the error',
      };
  }
}

/**
 * A sleeping Mac cannot ping. pmset allows a single repeating wake, so the
 * check looks at every profile's ping time and says which are covered.
 */
function wakeCheck(schedule: string, config: Config): Check | undefined {
  const pings = pingTimes(config);
  const earliest = pings.reduce<(typeof pings)[number] | undefined>(
    (best, ping) => (best === undefined || ping.minutes < best.minutes ? ping : best),
    undefined,
  );
  if (earliest === undefined) return undefined;
  const wakes = parseRepeatingWakes(schedule);
  const days = [...new Set(pings.flatMap((ping) => ping.days))];
  const fix = `${wakeCommand(earliest.minutes, days)}   (undo: sudo pmset repeat cancel)`;

  const uncovered = pings.filter((ping) =>
    ping.days.some((day) => coveringWake(wakes, day, ping.minutes) === undefined),
  );
  if (uncovered.length === 0) {
    return {
      name: 'wake',
      status: 'ok',
      detail: 'the Mac is set to wake shortly before every ping',
    };
  }
  const unreadable = wakes.some((wake) => wake.days === 'unknown');
  const times = uncovered.map((ping) => `${formatTime(ping.minutes)} (${ping.name})`).join(', ');
  const several = new Set(pings.map((ping) => ping.minutes)).size > 1;
  return {
    name: 'wake',
    status: 'warn',
    detail:
      `the Mac is not set to wake before the ping at ${times}; if it sleeps then, the ping waits until you wake it` +
      (unreadable
        ? '. A repeating wake exists, but its days could not be read (see: pmset -g sched)'
        : '') +
      (several
        ? '. pmset allows one repeating wake, so only the earliest ping time can be covered'
        : ''),
    fix,
  };
}

/**
 * Checks everything dawnping depends on and says how to fix what is wrong.
 * Read-only, and it never sends a message to Claude.
 */
async function runChecks(ctx: CliContext): Promise<Check[]> {
  // Independent probes at once, so one slow command does not hold up the rest.
  const [version, schedule, installed, logsAvailable, loaded, stateText, tickLog] =
    await Promise.all([
      ctx.system.claudeVersion(),
      ctx.system.wakeSchedule(),
      ctx.scheduler.isInstalled().catch((error: unknown) => error as Error),
      ctx.sessionLogs.available().catch((error: unknown) => error as Error),
      loadConfig(ctx.paths.configFile).catch((error: unknown) => error as Error),
      readTextFile(join(ctx.paths.stateDir, 'state.json')).catch(
        (error: unknown) => error as Error,
      ),
      readTickLog(ctx.paths.stateDir).catch((error: unknown) => error as Error),
    ]);
  const failed = (name: string, error: Error): Check => ({
    name,
    status: 'fail',
    detail: `could not check: ${error.message}`,
  });

  const checks: Check[] = [claudeCheck(version)];

  let config: Config | undefined;
  if (loaded instanceof Error) checks.push(failed('config', loaded));
  else if (!loaded.ok) {
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
  if (config !== undefined && timeZone === undefined) {
    checks.push({
      name: 'time zone',
      status: 'fail',
      detail: `"${ctx.systemTimeZone}" is not an IANA zone`,
      fix: 'dawnping config set timezone <zone>, e.g. Europe/Istanbul',
    });
  } else if (timeZone !== undefined) {
    checks.push({ name: 'time zone', status: 'ok', detail: timeZone });
  }

  const state = stateText instanceof Error ? undefined : parseState(stateText);
  if (config !== undefined && timeZone !== undefined && state !== undefined) {
    const cfg = config;
    const tz = timeZone;
    checks.push(...(await guarded('today', () => pingCheck(ctx, cfg, tz, state))));
  }

  if (installed instanceof Error) checks.push(failed('agent', installed));
  else if (tickLog instanceof Error) checks.push(failed('agent', tickLog));
  else checks.push(agentCheck(ctx, installed, tickLog));

  if (logsAvailable instanceof Error) checks.push(failed('session logs', logsAvailable));
  else {
    checks.push(
      logsAvailable
        ? { name: 'session logs', status: 'ok', detail: 'readable' }
        : {
            name: 'session logs',
            status: 'fail',
            detail: `not found at ${ctx.paths.claudeProjectsDir}`,
            fix: 'set CLAUDE_CONFIG_DIR if Claude Code keeps its files elsewhere',
          },
    );
  }

  checks.push(
    stateText instanceof Error
      ? failed('last ping', stateText)
      : lastPingCheck(state ?? { version: 1 }, timeZone),
  );

  if (schedule !== undefined && config !== undefined) {
    const wake = wakeCheck(schedule, config);
    if (wake) checks.push(wake);
  }
  return checks;
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
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
      if (failures > 0)
        throw new CliError(`${plural(failures, 'problem')}, ${plural(warnings, 'warning')}.`);
      ctx.stdout(
        warnings === 0
          ? 'Everything looks good.\n'
          : `No problems, ${plural(warnings, 'warning')}.\n`,
      );
    });
}
