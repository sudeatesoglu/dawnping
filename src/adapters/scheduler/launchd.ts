import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentSpec, Scheduler } from '../../core/scheduler.ts';
import { errorCode } from '../errors.ts';
import { writeFileAtomic } from '../file-store.ts';
import type { CommandResult, CommandRunner } from '../process.ts';

export const LAUNCHD_LABEL = 'io.github.sudeatesoglu.dawnping';

/** Escapes text for an XML element: paths may contain & or <. */
function xml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** Keeps the Mac awake while the command it runs is running. */
const CAFFEINATE = ['/usr/bin/caffeinate', '-i'];

/**
 * The minutes past each hour at which the agent runs. The interval must
 * divide an hour, so the runs fall on the same wall-clock times every hour.
 */
export function calendarMinutes(intervalSeconds: number): number[] {
  const step = intervalSeconds / 60;
  if (!Number.isInteger(step) || step < 1 || 60 % step !== 0) {
    throw new Error(`the interval must divide an hour into whole minutes, not ${intervalSeconds}s`);
  }
  return Array.from({ length: 60 / step }, (_, index) => index * step);
}

/**
 * The LaunchAgent property list for a spec. Pure, so it is unit-tested.
 *
 * The agent runs on the wall clock (StartCalendarInterval), not every N
 * seconds (StartInterval): launchd counts StartInterval only while the
 * Mac is awake, so after a night of short wakes the runs land at random
 * times. A calendar run missed during sleep runs as soon as the Mac wakes,
 * so a scheduled wake just after the ping time starts the ping
 * (ADR-0006). caffeinate keeps the Mac awake until the run finishes.
 */
export function buildPlist(label: string, spec: AgentSpec): string {
  const calendar = calendarMinutes(spec.intervalSeconds)
    .map(
      (minute) =>
        `    <dict>\n      <key>Minute</key>\n      <integer>${minute}</integer>\n    </dict>`,
    )
    .join('\n');
  const strings = (values: readonly string[], indent: string) =>
    values.map((value) => `${indent}<string>${xml(value)}</string>`).join('\n');
  const environment = Object.entries(spec.environment)
    .map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(label)}</string>
  <key>ProgramArguments</key>
  <array>
${strings([...CAFFEINATE, ...spec.programArguments], '    ')}
  </array>
  <key>StartCalendarInterval</key>
  <array>
${calendar}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(spec.logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(spec.logFile)}</string>
  <key>EnvironmentVariables</key>
  <dict>
${environment}
  </dict>
</dict>
</plist>
`;
}

export interface LaunchdOptions {
  launchAgentsDir: string;
  uid: number;
  run: CommandRunner;
  label?: string;
  /** Waits between checks while launchd tears a job down; instant in tests. */
  sleep?: (ms: number) => Promise<void>;
}

/** `launchctl print` exit code for "no such service". */
const SERVICE_NOT_FOUND = 113;

/** How long to wait for launchd to finish removing a job. */
const BOOTOUT_POLLS = 25;
const BOOTOUT_POLL_MS = 200;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function failure(step: string, result: CommandResult): Error {
  const detail = result.stderr.trim() || result.stdout.trim();
  return new Error(`launchctl ${step} failed (exit ${result.code})${detail ? `: ${detail}` : ''}`);
}

/**
 * A Scheduler backed by a per-user LaunchAgent.
 *
 * launchd runs the agent at fixed minutes of every hour, and once right
 * after waking if one of them was missed during sleep.
 */
export function createLaunchdScheduler(options: LaunchdOptions): Scheduler {
  const label = options.label ?? LAUNCHD_LABEL;
  const plistPath = join(options.launchAgentsDir, `${label}.plist`);
  const domain = `gui/${options.uid}`;
  const service = `${domain}/${label}`;
  const sleep = options.sleep ?? defaultSleep;
  const launchctl = (...args: string[]) => options.run('launchctl', args);

  /** Loaded or not; any other answer from launchd is an error, not a "no". */
  const isInstalled = async () => {
    const result = await launchctl('print', service);
    if (result.code === 0) return true;
    if (result.code === SERVICE_NOT_FOUND) return false;
    throw failure('print', result);
  };

  /**
   * Stops the job and waits until launchd has really removed it: bootout
   * can return while the job is still being torn down, and a bootstrap
   * right after it would fail.
   */
  const bootout = async () => {
    const result = await launchctl('bootout', service);
    if (result.code !== 0 && result.code !== SERVICE_NOT_FOUND) throw failure('bootout', result);
    for (let i = 0; i < BOOTOUT_POLLS; i++) {
      if (!(await isInstalled())) return;
      await sleep(BOOTOUT_POLL_MS);
    }
    throw new Error('launchd did not remove the old agent in time; try again');
  };

  return {
    location: plistPath,
    isInstalled,

    async install(spec) {
      // launchd does not create the log directory.
      await mkdir(dirname(spec.logFile), { recursive: true, mode: 0o700 });
      if (await isInstalled()) await bootout();
      // Created here with the usual mode; writeFileAtomic would make a
      // missing directory private (0700).
      await mkdir(options.launchAgentsDir, { recursive: true });
      await writeFileAtomic(plistPath, buildPlist(label, spec), { mode: 0o644 });
      const result = await launchctl('bootstrap', domain, plistPath);
      if (result.code !== 0) {
        // Otherwise launchd would load the agent at the next login, although
        // the user was told the installation failed.
        await rm(plistPath, { force: true });
        throw failure('bootstrap', result);
      }
    },

    async uninstall() {
      const loaded = await isInstalled();
      // Stop first: if that fails, the plist stays so the user can retry.
      if (loaded) await bootout();
      try {
        await rm(plistPath);
        return true;
      } catch (error) {
        if (errorCode(error) === 'ENOENT') return loaded;
        throw error;
      }
    },
  };
}
