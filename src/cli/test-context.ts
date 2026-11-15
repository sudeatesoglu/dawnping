import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliContext } from './context.ts';
import { runCli } from './program.ts';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
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
    paths: { configFile: join(dir, 'config', 'config.json'), stateDir: join(dir, 'state') },
    // Sunday 2026-11-15, 09:00 in Istanbul.
    clock: { now: () => Date.parse('2026-11-15T06:00:00Z') },
    systemTimeZone: 'Europe/Istanbul',
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
