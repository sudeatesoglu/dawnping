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

/** Asks a yes/no question on the terminal; Enter means yes. */
export async function confirm(
  question: string,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<boolean> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} [Y/n] `)).trim().toLowerCase();
    return answer === '' || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}
