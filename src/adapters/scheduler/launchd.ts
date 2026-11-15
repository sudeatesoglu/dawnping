import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AgentSpec, Scheduler } from '../../core/scheduler.ts';
import { readTextFile, writeFileAtomic } from '../file-store.ts';
import type { CommandRunner } from '../process.ts';

export const LAUNCHD_LABEL = 'io.github.sudeatesoglu.dawnping';

/** Escapes text for an XML element: paths may contain & or <. */
function xml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/** The LaunchAgent property list for a spec. Pure, so it is unit-tested. */
export function buildPlist(label: string, spec: AgentSpec): string {
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
${strings(spec.programArguments, '    ')}
  </array>
  <key>StartInterval</key>
  <integer>${Math.round(spec.intervalSeconds)}</integer>
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
}

/**
 * A Scheduler backed by a per-user LaunchAgent.
 *
 * launchd runs the agent every StartInterval seconds while the Mac is
 * awake, and once after waking if an interval was missed during sleep.
 */
export function createLaunchdScheduler(options: LaunchdOptions): Scheduler {
  const label = options.label ?? LAUNCHD_LABEL;
  const plistPath = join(options.launchAgentsDir, `${label}.plist`);
  const domain = `gui/${options.uid}`;
  const launchctl = (...args: string[]) => options.run('launchctl', args);

  const isInstalled = async () => (await launchctl('print', `${domain}/${label}`)).code === 0;

  return {
    location: plistPath,
    isInstalled,

    async install(spec) {
      // launchd does not create the log directory.
      await mkdir(dirname(spec.logFile), { recursive: true, mode: 0o700 });
      if (await isInstalled()) await launchctl('bootout', `${domain}/${label}`);
      await mkdir(options.launchAgentsDir, { recursive: true });
      await writeFileAtomic(plistPath, buildPlist(label, spec), { mode: 0o644 });
      const result = await launchctl('bootstrap', domain, plistPath);
      if (result.code !== 0) {
        throw new Error(
          `launchctl bootstrap failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`,
        );
      }
    },

    async uninstall() {
      const loaded = await isInstalled();
      if (loaded) await launchctl('bootout', `${domain}/${label}`);
      const existed = (await readTextFile(plistPath)) !== undefined;
      await rm(plistPath, { force: true });
      return loaded || existed;
    },
  };
}
