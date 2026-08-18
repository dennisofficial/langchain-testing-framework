import { readFileSync } from 'fs';
import { join } from 'path';
import { defineConfig } from 'tsup';

// Read package.json to auto-detect externals
const packageJson = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'));

const external = [
  ...Object.keys(packageJson.peerDependencies || {}),
  ...Object.keys(packageJson.dependencies || {}),
  ...Object.keys(packageJson.devDependencies || {}).filter(
    (dep) => !dep.startsWith('@types/') && !['typescript', 'tsup'].includes(dep),
  ),
];

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    config: 'src/config.ts',
    'cli/bin': 'src/cli/bin.ts',
    // Registered via `--import` as a Node loader hook, so it must be a real emitted file
    // rather than bundled into bin.
    'cli/swc-loader': 'src/cli/swc-loader.mts',
    'cli/swc-hooks': 'src/cli/swc-hooks.mts',
  },
  format: ['esm', 'cjs'],
  target: 'node20',
  platform: 'node',
  dts: { compilerOptions: { incremental: false, ignoreDeprecations: '6.0' } },
  splitting: false,
  sourcemap: true,
  clean: true,
  external,
  // The bin must be directly executable.
  banner: ({ format }) => (format === 'esm' ? { js: '#!/usr/bin/env node' } : {}),
  // Ink components use the classic JSX transform (React.createElement) — robust across
  // esbuild/tsx; each .tsx imports React.
});
