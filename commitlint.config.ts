import type { UserConfig } from '@commitlint/types';

/**
 * Commit message rules (Conventional Commits 1.0).
 *
 * This file is the single source of truth for allowed types and scopes;
 * docs and the commit template link here instead of copying the list.
 */
const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // Source areas
        'cli',
        'core',
        'config',
        'planner',
        'pinger',
        'scheduler',
        'notifier',
        'logs',
        'store',
        // Project
        'tooling',
        'test',
        'docs',
        'adr',
        'readme',
        'ci',
        'deps',
        'deps-dev', // Dependabot: development dependencies
        'release',
      ],
    ],
    'scope-empty': [2, 'never'],
    'header-max-length': [2, 'always', 72],
    // Every commit explains itself with a Why/What body.
    'body-empty': [2, 'never'],
  },
};

export default config;
