import { loadConfig, saveConfig } from '../adapters/config-store.ts';
import { parseConfig } from '../core/config/parse.ts';
import type { Config, ConfigInput } from '../core/config/schema.ts';
import { type CliContext, CliError } from './context.ts';

/** Loads the config or fails with the problems and how to fix them. */
export async function loadOrFail(ctx: CliContext): Promise<{ config: Config; input: ConfigInput }> {
  const result = await loadConfig(ctx.paths.configFile);
  if (!result.ok) {
    throw new CliError(
      `The config file is invalid: ${ctx.paths.configFile}`,
      ...result.errors.map((line) => `  ${line}`),
      'Fix it with: dawnping config edit',
    );
  }
  return result;
}

/**
 * Validates a changed config and saves it. Nothing is written if the
 * change makes the config invalid.
 */
export async function validateAndSave(ctx: CliContext, input: unknown): Promise<void> {
  const result = parseConfig(input);
  if (!result.ok) {
    throw new CliError(
      'Not saved, the change would make the config invalid:',
      ...result.errors.map((line) => `  ${line}`),
    );
  }
  await saveConfig(ctx.paths.configFile, result.input);
}
