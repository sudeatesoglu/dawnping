import type { Clock } from '../core/clock.ts';

/** Adapter: the real system clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
};
