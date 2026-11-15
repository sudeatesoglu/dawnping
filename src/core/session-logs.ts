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
  /**
   * Entries logged at or after `since` (epoch ms), oldest first; only from
   * one project folder if `folder` is given.
   */
  entriesSince(since: number, folder?: string): Promise<LogEntry[]>;
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

/**
 * Claude Code runs on the same machine and clock, and logs the answer after
 * the request, so its entry is never earlier than the ping. One second
 * covers rounding only; anything older belongs to an earlier ping.
 */
export const LOG_TOLERANCE_MS = 1_000;

/** The log entry of a ping that started at `startedAt`, if it was logged. */
export function findPingEntry(
  entries: readonly LogEntry[],
  folder: string,
  startedAt: number,
): LogEntry | undefined {
  return entries.find(
    (entry) => entry.folder === folder && entry.timestamp >= startedAt - LOG_TOLERANCE_MS,
  );
}
