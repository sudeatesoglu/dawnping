import type { Command } from 'commander';
import { resolveDay } from '../../core/config/resolve.ts';
import type { Config } from '../../core/config/schema.ts';
import {
  dateRange,
  MAX_SKIP_RANGE_DAYS,
  rangeLength,
  resolveDateArg,
  withoutSkip,
  withSkips,
} from '../../core/skip.ts';
import { toLocalTime } from '../../core/time.ts';
import { loadOrFail, validateAndSave } from '../config-file.ts';
import { type CliContext, CliError } from '../context.ts';

const DATE_HELP = 'today, tomorrow or YYYY-MM-DD';

function timeZoneOf(config: Config, ctx: CliContext): string {
  return config.timezone ?? ctx.systemTimeZone;
}

function dateOrFail(arg: string, today: string): string {
  const date = resolveDateArg(arg, today);
  if (date === undefined)
    throw new CliError(`Not a date: ${JSON.stringify(arg)} (use ${DATE_HELP})`);
  return date;
}

/** "2026-11-20 (Fri)" or "2026-11-21 (Sat, already a rest day)". */
function describe(config: Config, date: string, timeZone: string): string {
  // Noon avoids DST edges when turning the calendar date into an instant.
  const day = resolveDay(config, Date.parse(`${date}T12:00:00Z`), timeZone);
  const weekday = day.weekday[0]?.toUpperCase() + day.weekday.slice(1);
  return day.profile === undefined
    ? `${date} (${weekday}, already a rest day)`
    : `${date} (${weekday})`;
}

interface SkipOptions {
  until?: string;
  list?: boolean;
}

export function registerSkipCommands(program: Command, ctx: CliContext): void {
  program
    .command('skip')
    .description('do not ping on some days (holidays, days off)')
    .argument('[dates...]', DATE_HELP)
    .option('--until <date>', 'skip every day from the given date up to this one')
    .option('--list', 'print the skipped dates')
    .addHelpText(
      'after',
      '\nExamples:\n  dawnping skip tomorrow\n  dawnping skip 2026-12-24 --until 2027-01-01\n  dawnping skip --list',
    )
    .action(async (args: string[], options: SkipOptions) => {
      const { config, input } = await loadOrFail(ctx);
      const timeZone = timeZoneOf(config, ctx);
      const today = toLocalTime(ctx.clock.now(), timeZone).date;

      if (options.list) {
        const upcoming = config.skip.filter((date) => date >= today);
        ctx.stdout(
          upcoming.length === 0
            ? 'No skipped dates.\n'
            : upcoming.map((date) => `${describe(config, date, timeZone)}\n`).join(''),
        );
        return;
      }

      if (args.length === 0) throw new CliError(`Give a date to skip (${DATE_HELP}) or --list.`);
      let dates = args.map((arg) => dateOrFail(arg, today));

      if (options.until !== undefined) {
        const [from] = dates;
        if (dates.length !== 1 || from === undefined) {
          throw new CliError('--until takes exactly one start date.');
        }
        const until = dateOrFail(options.until, today);
        if (until < from) throw new CliError(`--until ${until} is before ${from}.`);
        // Checked before building the list, so a typo like 2062 stays cheap.
        const length = rangeLength(from, until);
        if (length > MAX_SKIP_RANGE_DAYS) {
          throw new CliError(`That is ${length} days; at most ${MAX_SKIP_RANGE_DAYS} at once.`);
        }
        dates = dateRange(from, until);
      }

      const past = dates.filter((date) => date < today);
      if (past.length > 0) throw new CliError(`${past.join(', ')} is in the past.`);

      await validateAndSave(ctx, { ...input, skip: withSkips(input.skip ?? [], dates, today) });
      for (const date of dates) ctx.stdout(`Skipping ${describe(config, date, timeZone)}\n`);
    });

  program
    .command('unskip <date>')
    .description('ping again on a skipped day')
    .action(async (arg: string) => {
      const { config, input } = await loadOrFail(ctx);
      const today = toLocalTime(ctx.clock.now(), timeZoneOf(config, ctx)).date;
      const date = dateOrFail(arg, today);
      if (!(input.skip ?? []).includes(date)) throw new CliError(`${date} is not skipped.`);
      await validateAndSave(ctx, { ...input, skip: withoutSkip(input.skip ?? [], date, today) });
      ctx.stdout(`No longer skipping ${date}\n`);
    });
}
