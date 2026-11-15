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

  it('falls back to the system PATH', () => {
    expect(agentEnvironment({})).toEqual({ PATH: '/usr/bin:/bin:/usr/sbin:/sbin' });
  });
});
