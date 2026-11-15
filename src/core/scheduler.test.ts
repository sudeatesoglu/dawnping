import { describe, expect, it } from 'vitest';
import { agentEnvironment } from './scheduler.ts';

describe('agentEnvironment', () => {
  it('keeps PATH and passes config locations through', () => {
    expect(
      agentEnvironment({
        PATH: '/opt/homebrew/bin:/usr/bin',
        XDG_CONFIG_HOME: '/cfg',
        CLAUDE_CONFIG_DIR: '/claude',
        HOME: '/Users/u',
        SECRET_TOKEN: 'x',
      }),
    ).toEqual({
      PATH: '/opt/homebrew/bin:/usr/bin',
      XDG_CONFIG_HOME: '/cfg',
      CLAUDE_CONFIG_DIR: '/claude',
    });
  });

  it('drops node_modules/.bin entries a package manager added', () => {
    expect(
      agentEnvironment({ PATH: '/repo/node_modules/.bin:/opt/homebrew/bin::/usr/bin' })['PATH'],
    ).toBe('/opt/homebrew/bin:/usr/bin');
  });

  it('falls back to the system PATH', () => {
    expect(agentEnvironment({})).toEqual({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin' });
  });
});
