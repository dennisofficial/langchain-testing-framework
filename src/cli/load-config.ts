import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AIConfig } from '../config.js';

const CONFIG_NAMES = [
  'ai-testing.config.ts',
  'ai-testing.config.mts',
  'ai-testing.config.js',
  'ai-testing.config.mjs',
];

export interface LoadedConfig {
  config: AIConfig;
  /** Directory the config was found in (the discovery + path-resolution root). */
  root: string;
  configPath?: string;
}

/** Walk up from `cwd` looking for an ai-testing.config.* file. */
export function findConfigPath(cwd: string): string | undefined {
  let dir = resolve(cwd);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Load the config (the tsx loader must already be registered, since it may be TypeScript).
 * Returns an empty config rooted at `cwd` when none is found.
 */
export async function loadConfig(cwd: string): Promise<LoadedConfig> {
  const configPath = findConfigPath(cwd);
  if (!configPath) return { config: {}, root: resolve(cwd) };

  const mod = await import(pathToFileURL(configPath).href);
  const config = (mod.default ?? mod.config ?? {}) as AIConfig;
  return { config, root: dirname(configPath), configPath };
}

/** Resolve the tsconfig the loader should use for alias/path resolution. */
export function resolveTsconfig(root: string, override?: string): string | undefined {
  if (override) return isAbsolute(override) ? override : resolve(root, override);
  const evalConfig = join(root, 'tsconfig.eval.json');
  if (existsSync(evalConfig)) return evalConfig;
  const baseConfig = join(root, 'tsconfig.json');
  if (existsSync(baseConfig)) return baseConfig;
  return undefined;
}
