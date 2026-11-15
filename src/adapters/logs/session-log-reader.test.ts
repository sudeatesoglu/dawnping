import { chmod, mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionLogReader, parseLogLine } from './session-log-reader.ts';

const SINCE = Date.parse('2026-11-15T16:00:00Z');

/** A model answer as Claude Code logs it, with message text that must never be read. */
const answer = (timestamp: string, model = 'claude-haiku-5-5') =>
  JSON.stringify({
    type: 'assistant',
    timestamp,
    message: {
      model,
      role: 'assistant',
      content: [{ type: 'text', text: 'SECRET MESSAGE TEXT' }],
      usage: { input_tokens: 2, output_tokens: 4 },
    },
  });

const userMessage = (timestamp: string) =>
  JSON.stringify({ type: 'user', timestamp, message: { role: 'user', content: 'SECRET PROMPT' } });

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dawnping-logs-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function logFile(folder: string, name: string, lines: string[], mtime?: Date) {
  await mkdir(join(dir, folder), { recursive: true });
  const path = join(dir, folder, name);
  await writeFile(path, `${lines.join('\n')}\n`);
  if (mtime) await utimes(path, mtime, mtime);
}

describe('parseLogLine', () => {
  it('keeps only time, model and folder of a model answer', () => {
    expect(parseLogLine(answer('2026-11-15T16:32:15.063Z'), '-ping')).toEqual({
      timestamp: Date.parse('2026-11-15T16:32:15.063Z'),
      model: 'claude-haiku-5-5',
      folder: '-ping',
    });
  });

  it.each([
    ['a user message', userMessage('2026-11-15T16:32:15Z')],
    ['malformed JSON', '{"timestamp": '],
    ['a non-object', '42'],
    ['a bad timestamp', answer('yesterday')],
    ['no message', JSON.stringify({ timestamp: '2026-11-15T16:32:15Z' })],
  ])('skips %s', (_, line) => {
    expect(parseLogLine(line, '-ping')).toBeUndefined();
  });

  it('accepts an answer without a model name', () => {
    const line = JSON.stringify({ timestamp: '2026-11-15T16:32:15Z', message: { usage: {} } });
    expect(parseLogLine(line, '-x')?.model).toBeUndefined();
  });
});

describe('createSessionLogReader', () => {
  it('returns answers since a time from every project folder, oldest first', async () => {
    await logFile('-ping', 'a.jsonl', [
      answer('2026-11-15T15:59:59Z'),
      'not json',
      userMessage('2026-11-15T16:32:14Z'),
      answer('2026-11-15T16:32:15Z'),
    ]);
    await logFile('-work', 'b.jsonl', [answer('2026-11-15T16:10:00Z', 'claude-opus-5-5')]);

    const entries = await createSessionLogReader(dir).entriesSince(SINCE);
    expect(entries).toEqual([
      { timestamp: Date.parse('2026-11-15T16:10:00Z'), model: 'claude-opus-5-5', folder: '-work' },
      { timestamp: Date.parse('2026-11-15T16:32:15Z'), model: 'claude-haiku-5-5', folder: '-ping' },
    ]);
    expect(JSON.stringify(entries)).not.toContain('SECRET');
  });

  it('skips files not written to since then, and files that are not logs', async () => {
    await logFile(
      '-old',
      'old.jsonl',
      [answer('2026-11-15T16:30:00Z')],
      new Date('2026-11-14T00:00:00Z'),
    );
    await logFile('-x', 'notes.txt', [answer('2026-11-15T16:30:00Z')]);
    await writeFile(join(dir, 'stray-file'), 'x');
    expect(await createSessionLogReader(dir).entriesSince(SINCE)).toEqual([]);
  });

  it('reads only one folder when asked', async () => {
    await logFile('-ping', 'a.jsonl', [answer('2026-11-15T16:32:15Z')]);
    await logFile('-work', 'b.jsonl', [answer('2026-11-15T16:10:00Z')]);
    const entries = await createSessionLogReader(dir).entriesSince(SINCE, '-ping');
    expect(entries.map((e) => e.folder)).toEqual(['-ping']);
    expect(await createSessionLogReader(dir).entriesSince(SINCE, '-missing')).toEqual([]);
  });

  it('skips a file it cannot read instead of failing', async () => {
    await logFile('-ping', 'a.jsonl', [answer('2026-11-15T16:32:15Z')]);
    await logFile('-other', 'locked.jsonl', [answer('2026-11-15T16:33:00Z')]);
    await chmod(join(dir, '-other', 'locked.jsonl'), 0o000);
    try {
      const entries = await createSessionLogReader(dir).entriesSince(SINCE);
      // Root can read anything; everyone else skips the locked file.
      expect(entries.map((e) => e.folder)).toContain('-ping');
    } finally {
      await chmod(join(dir, '-other', 'locked.jsonl'), 0o600);
    }
  });

  it('treats a missing projects directory as empty', async () => {
    const reader = createSessionLogReader(join(dir, 'missing'));
    expect(await reader.entriesSince(SINCE)).toEqual([]);
    expect(await reader.available()).toBe(false);
    expect(await createSessionLogReader(dir).available()).toBe(true);
  });
});
