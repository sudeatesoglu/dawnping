import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

const hasCode = (error: unknown, code: string) =>
  error instanceof Error && 'code' in error && error.code === code;

export interface LockOptions {
  /** A lock older than this was left by a crashed run and is taken over. */
  staleMs?: number;
  now?: () => number;
}

/**
 * Takes an exclusive lock by creating a file that must not exist yet
 * (O_EXCL), which the file system guarantees only one process can do.
 * Resolves with a release function, or undefined if another run holds it.
 */
export async function acquireLock(
  path: string,
  { staleMs = 10 * 60_000, now = Date.now }: LockOptions = {},
): Promise<(() => Promise<void>) | undefined> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.close();
      return () => rm(path, { force: true });
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      const age = await stat(path).then(
        (info) => now() - info.mtimeMs,
        () => Number.POSITIVE_INFINITY,
      );
      if (age < staleMs) return undefined;
      await rm(path, { force: true });
    }
  }
  return undefined;
}
