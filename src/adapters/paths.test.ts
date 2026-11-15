import { describe, expect, it } from 'vitest';
import { resolvePaths } from './paths.ts';

describe('resolvePaths', () => {
  it('defaults to ~/.config and ~/.local/state', () => {
    expect(resolvePaths({}, '/home/u')).toEqual({
      configFile: '/home/u/.config/dawnping/config.json',
      stateDir: '/home/u/.local/state/dawnping',
      launchAgentsDir: '/home/u/Library/LaunchAgents',
      claudeProjectsDir: '/home/u/.claude/projects',
    });
  });

  it('honors absolute XDG variables', () => {
    expect(resolvePaths({ XDG_CONFIG_HOME: '/cfg', XDG_STATE_HOME: '/state' }, '/home/u')).toEqual({
      configFile: '/cfg/dawnping/config.json',
      stateDir: '/state/dawnping',
      launchAgentsDir: '/home/u/Library/LaunchAgents',
      claudeProjectsDir: '/home/u/.claude/projects',
    });
  });

  it('honors an absolute CLAUDE_CONFIG_DIR for the session logs', () => {
    expect(resolvePaths({ CLAUDE_CONFIG_DIR: '/claude' }, '/home/u').claudeProjectsDir).toBe(
      '/claude/projects',
    );
  });

  it('ignores relative XDG variables, as the spec requires', () => {
    expect(resolvePaths({ XDG_CONFIG_HOME: 'cfg', XDG_STATE_HOME: '' }, '/home/u')).toEqual({
      configFile: '/home/u/.config/dawnping/config.json',
      stateDir: '/home/u/.local/state/dawnping',
      launchAgentsDir: '/home/u/Library/LaunchAgents',
      claudeProjectsDir: '/home/u/.claude/projects',
    });
  });
});
