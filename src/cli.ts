#!/usr/bin/env node
// Entry point (composition root): wires adapters into the CLI and runs it.
// Keep logic out of this file; it is excluded from unit-test coverage.
import { homedir } from 'node:os';
import { resolvePaths } from './adapters/paths.ts';
import { systemClock } from './adapters/system-clock.ts';
import { confirm, openInEditor } from './adapters/terminal.ts';
import { runCli } from './cli/program.ts';

process.exitCode = await runCli(process.argv.slice(2), {
  paths: resolvePaths(process.env, homedir()),
  clock: systemClock,
  systemTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  openEditor: (file) => openInEditor(file, process.env),
  confirm: (question) => confirm(question, process.stdin, process.stdout),
  interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
});
