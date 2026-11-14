// Applies the branch rulesets in .github/rulesets/ to the GitHub repository.
// Creates a ruleset if none with that name exists, otherwise updates it, so
// running it again is safe. Requires the GitHub CLI with admin access.
//
// Rulesets on the repository that have no file here are reported, not
// deleted: they may have been added on purpose in the GitHub UI. Renaming a
// ruleset therefore leaves the old one behind until it is removed by hand.
//
// Usage: node scripts/apply-rulesets.mjs
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(import.meta.dirname, '../.github/rulesets');

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const repo = gh('repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner').trim();
// Only this repository's own rulesets (not ones inherited from an
// organization), across all pages. --slurp wraps the pages in one array.
const existing = JSON.parse(
  gh('api', '--paginate', '--slurp', `repos/${repo}/rulesets?includes_parents=false`),
).flat();

const managed = new Set();
for (const file of readdirSync(DIR).filter((name) => name.endsWith('.json'))) {
  const path = join(DIR, file);
  const { name } = JSON.parse(readFileSync(path, 'utf8'));
  managed.add(name);
  const match = existing.find((ruleset) => ruleset.name === name);
  if (match) {
    gh('api', '-X', 'PUT', `repos/${repo}/rulesets/${match.id}`, '--input', path);
    process.stdout.write(`updated ${name}\n`);
  } else {
    gh('api', '-X', 'POST', `repos/${repo}/rulesets`, '--input', path);
    process.stdout.write(`created ${name}\n`);
  }
}

for (const ruleset of existing.filter((r) => !managed.has(r.name))) {
  process.stdout.write(`not managed here (left unchanged): ${ruleset.name} (id ${ruleset.id})\n`);
}
