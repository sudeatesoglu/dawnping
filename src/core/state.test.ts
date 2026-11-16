import { describe, expect, it } from 'vitest';
import { EMPTY_STATE, parseState } from './state.ts';

describe('parseState', () => {
  it('reads a state file', () => {
    const state = {
      version: 1,
      lastPing: { date: '2026-11-16', at: 1, outcome: 'verified', attempts: 1 },
    };
    expect(parseState(JSON.stringify(state))).toEqual(state);
  });

  it.each([undefined, '', '{', '{"version":2}', '{"version":1,"lastPing":{"date":"x"}}'])(
    'treats %j as no state',
    (text) => {
      expect(parseState(text)).toEqual(EMPTY_STATE);
    },
  );
});

describe('parseState tolerance', () => {
  it('ignores keys a newer dawnping adds and maps unknown outcomes to failed', () => {
    const newer = {
      version: 1,
      futureKey: true,
      lastPing: { date: '2026-11-16', at: 1, outcome: 'some-new-kind', attempts: 2, extra: 'x' },
    };
    expect(parseState(JSON.stringify(newer))).toEqual({
      version: 1,
      lastPing: { date: '2026-11-16', at: 1, outcome: 'failed', attempts: 2 },
    });
  });
});
