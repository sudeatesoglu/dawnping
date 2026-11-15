import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultConfigInput } from '../core/config/schema.ts';
import { loadConfig, saveConfig } from './config-store.ts';
import { readTextFile } from './file-store.ts';

let file: string;
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dawnping-test-'));
  file = join(dir, 'config.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Loads the config or fails the test. */
async function load() {
  const result = await loadConfig(file);
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result;
}

describe('loadConfig', () => {
  it('returns the defaults when no file exists', async () => {
    const result = await load();
    expect(result.source).toBe('defaults');
    expect(result.input).toEqual(defaultConfigInput());
    expect(result.config).toMatchObject({ ping: { model: 'haiku' }, skip: [] });
  });

  it('returns a fresh default object on every load', async () => {
    const first = await load();
    first.input.skip = ['2026-12-31'];
    first.config.skip.push('2026-12-31');
    const second = await load();
    expect(second.input.skip).toBeUndefined();
    expect(second.config.skip).toEqual([]);
  });

  it('reports validation errors from the file', async () => {
    await writeFile(file, JSON.stringify({ version: 1, profiles: {}, skip: ['tomorrow'] }));
    expect(await loadConfig(file)).toEqual({
      ok: false,
      errors: ['skip.0: must be a calendar date like 2026-12-31'],
    });
  });
});

describe('saveConfig', () => {
  it('keeps a hand-written file as it was, plus the change', async () => {
    // No "ping" or "skip" keys, unusual key order.
    const handWritten = `${JSON.stringify(
      {
        profiles: { default: { work: '10:00-18:00', days: ['mon'], trigger: 'auto' } },
        version: 1,
      },
      null,
      2,
    )}\n`;
    await writeFile(file, handWritten);

    const { input, source } = await load();
    expect(source).toBe('file');
    input.timezone = 'Europe/Istanbul';
    await saveConfig(file, input);

    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(Object.keys(saved)).toEqual(['profiles', 'version', 'timezone']);
    expect(Object.keys(saved.profiles.default)).toEqual(['work', 'days', 'trigger']);
    expect(saved.ping).toBeUndefined();
  });

  it('refuses to write an invalid config', async () => {
    const invalid = { ...defaultConfigInput(), timezone: 'Nowhere/City' };
    await expect(saveConfig(file, invalid)).rejects.toThrow(/timezone: must be an IANA/);
    expect(await readTextFile(file)).toBeUndefined();
  });

  it('writes through a symlinked config file and keeps the link', async () => {
    const real = join(dir, 'dotfiles-config.json');
    await writeFile(real, JSON.stringify(defaultConfigInput()));
    await symlink(real, file);

    const { input } = await load();
    input.timezone = 'UTC';
    await saveConfig(file, input);

    expect(JSON.parse(await readFile(real, 'utf8')).timezone).toBe('UTC');
    expect((await load()).input.timezone).toBe('UTC');
  });
});
