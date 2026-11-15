import type { z } from 'zod';
import { type Config, ConfigSchema } from './schema.ts';

export type ParseResult = { ok: true; config: Config } | { ok: false; errors: string[] };

/**
 * Turns validation issues into one line per problem, naming the key:
 * `profiles.default.work: must be a range like 09:00-18:00 ...`
 */
export function formatIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    const key = issue.path.map(String).join('.');
    return `${key === '' ? 'config' : key}: ${issue.message}`;
  });
}

/** Validates an already-parsed value and applies defaults. */
export function parseConfig(value: unknown): ParseResult {
  const result = ConfigSchema.safeParse(value);
  return result.success
    ? { ok: true, config: result.data }
    : { ok: false, errors: formatIssues(result.error.issues) };
}

/** Parses the text of a config file. */
export function parseConfigText(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [`config: not valid JSON (${reason})`] };
  }
  return parseConfig(value);
}

/** Serializes a config the way it is stored: stable, readable, newline-terminated. */
export function serializeConfig(config: Config): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}
