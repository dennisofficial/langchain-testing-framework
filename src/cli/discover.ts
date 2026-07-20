import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { glob } from 'glob';

export interface DiscoverOptions {
  root: string;
  /** Positional args: fuzzy name substrings or explicit file paths. */
  selectors: string[];
  all: boolean;
  patterns?: string[];
}

const DEFAULT_PATTERNS = ['**/*.eval.ts'];

export async function listAll(root: string, patterns?: string[]): Promise<string[]> {
  const files = await glob(patterns ?? DEFAULT_PATTERNS, {
    cwd: root,
    absolute: true,
    ignore: ['**/node_modules/**', '**/dist/**'],
  });
  return files.sort();
}

/**
 * Resolve which `.eval.ts` files to run. `--all` runs everything; otherwise selectors are
 * either explicit file paths or fuzzy substrings matched against discovered paths. Empty
 * selectors + no `--all` returns [] (the CLI then lists what's available).
 */
export async function discover(opts: DiscoverOptions): Promise<string[]> {
  const { root, selectors, all } = opts;
  const allFiles = await listAll(root, opts.patterns);

  if (all) return allFiles;
  if (selectors.length === 0) return [];

  const result = new Set<string>();
  for (const sel of selectors) {
    const asPath = isAbsolute(sel) ? sel : resolve(root, sel);
    if (existsSync(asPath) && asPath.endsWith('.ts')) {
      result.add(asPath);
      continue;
    }
    for (const f of allFiles) if (f.includes(sel)) result.add(f);
  }
  return [...result].sort();
}
