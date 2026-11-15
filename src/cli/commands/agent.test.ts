import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Scheduler } from '../../core/scheduler.ts';
import { createFakeScheduler, createTestContext } from '../test-context.ts';

let t: Awaited<ReturnType<typeof createTestContext>>;
let scheduler: ReturnType<typeof createFakeScheduler>;

beforeEach(async () => {
  scheduler = createFakeScheduler();
  t = await createTestContext({ scheduler });
});

afterEach(async () => {
  await t.cleanup();
});

describe('install', () => {
  it('installs an agent that runs tick with the user PATH', async () => {
    const result = await t.run('install');
    expect(result.code).toBe(0);
    expect(scheduler.installed).toEqual({
      programArguments: ['/usr/local/bin/node', '/usr/local/lib/dawnping/dist/cli.js', 'tick'],
      intervalSeconds: 300,
      logFile: `${t.ctx.paths.stateDir}/tick.log`,
      environment: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' },
    });
    expect(result.stdout).toBe(
      'Installed. dawnping checks every 5 minutes whether to ping.\n' +
        '  Agent: /fake/LaunchAgents/dawnping.plist\n' +
        `  Log:   ${t.ctx.paths.stateDir}/tick.log\n` +
        'Undo with: dawnping uninstall\n',
    );
  });

  it('refuses to install from a temporary npx cache', async () => {
    const e = await createTestContext({
      scheduler,
      invocation: {
        node: '/n',
        script: '/Users/u/.npm/_npx/abc123/node_modules/dawnping/dist/cli.js',
      },
    });
    try {
      const result = await e.run('install');
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('Install it first: npm install --global dawnping');
      expect(scheduler.installed).toBeUndefined();
    } finally {
      await e.cleanup();
    }
  });

  it('refuses to install with an invalid config', async () => {
    await t.run('config', 'set', 'timezone', 'UTC');
    await writeFile(t.ctx.paths.configFile, '{');
    expect((await t.run('install')).stderr).toContain('The config file is invalid');
    expect(scheduler.installed).toBeUndefined();
  });

  it('reports scheduler errors without a stack trace', async () => {
    const failing: Scheduler = {
      ...createFakeScheduler(),
      install: async () => {
        throw new Error('launchctl bootstrap failed (exit 5)');
      },
      uninstall: async () => {
        throw new Error('launchctl bootout failed');
      },
    };
    const e = await createTestContext({ scheduler: failing });
    try {
      expect(await e.run('install')).toEqual({
        code: 1,
        stdout: '',
        stderr: 'Could not install the background agent: launchctl bootstrap failed (exit 5)\n',
      });
      expect((await e.run('uninstall')).stderr).toBe(
        'Could not remove the background agent: launchctl bootout failed\n',
      );
    } finally {
      await e.cleanup();
    }
  });
});

describe('uninstall', () => {
  it('removes an installed agent', async () => {
    await t.run('install');
    expect((await t.run('uninstall')).stdout).toBe(
      'Uninstalled. dawnping no longer runs in the background.\n',
    );
    expect(scheduler.installed).toBeUndefined();
  });

  it('says so when nothing is installed', async () => {
    expect((await t.run('uninstall')).stdout).toBe('Not installed.\n');
  });
});

describe('tick', () => {
  it('is hidden from help and only records that it ran for now', async () => {
    expect((await t.run('--help')).stdout).not.toContain('tick');
    expect((await t.run('tick')).stdout).toBe(
      '2026-11-15T06:00:00.000Z tick: no planner yet, nothing to do\n',
    );
  });
});
