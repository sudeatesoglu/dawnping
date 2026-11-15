import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

/**
 * Opens a file in the user's editor ($VISUAL, then $EDITOR, then vi) and
 * resolves with the editor's exit code.
 *
 * The editor setting may include arguments ("code --wait"), so it runs
 * through the shell. The file name is passed as a separate argument ("$1"),
 * never pasted into the command string, so the shell cannot interpret it.
 */
export function openInEditor(
  file: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const editor = env['VISUAL'] || env['EDITOR'] || 'vi';
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', `${editor} "$1"`, 'sh', file], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/**
 * Asks a yes/no question on the terminal; Enter means yes. Closing the
 * input (Ctrl-D) or interrupting the question (Ctrl-C) means no.
 */
export async function confirm(
  question: string,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<boolean> {
  const rl = createInterface({ input, output });
  const closed = new Promise<undefined>((resolve) => rl.once('close', () => resolve(undefined)));
  try {
    const answer = await Promise.race([
      rl.question(`${question} [Y/n] `).catch(() => undefined),
      closed,
    ]);
    if (answer === undefined) return false;
    const normalized = answer.trim().toLowerCase();
    return normalized === '' || normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}
