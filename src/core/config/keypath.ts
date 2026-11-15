import type { SettingKind } from './kinds.ts';

/**
 * Dot-separated key paths into the config, e.g. `profiles.friday.work`.
 *
 * Pure helpers that never mutate their input: each change returns a new
 * object, so a failed validation leaves the loaded config untouched.
 */

type Json = Record<string, unknown>;

// Assigning to "__proto__" changes an object's prototype instead of adding
// data (prototype pollution). Other names such as "constructor" are safe
// here: reads check own keys only and writes use object literals.
const FORBIDDEN = new Set(['__proto__']);

/** Splits a key path, or returns undefined if it is empty or unsafe. */
export function parseKeyPath(key: string): string[] | undefined {
  const parts = key.split('.');
  if (parts.some((part) => part === '' || FORBIDDEN.has(part))) return undefined;
  return parts;
}

export function isPlainObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value at a path, or undefined if any segment is missing. */
export function getAt(root: unknown, path: readonly string[]): unknown {
  let current = root;
  for (const part of path) {
    if (!isPlainObject(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

/** A copy of `root` with the value at `path` set, creating objects on the way. */
export function setAt(root: Json, path: readonly string[], value: unknown): Json {
  const [head, ...rest] = path;
  if (head === undefined) throw new Error('Empty key path');
  const child = root[head];
  return {
    ...root,
    [head]: rest.length === 0 ? value : setAt(isPlainObject(child) ? child : {}, rest, value),
  };
}

/**
 * A copy of `root` without the value at `path`, or undefined if it was not
 * set. With `pruneEmpty`, objects left empty are removed too, so unsetting
 * `ping.model` can remove `ping` and let its default apply again.
 */
export function unsetAt(
  root: Json,
  path: readonly string[],
  { pruneEmpty = false }: { pruneEmpty?: boolean } = {},
): Json | undefined {
  const [head, ...rest] = path;
  if (head === undefined || !Object.hasOwn(root, head)) return undefined;
  if (rest.length === 0) {
    const { [head]: _removed, ...remaining } = root;
    return remaining;
  }
  const child = root[head];
  if (!isPlainObject(child)) return undefined;
  const updated = unsetAt(child, rest, { pruneEmpty });
  if (updated === undefined) return undefined;
  if (pruneEmpty && Object.keys(updated).length === 0) {
    const { [head]: _emptied, ...remaining } = root;
    return remaining;
  }
  return { ...root, [head]: updated };
}

/** Splits a comma-separated command-line list: trimmed, no empties, no duplicates. */
export function splitList(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== ''),
    ),
  ];
}

/**
 * Converts a command-line string to the kind of value the setting holds, so
 * `config set skip 2026-12-24,2026-12-31` sets a list and
 * `config set version 1` sets a number. Validation decides the rest.
 */
export function coerceValue(raw: string, kind: SettingKind | undefined): unknown {
  if (kind === 'list') return splitList(raw);
  if (kind === 'number' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
  if (kind === 'boolean' && (raw === 'true' || raw === 'false')) return raw === 'true';
  return raw;
}

/** How a value is shown on the command line: lists comma-separated. */
export function displayValue(value: unknown): string {
  if (Array.isArray(value) && value.length === 0) return '(none)';
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.join(',');
  }
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** All leaf values with their key paths, in key order. */
export function flatten(value: unknown, prefix: readonly string[] = []): [string[], unknown][] {
  if (!isPlainObject(value)) return [[[...prefix], value]];
  const entries = Object.entries(value);
  if (entries.length === 0) return [[[...prefix], value]];
  return entries.flatMap(([key, child]) => flatten(child, [...prefix, key]));
}
