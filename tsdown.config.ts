import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  platform: 'node',
  // Lowest Node version in package.json "engines".
  target: 'node22.12',
  outDir: 'dist',
  // package.json has "type": "module", so plain .js is ESM; matches "bin".
  fixedExtension: false,
  clean: true,
  // A CLI, not a library: no type declarations to publish.
  dts: false,
});
