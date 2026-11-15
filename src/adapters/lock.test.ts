import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock } from './lock.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dawnping-lock-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('acquireLock', () => {
  it('lets only one holder in at a time', async () => {
    const path = join(dir, 'state', 'tick.lock');
    const release = await acquireLock(path);
    expect(release).toBeDefined();
    expect(await acquireLock(path)).toBeUndefined();
    await release?.();
    expect(await acquireLock(path)).toBeDefined();
  });

  it('takes over a lock left behind by a crashed run', async () => {
    const path = join(dir, 'tick.lock');
    await writeFile(path, '');
    const old = new Date(Date.now() - 20 * 60_000);
    await utimes(path, old, old);
    expect(await acquireLock(path)).toBeDefined();
  });
});
