import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Reads a UTF-8 file, or returns undefined if it does not exist. */
export async function readTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/**
 * Writes a file so that readers only ever see the old or the new content,
 * never a half-written file: write a temporary file next to it, flush it to
 * disk, rename it over the target, then flush the directory so the rename
 * itself survives a crash. A rename within one directory is atomic on POSIX
 * file systems.
 *
 * If the target is a symlink (e.g. into a dotfiles repository), the file it
 * points to is replaced and the link is kept.
 *
 * Files are private to the user (0600, new directories 0700): they reveal
 * when the user works.
 */
export async function writeFileAtomic(path: string, content: string): Promise<void> {
  const target = await resolveTarget(path);
  const directory = dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  await syncDirectory(directory);
}

/** The real path behind a symlink, or the path itself if nothing exists yet. */
async function resolveTarget(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return path;
    throw error;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
