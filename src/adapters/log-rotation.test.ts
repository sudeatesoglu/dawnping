import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTextFile } from './file-store.ts';
import { rotateLog } from './log-rotation.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dawnping-rotate-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('rotateLog', () => {
  it('keeps a small log', async () => {
    const log = join(dir, 'tick.log');
    await writeFile(log, 'short');
    expect(await rotateLog(log, 10)).toBe(false);
    expect(await readFile(log, 'utf8')).toBe('short');
  });

  it('moves a large log aside, replacing the older one', async () => {
    const log = join(dir, 'tick.log');
    await writeFile(`${log}.1`, 'oldest');
    await writeFile(log, 'x'.repeat(20));
    expect(await rotateLog(log, 10)).toBe(true);
    expect(await readTextFile(log)).toBeUndefined();
    expect(await readFile(`${log}.1`, 'utf8')).toBe('x'.repeat(20));
  });

  it('does nothing without a log', async () => {
    expect(await rotateLog(join(dir, 'missing.log'), 10)).toBe(false);
  });
});
