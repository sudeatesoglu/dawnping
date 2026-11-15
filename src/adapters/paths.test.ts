import { describe, expect, it } from 'vitest';
import { resolvePaths } from './paths.ts';

describe('resolvePaths', () => {
  it('defaults to ~/.config and ~/.local/state', () => {
    expect(resolvePaths({}, '/home/u')).toEqual({
      configFile: '/home/u/.config/dawnping/config.json',
      stateDir: '/home/u/.local/state/dawnping',
    });
  });

  it('honors absolute XDG variables', () => {
    expect(resolvePaths({ XDG_CONFIG_HOME: '/cfg', XDG_STATE_HOME: '/state' }, '/home/u')).toEqual({
      configFile: '/cfg/dawnping/config.json',
      stateDir: '/state/dawnping',
    });
  });

  it('ignores relative XDG variables, as the spec requires', () => {
    expect(resolvePaths({ XDG_CONFIG_HOME: 'cfg', XDG_STATE_HOME: '' }, '/home/u')).toEqual({
      configFile: '/home/u/.config/dawnping/config.json',
      stateDir: '/home/u/.local/state/dawnping',
    });
  });
});
