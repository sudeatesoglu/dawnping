import { resolveDay } from '../config/resolve.ts';
import type { Config } from '../config/schema.ts';
import { limitResetToday } from '../limit.ts';
import { WINDOW_MS } from '../pinger.ts';
import type { State } from '../state.ts';
import { formatTime, parseWorkRange, toLocalTime } from '../time.ts';
import { SLOT_MINUTES } from './demand.ts';
import { planProfileDay } from './plan-day.ts';

/**
 * Waits before retrying after the 1st, 2nd... failed attempt of a day, in
 * minutes. Growing gaps give the user time to fix the cause (for example
 * log in again) without one notification after another.
 */
export const RETRY_DELAYS_MINUTES = [15, 30, 60, 120] as const;
export const MAX_ATTEMPTS_PER_DAY = RETRY_DELAYS_MINUTES.length + 1;

/**
 * When the usage window that is active at `now` resets, or undefined if
 * none is active. Rebuilds the chain from answer timestamps (oldest
 * first): a window starts with the first answer after the previous reset
 * and lasts five hours. Any answer counts, including dawnping's own pings.
 *
 * The chain is anchored at the last gap of at least five hours: the answer
 * after such a gap certainly starts a new window, whatever happened before
 * the history begins. Without such a gap the oldest answer is the best guess.
 */
export function activeWindowEnd(timestamps: readonly number[], now: number): number | undefined {
  const past = timestamps.filter((time) => time <= now);
  let anchor = 0;
  for (let i = 1; i < past.length; i++) {
    if ((past[i] ?? 0) - (past[i - 1] ?? 0) >= WINDOW_MS) anchor = i;
  }
  let end: number | undefined;
  for (const time of past.slice(anchor)) {
    if (end === undefined || time >= end) end = time + WINDOW_MS;
  }
  return end !== undefined && end > now ? end : undefined;
}

export type TickDecision =
  | { action: 'ping'; date: string; model: string; reason: string; attempt: number }
  | { action: 'wait'; reason: string }
  /** Everything says ping; whether a window is already active decides. */
  | { action: 'check-window' };

export interface TickInput {
  config: Config;
  now: number;
  timeZone: string;
  state: State;
  /**
   * When the active usage window resets (undefined: none is active), or
   * "unchecked". Reading the session logs costs time, so the caller only
   * does it when the decision returns "check-window".
   */
  activeWindowEnd: number | undefined | 'unchecked';
}

/**
 * Decides whether this tick pings. Pure: the time, the state and the
 * active window are passed in, so every situation (a late wake-up, a
 * window left open from the night before) is a plain test case.
 */
export function decideTick(input: TickInput): TickDecision {
  const { config, now, timeZone, state } = input;
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
  // A reached usage limit fails every ping until it resets. If claude said
  // when, and that is today, try again then; otherwise wait for tomorrow.
  if (last?.outcome === 'limit-reached') {
    const reset = last.detail === undefined ? undefined : limitResetToday(last.detail);
    if (reset === undefined || last.attempts >= MAX_ATTEMPTS_PER_DAY) {
      return { action: 'wait', reason: 'a usage limit was reached today' };
    }
    if (day.minutes < reset) {
      return { action: 'wait', reason: `the usage limit resets at ${formatTime(reset)}` };
    }
  } else if (last !== undefined) {
    // Failed or interrupted ("pending") attempts are retried with growing gaps.
    if (last.attempts >= MAX_ATTEMPTS_PER_DAY) {
      return { action: 'wait', reason: `gave up after ${last.attempts} failed pings today` };
    }
    const delay = RETRY_DELAYS_MINUTES[last.attempts - 1] ?? 0;
    const retryAt = last.at + delay * 60_000;
    if (now < retryAt) return { action: 'wait', reason: `retrying at ${at(retryAt)}` };
  }

  if (day.minutes < trigger)
    return { action: 'wait', reason: `next ping at ${formatTime(trigger)}` };
  const workEnd = parseWorkRange(day.profile.work)?.end ?? 0;
  if (day.minutes >= workEnd) return { action: 'wait', reason: 'working hours are over' };

  // A window that is already running would not be restarted by a ping.
  const windowEnd = input.activeWindowEnd;
  if (windowEnd === 'unchecked') return { action: 'check-window' };
  if (windowEnd !== undefined) {
    return { action: 'wait', reason: `a usage window is already active until ${at(windowEnd)}` };
  }

  const late = day.minutes > trigger + SLOT_MINUTES ? ` (planned for ${formatTime(trigger)})` : '';
  return {
    action: 'ping',
    date: day.date,
    model: config.ping.model,
    reason: `ping time${late}`,
    attempt: (last?.attempts ?? 0) + 1,
  };
}
