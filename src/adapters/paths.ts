import { isAbsolute, join } from 'node:path';

export interface Paths {
  /** The user's config file. */
  configFile: string;
  /** Directory for state the tool writes itself (last ping, logs). */
  stateDir: string;
  /** Where per-user launchd agents live on macOS. */
  launchAgentsDir: string;
  /** Claude Code's session logs, one folder per project. */
  claudeProjectsDir: string;
}

/**
 * Locates dawnping's files following the XDG Base Directory spec, which
 * command-line tools on macOS commonly use as well (`~/.config/...`).
 *
 * The environment and home directory are passed in so tests never touch the
 * real ones.
 */
export function resolvePaths(
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): Paths {
  // The spec says relative values are invalid and must be ignored.
  const base = (variable: string, fallback: string): string => {
    const value = env[variable];
    return value !== undefined && isAbsolute(value) ? value : join(home, fallback);
  };
  return {
    configFile: join(base('XDG_CONFIG_HOME', '.config'), 'dawnping', 'config.json'),
    stateDir: join(base('XDG_STATE_HOME', '.local/state'), 'dawnping'),
    launchAgentsDir: join(home, 'Library', 'LaunchAgents'),
    claudeProjectsDir: join(base('CLAUDE_CONFIG_DIR', '.claude'), 'projects'),
  };
}
