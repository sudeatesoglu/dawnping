import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readTextFile } from './file-store.ts';

export interface Draft {
  /** Where the draft lives, to open in an editor or show to the user. */
  path: string;
  read(): Promise<string>;
  /** Deletes the draft and its private directory. */
  remove(): Promise<void>;
}

/**
 * A private temporary copy to edit (directory 0700, file 0600), so other
 * local users can neither read nor swap it while the editor is open.
 */
export async function createDraft(name: string, content: string): Promise<Draft> {
  const dir = await mkdtemp(join(tmpdir(), 'dawnping-edit-'));
  const path = join(dir, name);
  await writeFile(path, content, { mode: 0o600 });
  return {
    path,
    read: async () => (await readTextFile(path)) ?? '',
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}
