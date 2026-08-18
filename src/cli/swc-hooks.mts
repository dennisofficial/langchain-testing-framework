/**
 * ESM `load` hook that compiles TypeScript with SWC instead of letting tsx's esbuild do it.
 *
 * WHY THIS EXISTS: esbuild — and therefore tsx — implements the ES decorators proposal and
 * never emits `design:type` metadata, whatever tsconfig says. Any codebase whose decorators
 * read that metadata (Mongoose `@Prop`, NestJS DI, class-validator, and our own `@AiString` /
 * `@AiToolCall`) throws `TypeError` at `Reflect.getMetadata` as soon as a module loads. SWC
 * implements the legacy decorator transform and does emit it.
 *
 * Registered after tsx so it runs first in the `load` chain and claims TypeScript sources
 * before tsx sees them. tsx stays registered and still owns `resolve`, which is where
 * tsconfig `paths`, extensionless specifiers and CJS interop live — replacing that too would
 * be a far larger change for no gain.
 */
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from '@swc/core';

type LoadContext = { format?: string | null; conditions: string[] };
type LoadResult = { format: string; source?: string | Uint8Array; shortCircuit?: boolean };
type NextLoad = (url: string, context: LoadContext) => Promise<LoadResult>;

const TS_FILE = /\.(m|c)?tsx?$/;
const packageTypeCache = new Map<string, boolean>();

/**
 * Resolved the way Node resolves it: `.mts`/`.cts` are explicit, everything else inherits the
 * nearest package.json `type`. Asking `nextLoad` for the format instead would hand the file to
 * tsx's transform — the very thing being avoided — and returning the wrong answer breaks
 * `require` of CJS dependencies from a transformed file.
 */
function isEsmFile(filename: string): boolean {
  if (filename.endsWith('.mts')) return true;
  if (filename.endsWith('.cts')) return false;

  let dir = dirname(filename);
  const seen: string[] = [];
  for (;;) {
    const cached = packageTypeCache.get(dir);
    if (cached !== undefined) {
      for (const d of seen) packageTypeCache.set(d, cached);
      return cached;
    }
    seen.push(dir);

    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      let esm = false;
      try {
        esm = JSON.parse(readFileSync(pkg, 'utf8')).type === 'module';
      } catch {
        esm = false;
      }
      for (const d of seen) packageTypeCache.set(d, esm);
      return esm;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      for (const d of seen) packageTypeCache.set(d, false);
      return false;
    }
    dir = parent;
  }
}

export async function load(
  url: string,
  context: LoadContext,
  nextLoad: NextLoad,
): Promise<LoadResult> {
  if (!url.startsWith('file://')) return nextLoad(url, context);

  const filename = fileURLToPath(url);
  if (!TS_FILE.test(filename)) return nextLoad(url, context);

  const esm = isEsmFile(filename);

  // CommonJS TypeScript is deliberately NOT transformed here. Returning source for
  // `format: 'commonjs'` routes the file through Node's ESM->CJS translator, whose `require`
  // is not fully wired, and any dependency it pulls in dies with "Cannot read properties of
  // undefined (reading 'exports')". Handing it back format-only lets Node's real CJS loader
  // take it, where the require-extension hook installed by swc-loader.mts compiles it.
  if (!esm) return { format: 'commonjs', shortCircuit: true };

  const source = await readFile(filename, 'utf8');

  const { code } = await transform(source, {
    filename,
    sourceMaps: 'inline',
    jsc: {
      parser: { syntax: 'typescript', tsx: filename.endsWith('x'), decorators: true },
      // The two flags this entire file exists for.
      transform: { legacyDecorator: true, decoratorMetadata: true },
      target: 'es2022',
      keepClassNames: true,
    },
    module: { type: 'es6' },
  });

  return { format: 'module', source: code, shortCircuit: true };
}
