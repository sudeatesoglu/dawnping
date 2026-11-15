import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentSpec } from '../../core/scheduler.ts';
import type { CommandResult } from '../process.ts';
import { buildPlist, createLaunchdScheduler, LAUNCHD_LABEL } from './launchd.ts';

const spec = (dir: string): AgentSpec => ({
  programArguments: ['/usr/local/bin/node', '/opt/dawnping & co/cli.js', 'tick'],
  intervalSeconds: 300,
  logFile: join(dir, 'state', 'tick.log'),
  environment: { PATH: '/opt/homebrew/bin:/usr/bin' },
});

describe('buildPlist', () => {
  it('describes the agent and escapes XML', () => {
    const plist = buildPlist('test.label', spec('/s'));
    expect(plist).toContain('<string>/opt/dawnping &amp; co/cli.js</string>');
    expect(plist).toContain('<key>StartInterval</key>\n  <integer>300</integer>');
    expect(plist).toContain('<key>PATH</key>\n    <string>/opt/homebrew/bin:/usr/bin</string>');
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>');
  });

  it.runIf(process.platform === 'darwin')('passes plutil -lint', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dawnping-plist-'));
    try {
      const file = join(dir, 'agent.plist');
      await writeFile(file, buildPlist('test.label', spec(dir)));
      expect(execFileSync('plutil', ['-lint', file], { encoding: 'utf8' })).toContain('OK');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('createLaunchdScheduler', () => {
  let dir: string;
  let calls: string[];
  /** How many more `print` calls report the job as loaded. */
  let loadedFor: number;
  let results: Partial<Record<string, CommandResult>>;

  const ok: CommandResult = { code: 0, stdout: '', stderr: '' };

  const scheduler = () =>
    createLaunchdScheduler({
      launchAgentsDir: join(dir, 'LaunchAgents'),
      uid: 501,
      sleep: async () => {},
      run: async (program, args) => {
        const [verb = ''] = args;
        calls.push([program, ...args].join(' '));
        const forced = results[verb];
        if (forced) return forced;
        if (verb === 'print') {
          if (loadedFor > 0) {
            loadedFor -= 1;
            return ok;
          }
          return { code: 113, stdout: '', stderr: 'Could not find service' };
        }
        return ok;
      },
    });

  const plistPath = () => join(dir, 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
  const service = `gui/501/${LAUNCHD_LABEL}`;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dawnping-launchd-'));
    calls = [];
    loadedFor = 0;
    results = {};
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the plist, creates the log directory and bootstraps the agent', async () => {
    await scheduler().install(spec(dir));
    expect(calls).toEqual([
      `launchctl print ${service}`,
      `launchctl bootstrap gui/501 ${plistPath()}`,
    ]);
    expect(await readFile(plistPath(), 'utf8')).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect((await stat(plistPath())).mode & 0o777).toBe(0o644);
    expect((await stat(join(dir, 'state'))).isDirectory()).toBe(true);
  });

  it('waits until a loaded agent is really gone before bootstrapping again', async () => {
    // Loaded at the first check, and still for two checks after bootout.
    loadedFor = 3;
    await scheduler().install(spec(dir));
    expect(calls).toEqual([
      `launchctl print ${service}`,
      `launchctl bootout ${service}`,
      `launchctl print ${service}`,
      `launchctl print ${service}`,
      `launchctl print ${service}`,
      `launchctl bootstrap gui/501 ${plistPath()}`,
    ]);
  });

  it('gives up when launchd does not remove the old agent', async () => {
    loadedFor = 1000;
    await expect(scheduler().install(spec(dir))).rejects.toThrow(
      'launchd did not remove the old agent in time; try again',
    );
  });

  it('stops when bootout fails', async () => {
    loadedFor = 1;
    results['bootout'] = { code: 1, stdout: '', stderr: 'Operation not permitted' };
    await expect(scheduler().install(spec(dir))).rejects.toThrow(
      'launchctl bootout failed (exit 1): Operation not permitted',
    );
    expect(calls).not.toContain(`launchctl bootstrap gui/501 ${plistPath()}`);
  });

  it('removes the plist when bootstrap fails, so it does not load at next login', async () => {
    results['bootstrap'] = {
      code: 5,
      stdout: '',
      stderr: 'Bootstrap failed: 5: Input/output error\n',
    };
    await expect(scheduler().install(spec(dir))).rejects.toThrow(
      'launchctl bootstrap failed (exit 5): Bootstrap failed: 5: Input/output error',
    );
    await expect(stat(plistPath())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('treats unexpected print failures as errors, not as "not loaded"', async () => {
    results['print'] = { code: 1, stdout: '', stderr: '' };
    await expect(scheduler().isInstalled()).rejects.toThrow('launchctl print failed (exit 1)');
  });

  it('uninstalls a loaded agent and removes the plist', async () => {
    await scheduler().install(spec(dir));
    loadedFor = 1;
    calls = [];
    expect(await scheduler().uninstall()).toBe(true);
    expect(calls).toEqual([
      `launchctl print ${service}`,
      `launchctl bootout ${service}`,
      `launchctl print ${service}`,
    ]);
    await expect(stat(plistPath())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the plist when the agent cannot be stopped', async () => {
    await scheduler().install(spec(dir));
    loadedFor = 1;
    results['bootout'] = { code: 1, stdout: '', stderr: 'nope' };
    await expect(scheduler().uninstall()).rejects.toThrow('launchctl bootout failed');
    expect((await stat(plistPath())).isFile()).toBe(true);
  });

  it('removes a leftover plist even when the agent is not loaded', async () => {
    await scheduler().install(spec(dir));
    expect(await scheduler().uninstall()).toBe(true);
    expect(await scheduler().uninstall()).toBe(false);
  });

  it('knows whether the agent is loaded', async () => {
    expect(await scheduler().isInstalled()).toBe(false);
    loadedFor = 1;
    expect(await scheduler().isInstalled()).toBe(true);
  });
});
