import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { LogEntry, SessionLogs } from '../../core/session-logs.ts';
import { errorCode } from '../errors.ts';

const isMissing = (error: unknown) => errorCode(error) === 'ENOENT';

/** ENOENT, EACCES and the like: the file system said no. */
const isFileSystemError = (error: unknown) => errorCode(error) !== undefined;

async function listOrEmpty(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    // Missing, unreadable or not a folder: nothing to read there.
    if (isFileSystemError(error)) return [];
    throw error;
  }
}

/**
 * Reduces one log line to a LogEntry. Only lines for a model answer count
 * (they carry `message.usage`); everything else, including the message
 * text, is ignored. Malformed lines return undefined.
 *
 * Claude Code also logs rejected requests (a usage limit, an API error) as
 * answers with model "<synthetic>", `isApiErrorMessage: true` and zero
 * tokens. Those are skipped: a rejected request starts no usage window and
 * is not a confirmed ping.
 */
export function parseLogLine(line: string, folder: string): LogEntry | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const { timestamp, message, isApiErrorMessage } = value as {
    timestamp?: unknown;
    message?: unknown;
    isApiErrorMessage?: unknown;
  };
  if (isApiErrorMessage === true) return undefined;
  if (typeof timestamp !== 'string' || typeof message !== 'object' || message === null) {
    return undefined;
  }
  const { usage, model } = message as { usage?: unknown; model?: unknown };
  const time = Date.parse(timestamp);
  if (typeof usage !== 'object' || usage === null || Number.isNaN(time)) return undefined;
  if (model === '<synthetic>') return undefined;
  return { timestamp: time, model: typeof model === 'string' ? model : undefined, folder };
}

/** Entries of one log file, streamed line by line. */
async function readFile(path: string, folder: string, since: number): Promise<LogEntry[]> {
  const entries: LogEntry[] = [];
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of lines) {
    // Only answers carry usage; skip everything else without parsing it.
    if (!line.includes('"usage"')) continue;
    const entry = parseLogLine(line, folder);
    if (entry && entry.timestamp >= since) entries.push(entry);
  }
  return entries;
}

/**
 * Reads `<projectsDir>/<folder>/*.jsonl`. A file that vanishes or cannot
 * be read while scanning (Claude Code rotates and deletes sessions) is
 * skipped, so one bad file never breaks the result.
 */
export function createSessionLogReader(projectsDir: string): SessionLogs {
  return {
    async available() {
      try {
        return (await stat(projectsDir)).isDirectory();
      } catch (error) {
        if (isMissing(error)) return false;
        throw error;
      }
    },

    async entriesSince(since, onlyFolder) {
      const folders =
        onlyFolder === undefined
          ? (await listOrEmpty(projectsDir)).filter((d) => d.isDirectory()).map((d) => d.name)
          : [onlyFolder];
      const entries: LogEntry[] = [];
      for (const folder of folders) {
        const folderPath = join(projectsDir, folder);
        for (const file of await listOrEmpty(folderPath)) {
          if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
          const path = join(folderPath, file.name);
          try {
            // A file not written to since then cannot hold newer entries.
            if ((await stat(path)).mtimeMs < since) continue;
            entries.push(...(await readFile(path, folder, since)));
          } catch (error) {
            if (isFileSystemError(error)) continue;
            throw error;
          }
        }
      }
      return entries.sort((a, b) => a.timestamp - b.timestamp);
    },
  };
}
