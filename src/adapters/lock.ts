import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { errorCode } from './errors.ts';

export interface LockOptions {
  /** A lock older than this was left by a crashed run and is taken over. */
  staleMs?: number;
  now?: () => number;
}

/**
 * Takes an exclusive lock by creating a file that must not exist yet
 * (O_EXCL), which the file system guarantees only one process can do. The
 * file holds a random token, and release only deletes a lock that still
 * holds it, so a run never removes a lock another run took over.
 *
 * Taking over a stale lock is not atomic: two runs that both find the same
 * stale lock can, rarely, both get in. For dawnping the worst case is a
 * second ping on the same day, which costs nothing (ADR-0003).
 *
 * Resolves with a release function, or undefined if another run holds it.
 */
export async function acquireLock(
  path: string,
  { staleMs = 10 * 60_000, now = Date.now }: LockOptions = {},
): Promise<(() => Promise<void>) | undefined> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try {
        await handle.writeFile(token);
      } finally {
        await handle.close();
      }
      return async () => {
        const holder = await readFile(path, 'utf8').catch(() => undefined);
        if (holder === token) await rm(path, { force: true });
      };
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
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
