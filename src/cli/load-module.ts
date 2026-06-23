import { pathToFileURL } from 'node:url';
import { defineModule } from '../define-module.js';
import type { EvalModule } from '../types.js';

/** Import a `.eval.ts` file (tsx must be registered) and validate its default export. */
export async function loadModule(file: string): Promise<EvalModule> {
  const mod = await import(pathToFileURL(file).href);
  const def = mod.default ?? mod.module;
  if (!def) {
    throw new Error(`${file}: no default export — expected \`export default defineModule({...})\``);
  }
  // Re-validate (the file may not have wrapped it in defineModule).
  return defineModule(def as EvalModule);
}
