#!/usr/bin/env node
// Entry point (composition root): wires adapters into the CLI and runs it.
// Keep logic out of this file; it is excluded from unit-test coverage.
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolvePaths } from './adapters/paths.ts';
import { createClaudePinger } from './adapters/pinger/claude-cli.ts';
import { runCommand } from './adapters/process.ts';
import { createLaunchdScheduler } from './adapters/scheduler/launchd.ts';
import { createUnsupportedScheduler } from './adapters/scheduler/unsupported.ts';
import { systemClock } from './adapters/system-clock.ts';
import { confirm, openInEditor } from './adapters/terminal.ts';
import { runCli } from './cli/program.ts';

const paths = resolvePaths(process.env, homedir());

process.exitCode = await runCli(process.argv.slice(2), {
  paths,
  clock: systemClock,
  systemTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  pinger: createClaudePinger({ directory: join(paths.stateDir, 'ping'), run: runCommand }),
  scheduler:
    process.platform === 'darwin'
      ? createLaunchdScheduler({
          launchAgentsDir: paths.launchAgentsDir,
          uid: process.getuid?.() ?? 0,
          run: runCommand,
        })
      : createUnsupportedScheduler(process.platform),
  invocation: () => ({
    node: process.execPath,
    nodeArgs: process.execArgv,
    // The real path, so the agent keeps working if a symlink (e.g. a global
    // npm bin link) changes.
    script: realpathSync(process.argv[1] ?? ''),
  }),
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  openEditor: (file) => openInEditor(file, process.env),
  confirm: (question) => confirm(question, process.stdin, process.stdout),
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
});
