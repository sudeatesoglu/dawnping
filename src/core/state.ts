import { z } from 'zod';
import { PING_OUTCOMES } from './pinger.ts';
import { isIsoDate } from './time.ts';

/**
 * What dawnping remembers between ticks. Written only by dawnping, kept in
 * the state directory, never edited by the user.
 */
const PingRecord = z.strictObject({
  /** Local date (YYYY-MM-DD) the ping was for. */
  date: z.string().refine(isIsoDate),
  /** When the last attempt started, epoch ms. */
  at: z.number(),
  /**
   * "pending" is written just before pinging: if the run dies before it
   * records the outcome, the attempt still counts and is not repeated
   * every five minutes.
   */
  outcome: z.enum([...PING_OUTCOMES, 'pending']),
  /** Attempts on this date, so failures are retried a few times only. */
  attempts: z.number().int().min(1),
  /** For failures: the first line of claude's message, shown by doctor. */
  detail: z.string().max(300).optional(),
});

export const StateSchema = z.strictObject({
  version: z.literal(1),
  lastPing: PingRecord.optional(),
});

export type State = z.infer<typeof StateSchema>;
export type PingRecord = z.infer<typeof PingRecord>;

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
