import { parseConfig, parseConfigText, serializeConfig } from '../core/config/parse.ts';
import { type Config, type ConfigInput, defaultConfigInput } from '../core/config/schema.ts';
import { readTextFile, writeFileAtomic } from './file-store.ts';

export type LoadResult =
  | { ok: true; config: Config; input: ConfigInput; source: 'file' | 'defaults' }
  | { ok: false; errors: string[] };

/** Loads the config file; a missing file means the defaults. */
export async function loadConfig(file: string): Promise<LoadResult> {
  const text = await readTextFile(file);
  const source = text === undefined ? 'defaults' : 'file';
  // A fresh default object per load, so a caller that edits it cannot
  // change the defaults for the rest of the process.
  const result = text === undefined ? parseConfig(defaultConfigInput()) : parseConfigText(text);
  return result.ok ? { ...result, source } : result;
}

/**
 * Validates and writes the config as given (no defaults added, key order
 * kept). An invalid config is never written, even if a caller forgot to
 * validate it first.
 */
export async function saveConfig(file: string, input: ConfigInput): Promise<void> {
  const result = parseConfig(input);
  if (!result.ok) {
    throw new Error(`Refusing to save an invalid config:\n${result.errors.join('\n')}`);
  }
  await writeFileAtomic(file, serializeConfig(input));
}
