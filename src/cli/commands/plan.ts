import type { Command } from 'commander';
import { effectiveTimeZone, profileFor } from '../../core/config/resolve.ts';
import { SLOT_MINUTES } from '../../core/planner/demand.ts';
import type { Plan } from '../../core/planner/optimize.ts';
import { planProfileDay } from '../../core/planner/plan-day.ts';
import { resolveDateArg } from '../../core/skip.ts';
import { formatTime, toLocalTime, WEEKDAYS, type Weekday, weekdayOf } from '../../core/time.ts';
import { loadOrFail } from '../config-file.ts';
import { type CliContext, CliError } from '../context.ts';

const DAY_HELP = 'today, tomorrow, a weekday (mon..sun) or YYYY-MM-DD';

const at = (slot: number) => formatTime(slot * SLOT_MINUTES);
const hours = (slots: number) => `${Number(((slots * SLOT_MINUTES) / 60).toFixed(2))}h`;

function asWeekday(arg: string): Weekday | undefined {
  const value = arg.trim().toLowerCase().slice(0, 3);
  return arg.length >= 3 && (WEEKDAYS as readonly string[]).includes(value)
    ? (value as Weekday)
    : undefined;
}

function windowLines(plan: Plan): string {
  const total = plan.windows.reduce((sum, w) => sum + w.load, 0);
  return plan.windows
    .map((w) => {
      const share = total === 0 ? 0 : Math.round((w.load / total) * 100);
      return `  ${at(w.start)}-${at(w.end)}  ${hours(w.activeSlots).padEnd(5)} of work  ${String(share).padStart(3)}% of the day's load\n`;
    })
    .join('');
}

export function registerPlanCommand(program: Command, ctx: CliContext): void {
  program
    .command('plan')
    .description('show when dawnping pings on a day, and why')
    .argument('[day]', DAY_HELP, 'today')
    .action(async (dayArg: string) => {
      const { config } = await loadOrFail(ctx);

      // A weekday shows the profile's plan; a date also checks skips.
      let weekday = asWeekday(dayArg);
      let date: string | undefined;
      if (weekday === undefined) {
        const timeZone = effectiveTimeZone(config, ctx.systemTimeZone) ?? 'UTC';
        date = resolveDateArg(dayArg, toLocalTime(ctx.clock.now(), timeZone).date);
        if (date === undefined)
          throw new CliError(`Not a day: ${JSON.stringify(dayArg)} (use ${DAY_HELP})`);
        weekday = weekdayOf(date);
      }
      const label = date === undefined ? weekday : `${date} (${weekday})`;

      if (date !== undefined && config.skip.includes(date)) {
        ctx.stdout(`${label} is skipped: no ping.\n`);
        return;
      }
      const profile = profileFor(config, weekday);
      if (profile === undefined) {
        ctx.stdout(`${label} is a rest day: no ping.\n`);
        return;
      }

      const { plan, auto, mode } = planProfileDay(profile);
      const busy = (profile.busy ?? [])
        .map((b) => `${b.range}${b.weight === undefined ? '' : ` ×${b.weight}`}`)
        .join(', ');
      ctx.stdout(
        `${label}: profile "${profile.name}", work ${profile.work}${busy ? `, busy ${busy}` : ''}\n`,
      );
      ctx.stdout(
        mode === 'auto'
          ? `Ping at ${at(plan.trigger)} (chosen automatically)\n`
          : `Ping at ${profile.trigger} (fixed in your config; auto would choose ${at(auto.trigger)})\n`,
      );
      ctx.stdout(windowLines(plan));
      const count = plan.windows.length;
      ctx.stdout(`${count} fresh window${count === 1 ? '' : 's'} during your working hours.\n`);
    });
}
