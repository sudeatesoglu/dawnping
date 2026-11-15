/**
 * Port: Claude Code's local session logs, reduced to what dawnping needs.
 *
 * Only when a model answered, which model, and in which project folder.
 * Message content is never read (see the README's privacy section).
 */
export interface LogEntry {
  /** When the answer was logged, epoch ms. */
  timestamp: number;
  model: string | undefined;
  /** The project folder under ~/.claude/projects the entry is in. */
  folder: string;
}

export interface SessionLogs {
  /** Entries logged at or after `since` (epoch ms), oldest first. */
  entriesSince(since: number): Promise<LogEntry[]>;
  /** True if Claude Code's projects directory exists at all. */
  available(): Promise<boolean>;
}

/**
 * The folder Claude Code logs a session in, from the working directory's
 * real path: every character other than a letter, digit or "-" becomes
 * "-". Observed, not documented (ADR-0003): "/", "." and "_" all do.
 */
export function projectFolderName(realPath: string): string {
  return realPath.replace(/[^A-Za-z0-9-]/g, '-');
}

/** Tolerance for the clock of the log writer and ours differing slightly. */
export const CLOCK_SKEW_MS = 60_000;

/** The log entry of a ping that started at `startedAt`, if it was logged. */
export function findPingEntry(
  entries: readonly LogEntry[],
  folder: string,
  startedAt: number,
): LogEntry | undefined {
  return entries.find(
    (entry) => entry.folder === folder && entry.timestamp >= startedAt - CLOCK_SKEW_MS,
  );
}
