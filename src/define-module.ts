import type { EvalModule } from './types.js';

/**
 * Identity helper that validates an eval module's shape and gives the author full type
 * inference. The CLI imports a module file's default export and expects this shape.
 */
export function defineModule<In, Out>(mod: EvalModule<In, Out>): EvalModule<In, Out> {
  if (!mod || typeof mod !== 'object') throw new Error('defineModule: expected a module object');
  if (!mod.name) throw new Error('defineModule: `name` is required');
  if (typeof mod.dataset !== 'function') {
    throw new Error(`defineModule(${mod.name}): \`dataset\` must be a function`);
  }
  if (typeof mod.runnable !== 'function') {
    throw new Error(`defineModule(${mod.name}): \`runnable\` must be a function`);
  }
  // An empty array is legal: a run-only module has no golden answer to grade against and
  // exists to prove the chain still executes. It reports no metrics, so `run-module` fails it
  // only when a case throws. Requiring an evaluator here would force authors to invent a
  // constant one, which reports green while asserting nothing.
  if (!Array.isArray(mod.evaluators)) {
    throw new Error(`defineModule(${mod.name}): \`evaluators\` must be an array`);
  }
  return mod;
}
