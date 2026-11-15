import { resolveDay } from '../config/resolve.ts';
import type { Config } from '../config/schema.ts';
import { WINDOW_MS } from '../pinger.ts';
import type { State } from '../state.ts';
import { formatTime, parseWorkRange, toLocalTime } from '../time.ts';
import { SLOT_MINUTES } from './demand.ts';
import { planProfileDay } from './plan-day.ts';

/** Failed pings on one day are retried this many times in total. */
export const MAX_ATTEMPTS_PER_DAY = 3;

/**
 * When the usage window that is active at `now` resets, or undefined if
 * none is active. Rebuilds the chain from answer timestamps (oldest
 * first): a window starts with the first answer after the previous reset
 * and lasts five hours. Any answer counts, including dawnping's own pings.
 */
export function activeWindowEnd(timestamps: readonly number[], now: number): number | undefined {
  let end: number | undefined;
  for (const time of timestamps) {
    if (time > now) break;
    if (end === undefined || time >= end) end = time + WINDOW_MS;
  }
  return end !== undefined && end > now ? end : undefined;
}

export type TickDecision =
  | { action: 'ping'; date: string; model: string; reason: string }
  | { action: 'wait'; reason: string };

export interface TickInput {
  config: Config;
  now: number;
  timeZone: string;
  state: State;
  /** When the currently active usage window resets, if one is active. */
  activeWindowEnd: number | undefined;
}

/**
 * Decides whether this tick pings. Pure: the time, the state and the
 * active window are passed in, so every situation (a late wake-up, a
 * window left open from the night before) is a plain test case.
 */
export function decideTick({
  config,
  now,
  timeZone,
  state,
  activeWindowEnd: windowEnd,
}: TickInput): TickDecision {
  const day = resolveDay(config, now, timeZone);
  const at = (epochMs: number) => formatTime(toLocalTime(epochMs, timeZone).minutes);

  if (day.skipped) return { action: 'wait', reason: `${day.date} is skipped` };
  if (day.profile === undefined) return { action: 'wait', reason: `${day.date} is a rest day` };

  const { plan, mode } = planProfileDay(day.profile);
  const trigger = plan.trigger * SLOT_MINUTES;
  const firstWindow = plan.windows[0];
  if (mode === 'fixed' && firstWindow !== undefined && firstWindow.start !== plan.trigger) {
    return { action: 'wait', reason: `the fixed trigger ${day.profile.trigger} has no effect` };
  }

  const last = state.lastPing?.date === day.date ? state.lastPing : undefined;
  if (last !== undefined && (last.outcome === 'verified' || last.outcome === 'unverified')) {
    return { action: 'wait', reason: `already pinged today at ${at(last.at)}` };
  }
  if (last !== undefined && last.attempts >= MAX_ATTEMPTS_PER_DAY) {
    return { action: 'wait', reason: `gave up after ${last.attempts} failed pings today` };
  }

  if (day.minutes < trigger)
    return { action: 'wait', reason: `next ping at ${formatTime(trigger)}` };
  const workEnd = parseWorkRange(day.profile.work)?.end ?? 0;
  if (day.minutes >= workEnd) return { action: 'wait', reason: 'working hours are over' };

  // A window that is already running would not be restarted by a ping.
  if (windowEnd !== undefined) {
    return { action: 'wait', reason: `a usage window is already active until ${at(windowEnd)}` };
  }

  const late = day.minutes > trigger + SLOT_MINUTES ? ` (planned for ${formatTime(trigger)})` : '';
  return { action: 'ping', date: day.date, model: config.ping.model, reason: `ping time${late}` };
}
