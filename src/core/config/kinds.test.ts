import { describe, expect, it } from 'vitest';
import { settingKind } from './kinds.ts';

describe('settingKind', () => {
  it.each([
    [['version'], 'number'],
    [['timezone'], 'text'],
    [['ping', 'model'], 'text'],
    [['skip'], 'list'],
    // Works for profiles that do not exist yet: the kind comes from the schema.
    [['profiles', 'weekend', 'days'], 'list'],
    [['profiles', 'weekend', 'work'], 'text'],
  ])('%j is %s', (path, kind) => {
    expect(settingKind(path)).toBe(kind);
  });

  it.each([[['nope']], [['ping', 'nope']], [['version', 'x']], [['ping', 'toString']]])(
    'does not know %j',
    (path) => {
      expect(settingKind(path)).toBeUndefined();
    },
  );
});
