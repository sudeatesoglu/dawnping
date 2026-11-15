import { describe, expect, it } from 'vitest';
import { parseConfig, parseConfigText, serializeConfig } from './parse.ts';
import { DEFAULT_CONFIG } from './schema.ts';

const minimal = {
  version: 1,
  profiles: { default: { days: ['mon'], work: '10:00-18:00', trigger: 'auto' } },
};

/** Returns the error lines for an invalid input, or fails the test. */
function errorsOf(value: unknown): string[] {
  const result = parseConfig(value);
  if (result.ok) throw new Error('expected the config to be invalid');
  return result.errors;
}

describe('parseConfig', () => {
  it('accepts the defaults', () => {
    expect(parseConfig(DEFAULT_CONFIG)).toEqual({ ok: true, config: DEFAULT_CONFIG });
  });

  it('fills in defaults for omitted sections', () => {
    const result = parseConfig(minimal);
    expect(result.ok && result.config).toMatchObject({ ping: { model: 'haiku' }, skip: [] });
  });

  it('names the key and the problem', () => {
    const config = {
      ...minimal,
      profiles: { default: { days: ['mon'], work: '25:00-18:00', trigger: 'auto' } },
    };
    expect(errorsOf(config)).toEqual([
      'profiles.default.work: must be a range like 09:00-18:00 that ends after it starts',
    ]);
  });

  it('reports every problem, not only the first', () => {
    const config = {
      version: 1,
      timezone: 'Mars/Olympus',
      profiles: { default: { days: ['someday'], work: '09:00-18:00', trigger: '6am' } },
    };
    expect(errorsOf(config)).toEqual([
      'timezone: must be an IANA time zone like Europe/Istanbul',
      'profiles.default.days.0: must be one of mon, tue, wed, thu, fri, sat, sun',
      'profiles.default.trigger: must be "auto" or a time like 06:30',
    ]);
  });

  it('rejects unknown keys, so typos do not pass silently', () => {
    expect(errorsOf({ ...minimal, timezon: 'UTC' })).toEqual([
      'config: Unrecognized key: "timezon"',
    ]);
  });

  it('rejects a weekday that belongs to two profiles', () => {
    const config = {
      version: 1,
      profiles: {
        default: { days: ['mon', 'fri'], work: '09:00-18:00', trigger: 'auto' },
        friday: { days: ['fri'], work: '10:00-15:00', trigger: '07:00' },
      },
    };
    expect(errorsOf(config)).toEqual([
      'profiles.friday.days: fri already belongs to profile "default"',
    ]);
  });

  it('allows a day listed twice in the same profile', () => {
    const config = {
      version: 1,
      profiles: { default: { days: ['mon', 'mon'], work: '09:00-18:00', trigger: 'auto' } },
    };
    expect(parseConfig(config).ok).toBe(true);
  });

  it('validates profile names', () => {
    const config = { ...minimal, profiles: { 'Late Fridays': minimal.profiles.default } };
    expect(errorsOf(config)).toEqual([
      'profiles.Late Fridays: name must start with a letter and use only a-z, 0-9 and "-" (max 32)',
    ]);
  });

  it('validates skip dates', () => {
    expect(errorsOf({ ...minimal, skip: ['2026-02-30'] })).toEqual([
      'skip.0: must be a calendar date like 2026-12-31',
    ]);
  });

  it('requires a supported format version', () => {
    expect(errorsOf({ ...minimal, version: 2 })).toEqual(['version: must be 1']);
  });
});

describe('parseConfigText', () => {
  it('parses JSON text', () => {
    expect(parseConfigText(JSON.stringify(minimal)).ok).toBe(true);
  });

  it('reports invalid JSON', () => {
    const result = parseConfigText('{ "version": 1,');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors[0]).toMatch(/^config: not valid JSON \(/);
  });
});

describe('serializeConfig', () => {
  it('round-trips through parseConfigText', () => {
    const text = serializeConfig(DEFAULT_CONFIG);
    expect(text.endsWith('}\n')).toBe(true);
    expect(parseConfigText(text)).toEqual({ ok: true, config: DEFAULT_CONFIG });
  });
});
