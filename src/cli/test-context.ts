import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Notifier } from '../core/notifier.ts';
import { PING_PROMPT, type Pinger, type PingResult } from '../core/pinger.ts';
import type { AgentSpec, Scheduler } from '../core/scheduler.ts';
import type { LogEntry, SessionLogs } from '../core/session-logs.ts';
import type { CliContext } from './context.ts';
import { runCli } from './program.ts';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** A scheduler that only remembers what it was asked to do. */
export function createFakeScheduler(): Scheduler & { installed: AgentSpec | undefined } {
  return {
    installed: undefined,
    location: '/fake/LaunchAgents/dawnping.plist',
    async install(spec) {
      this.installed = spec;
    },
    async uninstall() {
      const was = this.installed !== undefined;
      this.installed = undefined;
      return was;
    },
    async isInstalled() {
      return this.installed !== undefined;
    },
  };
}

export const FAKE_PING_FOLDER = '-state-dawnping-ping';

/** A pinger that records the models it was asked to ping. */
export function createFakePinger(
  result: PingResult = { ok: true, durationMs: 2100, logFolder: FAKE_PING_FOLDER },
): Pinger & { pinged: string[] } {
  return {
    pinged: [],
    describe: (model) => ({
      command: ['claude', '-p', '--model', model, PING_PROMPT],
      directory: '/state/ping',
    }),
    async ping(model) {
      this.pinged.push(model);
      return result;
    },
  };
}

/**
 * Session logs for tests. By default every ping is logged: the entries
 * contain one answer in the fake ping folder at the given time.
 */
export function createFakeSessionLogs(
  entries: (since: number) => LogEntry[] = (since) => [
    { timestamp: since + 60_000, model: 'claude-haiku-5-5', folder: FAKE_PING_FOLDER },
  ],
  available = true,
): SessionLogs {
  return {
    entriesSince: async (since, folder) =>
      entries(since).filter((entry) => folder === undefined || entry.folder === folder),
    available: async () => available,
  };
}

/** A notifier that records what it was asked to show. */
export function createFakeNotifier(shows = true): Notifier & { shown: string[] } {
  return {
    shown: [],
    async notify(title, message) {
      this.shown.push(`${title}: ${message}`);
      return shows;
    },
  };
}

/**
 * A CLI context for tests: a temporary config directory, captured output
 * and replaceable terminal interactions. Never touches the real home.
 */
export async function createTestContext(overrides: Partial<CliContext> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'dawnping-cli-'));
  let stdout = '';
  let stderr = '';
  const ctx: CliContext = {
    paths: {
      configFile: join(dir, 'config', 'config.json'),
      stateDir: join(dir, 'state'),
      launchAgentsDir: join(dir, 'LaunchAgents'),
      claudeProjectsDir: join(dir, 'claude', 'projects'),
    },
    // Sunday 2026-11-15, 09:00 in Istanbul.
    clock: { now: () => Date.parse('2026-11-15T06:00:00Z') },
    systemTimeZone: 'Europe/Istanbul',
    pinger: createFakePinger(),
    sessionLogs: createFakeSessionLogs(),
    notifier: createFakeNotifier(),
    sleep: async () => {},
    scheduler: createFakeScheduler(),
    invocation: () => ({
      node: '/usr/local/bin/node',
      nodeArgs: [],
      script: '/usr/local/lib/dawnping/dist/cli.js',
    }),
    env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin' },
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    openEditor: async () => 0,
    confirm: async () => false,
    interactive: false,
    ...overrides,
  };

  return {
    ctx,
    dir,
    /** Runs one command and returns its exit code and output. */
    async run(...args: string[]): Promise<RunResult> {
      stdout = '';
      stderr = '';
      const code = await runCli(args, ctx);
      return { code, stdout, stderr };
    },
    async cleanup(): Promise<void> {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
