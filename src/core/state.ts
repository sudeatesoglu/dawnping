import { z } from 'zod';
import { PING_OUTCOMES } from './pinger.ts';
import { isIsoDate } from './time.ts';

/** Longest failure detail kept in the state. */
export const MAX_DETAIL_LENGTH = 300;

const OUTCOMES = [...PING_OUTCOMES, 'pending'] as const;

/**
 * What dawnping remembers between ticks. Written only by dawnping, kept in
 * the state directory, never edited by the user.
 *
 * Read tolerantly: keys a newer dawnping adds are ignored, and an outcome
 * this version does not know counts as "failed". A newer state file then
 * never makes an older dawnping forget today's attempt and ping again.
 */
const PingRecord = z.object({
  /** Local date (YYYY-MM-DD) the ping was for. */
  date: z.string().refine(isIsoDate),
  /** When the last attempt started, epoch ms. */
  at: z.number(),
  /**
   * "pending" is written just before pinging: if the run dies before it
   * records the outcome, the attempt still counts and is not repeated
   * every five minutes.
   */
  outcome: z
    .string()
    .transform((value): (typeof OUTCOMES)[number] =>
      (OUTCOMES as readonly string[]).includes(value)
        ? (value as (typeof OUTCOMES)[number])
        : 'failed',
    ),
  /** Attempts on this date, so failures are retried a few times only. */
  attempts: z.number().int().min(1),
  /** For failures: the first line of claude's message, shown by doctor. */
  detail: z.string().max(MAX_DETAIL_LENGTH).optional(),
});

export const StateSchema = z.object({
  version: z.literal(1),
  lastPing: PingRecord.optional(),
});

export type State = z.output<typeof StateSchema>;
export type PingRecord = z.output<typeof PingRecord>;

export const EMPTY_STATE: State = { version: 1 };

/** Parses a state file; anything unreadable counts as no state. */
export function parseState(text: string | undefined): State {
  if (text === undefined) return EMPTY_STATE;
  try {
    const result = StateSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : EMPTY_STATE;
  } catch {
    return EMPTY_STATE;
  }
}
