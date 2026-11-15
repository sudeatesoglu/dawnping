import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { saveConfig } from '../../adapters/config-store.ts';
import { readTextFile } from '../../adapters/file-store.ts';
import { defaultConfigInput } from '../../core/config/schema.ts';
import { createTestContext } from '../test-context.ts';

let t: Awaited<ReturnType<typeof createTestContext>>;

beforeEach(async () => {
  t = await createTestContext();
});

afterEach(async () => {
  await t.cleanup();
});

const readSaved = async () => JSON.parse(await readFile(t.ctx.paths.configFile, 'utf8'));

describe('config path', () => {
  it('prints the config file location', async () => {
    expect((await t.run('config', 'path')).stdout).toBe(`${t.ctx.paths.configFile}\n`);
  });
});

describe('config list', () => {
  it('lists every setting and marks defaults', async () => {
    await saveConfig(t.ctx.paths.configFile, {
      ...defaultConfigInput(),
      timezone: 'Europe/Istanbul',
    });
    const { stdout, code } = await t.run('config', 'list');
    expect(code).toBe(0);
    expect(stdout).toBe(
      [
        'version = 1',
        'timezone = Europe/Istanbul',
        'ping.model = haiku  (default)',
        'profiles.default.days = mon,tue,wed,thu,fri',
        'profiles.default.work = 09:00-18:00',
        'profiles.default.trigger = auto',
        'skip = (none)  (default)',
        '',
      ].join('\n'),
    );
  });
});

describe('config get', () => {
  it('prints a value, including defaults', async () => {
    expect((await t.run('config', 'get', 'profiles.default.days')).stdout).toBe(
      'mon,tue,wed,thu,fri\n',
    );
    expect((await t.run('config', 'get', 'ping.model')).stdout).toBe('haiku\n');
  });

  it('fails for a key that is not set', async () => {
    expect(await t.run('config', 'get', 'timezone')).toEqual({
      code: 1,
      stdout: '',
      stderr: 'Not set: timezone\n',
    });
  });

  it('rejects unsafe keys', async () => {
    expect((await t.run('config', 'get', '__proto__.x')).stderr).toBe(
      'Invalid key: "__proto__.x"\n',
    );
  });
});

describe('config set', () => {
  it('validates and saves a change, creating the file', async () => {
    const result = await t.run('config', 'set', 'profiles.default.work', '10:00-18:00');
    expect(result).toEqual({
      code: 0,
      stdout: 'profiles.default.work = 10:00-18:00\n',
      stderr: '',
    });
    expect((await readSaved()).profiles.default.work).toBe('10:00-18:00');
  });

  it('turns comma-separated values into lists where the setting is a list', async () => {
    await t.run('config', 'set', 'skip', '2026-12-24, 2026-12-31');
    expect((await readSaved()).skip).toEqual(['2026-12-24', '2026-12-31']);
  });

  it('does not save an invalid change and explains why', async () => {
    const result = await t.run('config', 'set', 'profiles.default.work', '18:00-09:00');
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'Not saved, the change would make the config invalid:\n' +
        '  profiles.default.work: must be a range like 09:00-18:00 that ends after it starts\n',
    );
    expect(await readTextFile(t.ctx.paths.configFile)).toBeUndefined();
  });

  it('rejects unknown keys', async () => {
    const result = await t.run('config', 'set', 'timezon', 'UTC');
    expect(result.stderr).toContain('Unrecognized key: "timezon"');
  });

  it('refuses to work on an invalid file and points to config edit', async () => {
    await writeFile(t.ctx.paths.configFile.replace('config.json', ''), '').catch(() => {});
    await saveConfig(t.ctx.paths.configFile, defaultConfigInput());
    await writeFile(t.ctx.paths.configFile, '{ "version": 2, "profiles": {} }');
    const result = await t.run('config', 'set', 'timezone', 'UTC');
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      `The config file is invalid: ${t.ctx.paths.configFile}\n` +
        '  version: must be 1\n' +
        'Fix it with: dawnping config edit\n',
    );
  });
});

describe('config unset', () => {
  it('removes a setting so its default applies again', async () => {
    await t.run('config', 'set', 'ping.model', 'sonnet');
    expect((await t.run('config', 'unset', 'ping.model')).stdout).toBe('Removed ping.model\n');
    expect((await t.run('config', 'get', 'ping.model')).stdout).toBe('haiku\n');
  });

  it('fails for a setting that is not in the file', async () => {
    expect((await t.run('config', 'unset', 'timezone')).stderr).toBe(
      'Not set in the config file: timezone\n',
    );
  });

  it('does not remove a required setting', async () => {
    const result = await t.run('config', 'unset', 'version');
    expect(result.code).toBe(1);
    expect(await readTextFile(t.ctx.paths.configFile)).toBeUndefined();
  });
});

describe('config edit', () => {
  /** An editor that replaces the draft's text. */
  const editorWriting =
    (...texts: string[]) =>
    async (file: string) => {
      await writeFile(file, texts.shift() ?? '');
      return 0;
    };

  it('saves a valid edit with the user formatting', async () => {
    const text =
      '{"version":1,"profiles":{"all":{"days":["mon"],"work":"09:00-17:00","trigger":"auto"}}}\n';
    const e = await createTestContext({ openEditor: editorWriting(text) });
    try {
      const result = await e.run('config', 'edit');
      expect(result).toEqual({ code: 0, stdout: `Saved ${e.ctx.paths.configFile}\n`, stderr: '' });
      expect(await readTextFile(e.ctx.paths.configFile)).toBe(text);
    } finally {
      await e.cleanup();
    }
  });

  it('reports no changes when the draft was not edited', async () => {
    expect((await t.run('config', 'edit')).stdout).toBe('No changes.\n');
    expect(await readTextFile(t.ctx.paths.configFile)).toBeUndefined();
  });

  it('keeps an invalid edit out of the config and offers to edit again', async () => {
    const asked: string[] = [];
    const valid = '{"version":1,"profiles":{}}\n';
    const e = await createTestContext({
      openEditor: editorWriting('{ broken', valid),
      interactive: true,
      confirm: async (question) => {
        asked.push(question);
        return true;
      },
    });
    try {
      const result = await e.run('config', 'edit');
      expect(result.code).toBe(0);
      expect(result.stderr).toMatch(/^The edited config is invalid:\n {2}config: not valid JSON/);
      expect(asked).toEqual(['Edit again?']);
      expect(await readTextFile(e.ctx.paths.configFile)).toBe(valid);
    } finally {
      await e.cleanup();
    }
  });

  it('keeps the draft when the user does not edit again', async () => {
    const e = await createTestContext({ openEditor: editorWriting('{ broken') });
    try {
      const result = await e.run('config', 'edit');
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/Not saved\. Your edits are kept in .*config\.json\n$/);
      expect(await readTextFile(e.ctx.paths.configFile)).toBeUndefined();
    } finally {
      await e.cleanup();
    }
  });

  it('changes nothing when the editor fails', async () => {
    const e = await createTestContext({ openEditor: async () => 2 });
    try {
      expect((await e.run('config', 'edit')).stderr).toBe(
        'The editor exited with code 2; nothing was changed.\n',
      );
    } finally {
      await e.cleanup();
    }
  });
});
