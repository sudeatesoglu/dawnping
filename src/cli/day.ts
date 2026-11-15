import { effectiveTimeZone } from '../core/config/resolve.ts';
import type { Config } from '../core/config/schema.ts';
import { resolveDateArg } from '../core/skip.ts';
import { toLocalTime } from '../core/time.ts';
import { type CliContext, CliError } from './context.ts';

/** The user's time zone, or a clear error with how to set one. */
export function timeZoneOrFail(config: Config, ctx: CliContext): string {
  const timeZone = effectiveTimeZone(config, ctx.systemTimeZone);
  if (timeZone === undefined) {
    throw new CliError(
      `The system time zone "${ctx.systemTimeZone}" is not an IANA zone like Europe/Istanbul.`,
      'Set yours with: dawnping config set timezone <zone>',
    );
  }
  return timeZone;
}

/** Today's date in the user's time zone. */
export function todayOrFail(config: Config, ctx: CliContext): string {
  return toLocalTime(ctx.clock.now(), timeZoneOrFail(config, ctx)).date;
}

/** "today", "tomorrow" or YYYY-MM-DD, or a CliError naming the accepted forms. */
export function dateOrFail(arg: string, today: string, accepted: string): string {
  const date = resolveDateArg(arg, today);
  if (date === undefined)
    throw new CliError(`Not a date: ${JSON.stringify(arg)} (use ${accepted})`);
  return date;
}
