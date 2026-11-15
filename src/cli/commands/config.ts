import type { Command } from 'commander';
import { createDraft } from '../../adapters/draft.ts';
import { readTextFile, writeFileAtomic } from '../../adapters/file-store.ts';
import {
  coerceValue,
  displayValue,
  flatten,
  getAt,
  parseKeyPath,
  setAt,
  unsetAt,
} from '../../core/config/keypath.ts';
import { settingKind } from '../../core/config/kinds.ts';
import { parseConfig, parseConfigText, serializeConfig } from '../../core/config/parse.ts';
import { defaultConfigInput } from '../../core/config/schema.ts';
import { loadOrFail, validateAndSave } from '../config-file.ts';
import { type CliContext, CliError } from '../context.ts';

function keyPathOrFail(key: string): string[] {
  const path = parseKeyPath(key);
  if (path === undefined) throw new CliError(`Invalid key: ${JSON.stringify(key)}`);
  return path;
}

export function registerConfigCommands(program: Command, ctx: CliContext): void {
  const config = program
    .command('config')
    .description('read and change settings')
    .addHelpText(
      'after',
      '\nKeys use dots, e.g. profiles.default.work. Lists are comma-separated.\n' +
        'Examples:\n' +
        '  dawnping config set profiles.default.work 10:00-18:00\n' +
        '  dawnping config set timezone Europe/Istanbul\n' +
        '  dawnping config get profiles.default.days',
    );

  config
    .command('path')
    .description('print the location of the config file')
    .action(() => {
      ctx.stdout(`${ctx.paths.configFile}\n`);
    });

  config
    .command('list')
    .description('print every setting; values not in the file are marked (default)')
    .action(async () => {
      const { config: effective, input } = await loadOrFail(ctx);
      for (const [path, value] of flatten(effective)) {
        const inFile = getAt(input, path) !== undefined;
        ctx.stdout(`${path.join('.')} = ${displayValue(value)}${inFile ? '' : '  (default)'}\n`);
      }
    });

  config
    .command('get <key>')
    .description('print one setting')
    .action(async (key: string) => {
      const path = keyPathOrFail(key);
      const { config: effective } = await loadOrFail(ctx);
      const value = getAt(effective, path);
      if (value === undefined) throw new CliError(`Not set: ${key}`);
      ctx.stdout(`${displayValue(value)}\n`);
    });

  config
    .command('set <key> <value>')
    .description('change one setting (validated before saving)')
    .action(async (key: string, raw: string) => {
      const path = keyPathOrFail(key);
      const { input } = await loadOrFail(ctx);
      const value = coerceValue(raw, settingKind(path));
      await validateAndSave(ctx, setAt(input, path, value));
      ctx.stdout(`${key} = ${displayValue(value)}\n`);
    });

  config
    .command('unset <key>')
    .description('remove a setting from the file, so its default applies again')
    .action(async (key: string) => {
      const path = keyPathOrFail(key);
      const { input } = await loadOrFail(ctx);
      const updated = unsetAt(input, path);
      if (updated === undefined) throw new CliError(`Not set in the config file: ${key}`);
      // Prefer removing objects left empty (unset ping.model removes ping,
      // so its default applies), unless that removes something required
      // (unsetting the last profile must keep "profiles": {}).
      const pruned = unsetAt(input, path, { pruneEmpty: true });
      await validateAndSave(ctx, pruned !== undefined && parseConfig(pruned).ok ? pruned : updated);
      ctx.stdout(`Removed ${key}\n`);
    });

  config
    .command('edit')
    .description('open the config file in $VISUAL or $EDITOR (validated before saving)')
    .action(async () => {
      await editConfig(ctx);
    });
}

/**
 * Edits a copy of the config, like `crontab -e` or `visudo`: the real file
 * is replaced only once the copy is valid, so a typo never breaks the
 * scheduled job. Works even when the current file is invalid.
 *
 * The draft is deleted only when nothing in it would be lost: after saving,
 * or when it was not changed. Otherwise its location is printed.
 */
async function editConfig(ctx: CliContext): Promise<void> {
  const file = ctx.paths.configFile;
  const original = (await readTextFile(file)) ?? serializeConfig(defaultConfigInput());
  const draft = await createDraft('config.json', original);

  try {
    for (;;) {
      const exitCode = await ctx.openEditor(draft.path);
      if (exitCode !== 0) {
        throw new CliError(`The editor exited with code ${exitCode}; nothing was saved.`);
      }
      const edited = await draft.read();
      if (edited === original) {
        await draft.remove();
        ctx.stdout('No changes.\n');
        return;
      }

      const result = parseConfigText(edited);
      if (result.ok) {
        // Keep the user's own formatting: write the text, not a re-serialization.
        await writeFileAtomic(file, edited);
        await draft.remove();
        ctx.stdout(`Saved ${file}\n`);
        return;
      }

      ctx.stderr(`The edited config is invalid:\n${result.errors.map((l) => `  ${l}\n`).join('')}`);
      if (!ctx.interactive || !(await ctx.confirm('Edit again?'))) {
        throw new CliError('Not saved.');
      }
    }
  } catch (error) {
    if ((await draft.read()) === original) {
      await draft.remove();
      throw error;
    }
    const kept = `Your edits are kept in ${draft.path}`;
    if (error instanceof CliError) throw new CliError(...error.lines, kept);
    ctx.stderr(`${kept}\n`);
    throw error;
  }
}
