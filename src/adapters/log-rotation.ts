import { rename, stat } from 'node:fs/promises';

/**
 * Keeps a log bounded: above `maxBytes` it becomes `<path>.1`, replacing an
 * older one, and a new log starts. launchd opens the log for each run, so
 * the next run writes to a fresh file.
 */
export async function rotateLog(path: string, maxBytes: number): Promise<boolean> {
  try {
    if ((await stat(path)).size <= maxBytes) return false;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
  await rename(path, `${path}.1`);
  return true;
}
