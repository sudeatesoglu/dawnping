import type { Command } from 'commander';
import { profileFor } from '../../core/config/resolve.ts';
import { SLOT_MINUTES } from '../../core/planner/demand.ts';
import type { Plan } from '../../core/planner/optimize.ts';
import { planProfileDay } from '../../core/planner/plan-day.ts';
import { formatTime, WEEKDAYS, type Weekday, weekdayOf } from '../../core/time.ts';
import { loadOrFail } from '../config-file.ts';
import type { CliContext } from '../context.ts';
import { dateOrFail, todayOrFail } from '../day.ts';

const DAY_HELP = 'today, tomorrow, a weekday (mon..sun) or YYYY-MM-DD';

const at = (slot: number) => formatTime(slot * SLOT_MINUTES);
const hours = (slots: number) => `${Number(((slots * SLOT_MINUTES) / 60).toFixed(2))}h`;

const WEEKDAY_NAMES: Record<string, Weekday> = Object.fromEntries(
  WEEKDAYS.flatMap((day, i) => [
    [day, day],
    [['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][i], day],
  ]),
);

/** "mon" or "monday" (any case); nothing else, so "month" is not Monday. */
function asWeekday(arg: string): Weekday | undefined {
  const name = arg.trim().toLowerCase();
  return Object.hasOwn(WEEKDAY_NAMES, name) ? WEEKDAY_NAMES[name] : undefined;
}

/** "busy 14:00-17:00 ×3", or "break 12:00-13:00" for weight 0. */
export function describeBusy(busy: { range: string; weight?: number | undefined }): string {
  if (busy.weight === 0) return `break ${busy.range}`;
  return `busy ${busy.range}${busy.weight === undefined ? '' : ` ×${busy.weight}`}`;
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
        date = dateOrFail(dayArg, todayOrFail(config, ctx), DAY_HELP);
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
      const ranges = (profile.busy ?? []).map((b) => `, ${describeBusy(b)}`).join('');
      ctx.stdout(`${label}: profile "${profile.name}", work ${profile.work}${ranges}\n`);
      ctx.stdout(
        mode === 'auto'
          ? `Ping at ${at(plan.trigger)} (chosen automatically)\n`
          : `Ping at ${profile.trigger} (fixed in your config; auto would choose ${at(auto.trigger)})\n`,
      );
      // A fixed ping after work starts, or 5+ hours before, starts nothing.
      const firstWindow = plan.windows[0];
      if (mode === 'fixed' && firstWindow !== undefined && firstWindow.start !== plan.trigger) {
        const why =
          plan.trigger > firstWindow.start ? 'after work starts' : 'more than 5 hours before work';
        ctx.stdout(
          `  This ping has no effect: it is ${why}, so the first window starts with your work at ${at(firstWindow.start)}.\n`,
        );
      }
      ctx.stdout(windowLines(plan));
      const count = plan.windows.length;
      // Facts only: the plan is chosen for the most usable work (ADR-0005),
      // not for the number of windows.
      ctx.stdout(`Your working hours span ${count} window${count === 1 ? '' : 's'}.\n`);
    });
}
