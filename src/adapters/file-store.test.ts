import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTextFile, writeFileAtomic } from './file-store.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dawnping-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readTextFile', () => {
  it('returns undefined for a missing file', async () => {
    expect(await readTextFile(join(dir, 'missing.json'))).toBeUndefined();
  });

  it('rethrows other errors', async () => {
    // Reading a directory fails with EISDIR, not ENOENT.
    await expect(readTextFile(dir)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});

describe('writeFileAtomic', () => {
  it('creates missing directories and writes the content', async () => {
    const file = join(dir, 'a', 'b', 'config.json');
    await writeFileAtomic(file, 'hello');
    expect(await readTextFile(file)).toBe('hello');
  });

  it('replaces existing content and leaves no temporary files', async () => {
    const file = join(dir, 'config.json');
    await writeFileAtomic(file, 'old');
    await writeFileAtomic(file, 'new');
    expect(await readTextFile(file)).toBe('new');
    expect(await readdir(dir)).toEqual(['config.json']);
  });

  it('makes files and new directories private to the user', async () => {
    const file = join(dir, 'private', 'state.json');
    await writeFileAtomic(file, '{}');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(join(dir, 'private'))).mode & 0o777).toBe(0o700);
  });

  it('leaves the target untouched and cleans up when the final rename fails', async () => {
    // Renaming a file over a non-empty directory fails.
    const target = join(dir, 'config.json');
    await mkdir(target);
    await writeFile(join(target, 'keep'), 'x');

    await expect(writeFileAtomic(target, 'new')).rejects.toThrow();
    expect(await readdir(target)).toEqual(['keep']);
    expect(await readdir(dir)).toEqual(['config.json']);
  });
});
