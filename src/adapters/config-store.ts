import {
  type ParseResult,
  parseConfig,
  parseConfigText,
  serializeConfig,
} from '../core/config/parse.ts';
import { type Config, DEFAULT_CONFIG } from '../core/config/schema.ts';
import { readTextFile, writeFileAtomic } from './file-store.ts';

export type LoadResult =
  | (ParseResult & { ok: true; source: 'file' | 'defaults' })
  | (ParseResult & { ok: false });

/** Loads the config file; a missing file means the defaults. */
export async function loadConfig(file: string): Promise<LoadResult> {
  const text = await readTextFile(file);
  if (text === undefined) return { ok: true, config: DEFAULT_CONFIG, source: 'defaults' };
  const result = parseConfigText(text);
  return result.ok ? { ...result, source: 'file' } : result;
}

/**
 * Validates and writes the config atomically. An invalid config is never
 * written, even if a caller forgot to validate it first.
 */
export async function saveConfig(file: string, config: Config): Promise<void> {
  const result = parseConfig(config);
  if (!result.ok) {
    throw new Error(`Refusing to save an invalid config:\n${result.errors.join('\n')}`);
  }
  await writeFileAtomic(file, serializeConfig(result.config));
}
