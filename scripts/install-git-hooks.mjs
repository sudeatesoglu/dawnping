/**
 * Installs Git hooks via Lefthook as part of `pnpm install`.
 *
 * Skipped when hooks are useless or impossible to install:
 * - in CI, which runs the same checks as workflow steps;
 * - outside a Git checkout (source tarball, container build), where
 *   `lefthook install` would exit with "not a git repository";
 * - when lefthook is not installed (e.g. `pnpm install --prod`).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const ci = process.env.CI;
const inCi = ci !== undefined && ci !== '' && ci !== 'false' && ci !== '0';

if (inCi || !existsSync('.git')) {
  process.exit(0);
}

try {
  execFileSync('lefthook', ['install'], {
    stdio: 'inherit',
    // Package binaries are .cmd shims on Windows and need a shell to run.
    shell: process.platform === 'win32',
  });
} catch (error) {
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    console.warn('lefthook is not installed; skipping git hooks.');
    process.exit(0);
  }
  throw error;
}
