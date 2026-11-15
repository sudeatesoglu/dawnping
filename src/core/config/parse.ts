import type { z } from 'zod';
import { type Config, type ConfigInput, ConfigSchema } from './schema.ts';

export type ParseResult =
  | {
      ok: true;
      /** With defaults applied: what the tool reads. */
      config: Config;
      /** Exactly as given: what the CLI edits and saves. */
      input: ConfigInput;
    }
  | { ok: false; errors: string[] };

/**
 * Turns validation issues into one line per problem, naming the key:
 * `profiles.default.work: must be a range like 09:00-18:00 ...`
 */
export function formatIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    const key = issue.path.map(String).join('.');
    return `${key === '' ? 'config' : key}: ${messageOf(issue)}`;
  });
}

function messageOf(issue: z.core.$ZodIssue): string {
  // An invalid record key wraps the key's own issue; show that message
  // instead of the generic "Invalid key in record".
  if (issue.code === 'invalid_key') return issue.issues[0]?.message ?? issue.message;
  // zod reports a missing key as "expected string, received undefined".
  if (issue.code === 'invalid_type' && issue.message.endsWith('received undefined')) {
    return 'is required';
  }
  return issue.message;
}

/**
 * Finds an own "__proto__" key anywhere in a parsed JSON value.
 *
 * JSON.parse creates it as a normal key, but zod skips it while building
 * its output, so a profile named "__proto__" would vanish without an error
 * and be dropped from the file on the next save.
 */
function findProtoKey(value: unknown, path: string[] = []): string[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (key === '__proto__') return [...path, key];
    const found = findProtoKey(child, [...path, key]);
    if (found) return found;
  }
  return undefined;
}

/** Validates an already-parsed value and applies defaults. */
export function parseConfig(value: unknown): ParseResult {
  const protoPath = findProtoKey(value);
  if (protoPath) {
    return { ok: false, errors: [`${protoPath.join('.')}: "__proto__" is not allowed as a key`] };
  }
  const result = ConfigSchema.safeParse(value);
  return result.success
    ? // The value passed validation, so it has the input shape.
      { ok: true, config: result.data, input: value as ConfigInput }
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

/** Serializes a config the way it is stored: readable, newline-terminated. */
export function serializeConfig(input: ConfigInput): string {
  return `${JSON.stringify(input, null, 2)}\n`;
}
