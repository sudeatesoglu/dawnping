/** Port: read-only facts about the machine, for `doctor`. */
export interface SystemProbe {
  /** `claude --version`, or undefined if claude is not installed. */
  claudeVersion(): Promise<string | undefined>;
  /** `pmset -g sched` output, or undefined where there is no pmset. */
  wakeSchedule(): Promise<string | undefined>;
}
