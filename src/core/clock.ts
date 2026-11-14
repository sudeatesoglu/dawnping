/**
 * Port: the current time.
 *
 * Core logic never reads the system clock directly. It receives a `Clock`,
 * so tests can pin "now" to any moment (a DST change, a skipped day) and
 * get the same result on every run.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}
