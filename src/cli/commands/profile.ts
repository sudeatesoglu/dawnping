import type { Command } from 'commander';
import { splitList } from '../../core/config/keypath.ts';
import type { Profile } from '../../core/config/schema.ts';
import { WEEKDAYS, type Weekday } from '../../core/time.ts';
import { loadOrFail, validateAndSave } from '../config-file.ts';
import { type CliContext, CliError } from '../context.ts';

/** Weekdays from --days, case-insensitive ("Fri" works). */
function parseDays(value: string): string[] {
  return splitList(value.toLowerCase());
}

interface AddOptions {
  days: string;
  work: string;
  trigger: string;
  take?: boolean;
}

export function registerProfileCommands(program: Command, ctx: CliContext): void {
  const profile = program
    .command('profile')
    .description('manage weekday profiles (working hours per group of days)');

  profile
    .command('list')
    .description('print profiles and rest days')
    .action(async () => {
      const { config } = await loadOrFail(ctx);
      const entries = Object.entries(config.profiles);
      const width = Math.max(4, ...entries.map(([name]) => name.length));
      for (const [name, p] of entries) {
        ctx.stdout(
          `${name.padEnd(width)}  ${p.days.join(',').padEnd(27)}  ${p.work}  trigger ${p.trigger}\n`,
        );
      }
      const covered = new Set(entries.flatMap(([, p]) => p.days));
      const rest = WEEKDAYS.filter((day) => !covered.has(day));
      ctx.stdout(`${'rest'.padEnd(width)}  ${rest.length > 0 ? rest.join(',') : '(none)'}\n`);
    });

  profile
    .command('add <name>')
    .description('add a profile for some weekdays')
    .requiredOption('--days <days>', 'comma-separated weekdays, e.g. fri or mon,tue,wed')
    .requiredOption('--work <range>', 'working hours, e.g. 10:00-15:00')
    .option('--trigger <time>', '"auto" or a fixed time like 06:30', 'auto')
    .option('--take', 'move the days from the profiles that have them now')
    .action(async (name: string, options: AddOptions) => {
      const { input } = await loadOrFail(ctx);
      if (Object.hasOwn(input.profiles, name)) {
        throw new CliError(
          `Profile "${name}" already exists.`,
          `Change it with: dawnping config set profiles.${name}.<key> <value>`,
        );
      }
      const days = parseDays(options.days);
      const profiles = options.take ? withoutDays(input.profiles, days) : { ...input.profiles };

      if (!options.take) {
        const owners = ownersOf(input.profiles, days);
        if (owners.length > 0) {
          throw new CliError(
            ...owners.map(([day, owner]) => `${day} already belongs to profile "${owner}".`),
            'Add --take to move these days to the new profile.',
          );
        }
      }

      const added: Profile = {
        days: days as Weekday[],
        work: options.work,
        trigger: options.trigger,
      };
      await validateAndSave(ctx, { ...input, profiles: { ...profiles, [name]: added } });
      ctx.stdout(`Added profile "${name}"\n`);
    });

  profile
    .command('remove <name>')
    .description('remove a profile; its days become rest days')
    .action(async (name: string) => {
      const { input } = await loadOrFail(ctx);
      if (!Object.hasOwn(input.profiles, name)) throw new CliError(`No profile named "${name}".`);
      const { [name]: _removed, ...profiles } = input.profiles;
      await validateAndSave(ctx, { ...input, profiles });
      ctx.stdout(`Removed profile "${name}"\n`);
    });
}

type Profiles = Record<string, { days: string[] } & Record<string, unknown>>;

function ownersOf(profiles: Profiles, days: readonly string[]): [string, string][] {
  return days.flatMap((day) => {
    const owner = Object.entries(profiles).find(([, p]) => p.days.includes(day));
    return owner === undefined ? [] : [[day, owner[0]] as [string, string]];
  });
}

/**
 * Removes the given days from every profile. A profile left without days
 * would be invalid, so that case is reported instead of silently deleting it.
 */
function withoutDays<P extends Profiles>(profiles: P, days: readonly string[]): P {
  const result: Profiles = {};
  for (const [name, p] of Object.entries(profiles)) {
    const remaining = p.days.filter((day) => !days.includes(day));
    if (remaining.length === 0) {
      throw new CliError(
        `Taking ${days.join(',')} would leave profile "${name}" without days.`,
        `Remove it first: dawnping profile remove ${name}`,
      );
    }
    result[name] = { ...p, days: remaining };
  }
  return result as P;
}
