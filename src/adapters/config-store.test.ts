import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Config, DEFAULT_CONFIG } from '../core/config/schema.ts';
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

describe('loadConfig', () => {
  it('returns the defaults when no file exists', async () => {
    expect(await loadConfig(file)).toEqual({
      ok: true,
      config: DEFAULT_CONFIG,
      source: 'defaults',
    });
  });

  it('loads a saved config', async () => {
    const config: Config = { ...DEFAULT_CONFIG, timezone: 'Europe/Istanbul' };
    await saveConfig(file, config);
    expect(await loadConfig(file)).toEqual({ ok: true, config, source: 'file' });
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
  it('refuses to write an invalid config', async () => {
    const invalid = { ...DEFAULT_CONFIG, timezone: 'Nowhere/City' };
    await expect(saveConfig(file, invalid)).rejects.toThrow(/timezone: must be an IANA/);
    expect(await readTextFile(file)).toBeUndefined();
  });
});
