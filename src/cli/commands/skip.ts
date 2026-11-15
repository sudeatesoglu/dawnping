import type { Command } from 'commander';
import { profileFor } from '../../core/config/resolve.ts';
import type { Config, ConfigInput } from '../../core/config/schema.ts';
import {
  dateRange,
  MAX_SKIP_RANGE_DAYS,
  rangeLength,
  withoutSkip,
  withSkips,
} from '../../core/skip.ts';
import { weekdayOf } from '../../core/time.ts';
import { loadOrFail, validateAndSave } from '../config-file.ts';
import { type CliContext, CliError } from '../context.ts';
import { dateOrFail as dateOrFailIn, todayOrFail } from '../day.ts';

const DATE_HELP = 'today, tomorrow or YYYY-MM-DD';

const dateOrFail = (arg: string, today: string) => dateOrFailIn(arg, today, DATE_HELP);

/** "2026-11-20 (Fri)" or "2026-11-21 (Sat, already a rest day)". */
function describe(config: Config, date: string): string {
  const weekday = weekdayOf(date);
  const label = `${weekday[0]?.toUpperCase()}${weekday.slice(1)}`;
  return profileFor(config, weekday) === undefined
    ? `${date} (${label}, already a rest day)`
    : `${date} (${label})`;
}

/**
 * The input with a new skip list. An empty list removes the key (its
 * default is empty anyway), so `skip` followed by `unskip` leaves the file
 * as it was.
 */
function withSkipList(input: ConfigInput, skip: string[]): ConfigInput {
  if (skip.length > 0) return { ...input, skip };
  const { skip: _empty, ...rest } = input;
  return rest;
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
      const today = todayOrFail(config, ctx);

      if (options.list) {
        if (args.length > 0 || options.until !== undefined) {
          throw new CliError('--list does not take dates; run it on its own.');
        }
        const upcoming = config.skip.filter((date) => date >= today);
        ctx.stdout(
          upcoming.length === 0
            ? 'No skipped dates.\n'
            : upcoming.map((date) => `${describe(config, date)}\n`).join(''),
        );
        return;
      }

      if (args.length === 0) throw new CliError(`Give a date to skip (${DATE_HELP}) or --list.`);
      let dates = args.map((arg) => dateOrFail(arg, today));

      const past = dates.filter((date) => date < today);
      if (past.length === 1) throw new CliError(`${past[0]} is in the past.`);
      if (past.length > 1) throw new CliError(`These dates are in the past: ${past.join(', ')}.`);

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

      await validateAndSave(ctx, withSkipList(input, withSkips(input.skip ?? [], dates, today)));
      for (const date of dates) ctx.stdout(`Skipping ${describe(config, date)}\n`);
    });

  program
    .command('unskip <date>')
    .description('ping again on a skipped day')
    .action(async (arg: string) => {
      const { config, input } = await loadOrFail(ctx);
      const today = todayOrFail(config, ctx);
      const date = dateOrFail(arg, today);
      if (date < today) throw new CliError(`${date} is in the past.`);
      if (!(input.skip ?? []).includes(date)) throw new CliError(`${date} is not skipped.`);
      await validateAndSave(ctx, withSkipList(input, withoutSkip(input.skip ?? [], date, today)));
      ctx.stdout(`No longer skipping ${date}\n`);
    });
}
