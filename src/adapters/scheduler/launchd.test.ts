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
  let loaded: boolean;
  let bootstrapResult: CommandResult;

  const scheduler = () =>
    createLaunchdScheduler({
      launchAgentsDir: join(dir, 'LaunchAgents'),
      uid: 501,
      run: async (program, args) => {
        calls.push([program, ...args].join(' '));
        if (args[0] === 'print') return { code: loaded ? 0 : 113, stdout: '', stderr: '' };
        if (args[0] === 'bootstrap') return bootstrapResult;
        if (args[0] === 'bootout') loaded = false;
        return { code: 0, stdout: '', stderr: '' };
      },
    });

  const plistPath = () => join(dir, 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dawnping-launchd-'));
    calls = [];
    loaded = false;
    bootstrapResult = { code: 0, stdout: '', stderr: '' };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the plist, creates the log directory and bootstraps the agent', async () => {
    await scheduler().install(spec(dir));
    expect(calls).toEqual([
      `launchctl print gui/501/${LAUNCHD_LABEL}`,
      `launchctl bootstrap gui/501 ${plistPath()}`,
    ]);
    expect(await readFile(plistPath(), 'utf8')).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect((await stat(plistPath())).mode & 0o777).toBe(0o644);
    expect((await stat(join(dir, 'state'))).isDirectory()).toBe(true);
  });

  it('replaces a loaded agent instead of failing', async () => {
    loaded = true;
    await scheduler().install(spec(dir));
    expect(calls).toEqual([
      `launchctl print gui/501/${LAUNCHD_LABEL}`,
      `launchctl bootout gui/501/${LAUNCHD_LABEL}`,
      `launchctl bootstrap gui/501 ${plistPath()}`,
    ]);
  });

  it('reports a failed bootstrap', async () => {
    bootstrapResult = { code: 5, stdout: '', stderr: 'Bootstrap failed: 5: Input/output error\n' };
    await expect(scheduler().install(spec(dir))).rejects.toThrow(
      'launchctl bootstrap failed (exit 5): Bootstrap failed: 5: Input/output error',
    );
  });

  it('uninstalls a loaded agent and removes the plist', async () => {
    await scheduler().install(spec(dir));
    loaded = true;
    calls = [];
    expect(await scheduler().uninstall()).toBe(true);
    expect(calls).toEqual([
      `launchctl print gui/501/${LAUNCHD_LABEL}`,
      `launchctl bootout gui/501/${LAUNCHD_LABEL}`,
    ]);
    await expect(stat(plistPath())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes a leftover plist even when the agent is not loaded', async () => {
    await scheduler().install(spec(dir));
    expect(await scheduler().uninstall()).toBe(true);
    expect(await scheduler().uninstall()).toBe(false);
  });

  it('knows whether the agent is loaded', async () => {
    expect(await scheduler().isInstalled()).toBe(false);
    loaded = true;
    expect(await scheduler().isInstalled()).toBe(true);
  });
});
