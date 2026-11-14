import { describe, expect, it, vi } from 'vitest';
import { systemClock } from './system-clock.ts';

describe('systemClock', () => {
  it('reads the system time', () => {
    vi.useFakeTimers({ now: new Date('2026-11-15T07:00:00Z') });
    try {
      expect(systemClock.now()).toBe(Date.parse('2026-11-15T07:00:00Z'));
    } finally {
      vi.useRealTimers();
    }
  });
});
