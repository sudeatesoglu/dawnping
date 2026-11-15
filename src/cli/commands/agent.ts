import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { agentEnvironment, TICK_INTERVAL_SECONDS } from '../../core/scheduler.ts';
import { loadOrFail } from '../config-file.ts';
import { type CliContext, CliError, type Invocation } from '../context.ts';

/**
 * Package runners (npx, pnpm dlx, yarn dlx, bunx) start packages from
 * caches or temporary directories that can be cleared at any time.
 */
export function isTemporaryInstall(script: string, tempDir: string): boolean {
  return /[\\/](_npx|dlx[^\\/]*|bunx[^\\/]*)[\\/]/.test(script) || script.startsWith(`${tempDir}/`);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerAgentCommands(program: Command, ctx: CliContext): void {
  program
    .command('install')
    .description('run dawnping in the background (a launchd agent on macOS)')
    .action(async () => {
      // The agent reads the same config; refuse to install on a broken one.
      await loadOrFail(ctx);

      let invocation: Invocation;
      try {
        invocation = ctx.invocation();
      } catch (error) {
        throw new CliError(`Could not find the dawnping program file: ${reason(error)}`);
      }
      const { node, nodeArgs, script } = invocation;
      if (isTemporaryInstall(script, tmpdir())) {
        throw new CliError(
          'dawnping is running from a temporary package cache, which can be deleted at any time.',
          'Install it first: npm install --global dawnping',
          'Then run: dawnping install',
        );
      }

      const logFile = join(ctx.paths.stateDir, 'tick.log');
      try {
        await ctx.scheduler.install({
          programArguments: [node, ...nodeArgs, script, 'tick'],
          intervalSeconds: TICK_INTERVAL_SECONDS,
          logFile,
          environment: agentEnvironment(ctx.env),
        });
      } catch (error) {
        throw new CliError(`Could not install the background agent: ${reason(error)}`);
      }

      ctx.stdout(
        `Installed. dawnping checks every ${TICK_INTERVAL_SECONDS / 60} minutes whether to ping.\n` +
          `  Agent: ${ctx.scheduler.location}\n` +
          `  Log:   ${logFile}\n` +
          'Undo with: dawnping uninstall\n',
      );
    });

  program
    .command('uninstall')
    .description('stop running dawnping in the background')
    .action(async () => {
      let removed: boolean;
      try {
        removed = await ctx.scheduler.uninstall();
      } catch (error) {
        throw new CliError(`Could not remove the background agent: ${reason(error)}`);
      }
      ctx.stdout(
        removed ? 'Uninstalled. dawnping no longer runs in the background.\n' : 'Not installed.\n',
      );
    });
}
