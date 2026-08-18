/**
 * `--import` shim: installs SWC compilation on BOTH module systems (see swc-hooks.mts for why
 * SWC rather than tsx's esbuild).
 *
 * Two halves, because Node splits the job:
 *   - ESM  — `register()` puts the `load` hook on the dedicated hooks thread.
 *   - CJS  — a require-extension compiled in this thread. The ESM hook cannot serve CommonJS
 *            TypeScript: returning source for `format: 'commonjs'` goes through Node's
 *            ESM->CJS translator and breaks `require` inside any dependency it loads.
 *
 * A module passed to `--import` is only executed, so both halves must be installed explicitly.
 */
import { createRequire, register } from 'node:module';
import { readFileSync } from 'node:fs';
import { transformSync } from '@swc/core';

register(new URL('./swc-hooks.js', import.meta.url).href);

type Compiler = (module: NodeJS.Module, filename: string) => void;
type ModuleWithExtensions = typeof import('node:module') & {
  _extensions: Record<string, Compiler>;
};

const require = createRequire(import.meta.url);
const Module = require('node:module') as ModuleWithExtensions;

const compileCjs: Compiler = (module, filename) => {
  const { code } = transformSync(readFileSync(filename, 'utf8'), {
    filename,
    sourceMaps: 'inline',
    jsc: {
      parser: { syntax: 'typescript', tsx: filename.endsWith('x'), decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: 'es2022',
      keepClassNames: true,
    },
    module: { type: 'commonjs' },
  });
  // `_compile` is the documented seam every TS require-hook uses (ts-node, @swc-node/register).
  (module as NodeJS.Module & { _compile(code: string, filename: string): unknown })._compile(
    code,
    filename,
  );
};

for (const ext of ['.ts', '.tsx', '.cts']) Module._extensions[ext] = compileCjs;
