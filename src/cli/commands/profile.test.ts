import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from '../test-context.ts';

let t: Awaited<ReturnType<typeof createTestContext>>;

beforeEach(async () => {
  t = await createTestContext();
});

afterEach(async () => {
  await t.cleanup();
});

const savedProfiles = async () =>
  JSON.parse(await readFile(t.ctx.paths.configFile, 'utf8')).profiles;

describe('profile list', () => {
  it('lists profiles and rest days', async () => {
    expect((await t.run('profile', 'list')).stdout).toBe(
      [
        'default  mon,tue,wed,thu,fri          09:00-18:00  trigger auto',
        'rest     sat,sun',
        '',
      ].join('\n'),
    );
  });
});

describe('profile add', () => {
  it('adds a profile for free days', async () => {
    const result = await t.run(
      'profile',
      'add',
      'weekend',
      '--days',
      'sat,sun',
      '--work',
      '11:00-14:00',
    );
    expect(result).toEqual({ code: 0, stdout: 'Added profile "weekend"\n', stderr: '' });
    expect((await savedProfiles()).weekend).toEqual({
      days: ['sat', 'sun'],
      work: '11:00-14:00',
      trigger: 'auto',
    });
  });

  it('refuses days another profile has and suggests --take', async () => {
    const result = await t.run(
      'profile',
      'add',
      'friday',
      '--days',
      'fri',
      '--work',
      '10:00-15:00',
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toBe(
      'fri already belongs to profile "default".\n' +
        'Add --take to move these days to the new profile.\n',
    );
  });

  it('moves days with --take', async () => {
    await t.run(
      'profile',
      'add',
      'friday',
      '--days',
      'Fri',
      '--work',
      '10:00-15:00',
      '--trigger',
      '07:00',
      '--take',
    );
    const profiles = await savedProfiles();
    expect(profiles.default.days).toEqual(['mon', 'tue', 'wed', 'thu']);
    expect(profiles.friday).toEqual({ days: ['fri'], work: '10:00-15:00', trigger: '07:00' });
  });

  it('does not leave a profile without days', async () => {
    const result = await t.run(
      'profile',
      'add',
      'all',
      '--days',
      'mon,tue,wed,thu,fri',
      '--work',
      '09:00-17:00',
      '--take',
    );
    expect(result.stderr).toBe(
      'Taking mon,tue,wed,thu,fri would leave profile "default" without days.\n' +
        'Remove it first: dawnping profile remove default\n',
    );
  });

  it('validates the new profile', async () => {
    const result = await t.run('profile', 'add', 'Late', '--days', 'sat', '--work', '25:00-26:00');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('profiles.Late: name must start with a letter');
  });

  it('refuses an existing name', async () => {
    const result = await t.run(
      'profile',
      'add',
      'default',
      '--days',
      'sat',
      '--work',
      '09:00-12:00',
    );
    expect(result.stderr).toBe(
      'Profile "default" already exists.\n' +
        'Change it with: dawnping config set profiles.default.<key> <value>\n',
    );
  });

  it('requires --days and --work', async () => {
    const result = await t.run('profile', 'add', 'x', '--days', 'sat');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("required option '--work <range>' not specified");
  });
});

describe('profile remove', () => {
  it('removes a profile; its days become rest days', async () => {
    await t.run('profile', 'add', 'weekend', '--days', 'sat,sun', '--work', '11:00-14:00');
    expect((await t.run('profile', 'remove', 'weekend')).stdout).toBe(
      'Removed profile "weekend"\n',
    );
    expect((await t.run('profile', 'list')).stdout).toContain('rest     sat,sun');
  });

  it('fails for an unknown profile', async () => {
    expect((await t.run('profile', 'remove', 'nope')).stderr).toBe('No profile named "nope".\n');
  });
});
