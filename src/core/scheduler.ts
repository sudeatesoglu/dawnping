/**
 * Port: runs `dawnping tick` periodically in the background.
 *
 * The CLI only knows this interface. macOS uses launchd; another platform
 * (systemd timers on Linux) would be a new adapter, with no change here.
 */
export interface AgentSpec {
  /** Absolute program and arguments, e.g. [node, /path/to/cli.js, "tick"]. */
  programArguments: string[];
  /** How often to run, in seconds. */
  intervalSeconds: number;
  /** Where the agent's output goes. */
  logFile: string;
  /** Environment the agent runs with (background jobs get a minimal one). */
  environment: Record<string, string>;
}

export interface Scheduler {
  /** Installs or replaces the agent and starts it. Safe to run again. */
  install(spec: AgentSpec): Promise<void>;
  /** Stops and removes the agent; false if it was not installed. */
  uninstall(): Promise<boolean>;
  /** True if the agent is loaded and will run. */
  isInstalled(): Promise<boolean>;
  /** Where the agent definition lives, for messages. */
  readonly location: string;
}

export const TICK_INTERVAL_SECONDS = 5 * 60;

/** Variables a background agent needs from the user's shell, if set. */
const PASSED_THROUGH = ['XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'CLAUDE_CONFIG_DIR'];

/**
 * The environment for the background agent. launchd starts jobs with a
 * minimal PATH (/usr/bin:/bin:...), where `claude` is usually not found,
 * so the user's PATH at install time is kept, minus node_modules/.bin. Config locations are passed
 * through so the agent reads the same files as the CLI.
 */
export function agentEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  // Entries a package manager adds while running a script would point the
  // agent at one project's tools forever.
  const path = (env['PATH'] ?? '')
    .split(':')
    .filter((entry) => entry !== '' && !/[\\/]node_modules[\\/]\.bin\/?$/.test(entry))
    .join(':');
  const result: Record<string, string> = { PATH: path || '/usr/bin:/bin:/usr/sbin:/sbin' };
  for (const name of PASSED_THROUGH) {
    const value = env[name];
    if (value) result[name] = value;
  }
  return result;
}
