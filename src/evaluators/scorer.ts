import type { EvalContext, EvalScore, Evaluator } from '../types.js';

export interface ScorerOptions<In, Out> {
  /** Metric name shown in the table. */
  key: string;
  /** Average score the metric must meet; below this, cases are dumped. */
  threshold?: number;
  /**
   * Grade a case. Return a number (0..1) or boolean (→ 0/1). Return `[]`/`undefined` to
   * SKIP this case — useful for an invariant that only applies to one labelled case.
   * May also return a full EvalScore (e.g. to attach a `comment`) or an array of them.
   */
  run: (
    ctx: EvalContext<In, Out>,
  ) =>
    | number
    | boolean
    | EvalScore
    | EvalScore[]
    | void
    | null
    | undefined
    | Promise<number | boolean | EvalScore | EvalScore[] | void | null | undefined>;
}

/** Deterministic, programmatic evaluator. */
export function scorer<In = any, Out = any>(opts: ScorerOptions<In, Out>): Evaluator<In, Out> {
  const { key, threshold, run } = opts;

  const evaluator: Evaluator<In, Out> = async (ctx) => {
    const r = await run(ctx);
    if (r === undefined || r === null) return [];
    if (Array.isArray(r)) return r.map((s) => ({ threshold, ...s }));
    if (typeof r === 'object') return { threshold, ...r };
    const grade = typeof r === 'boolean' ? (r ? 1 : 0) : r;
    return { key, grade, threshold };
  };
  evaluator.evalMeta = { key, threshold, kind: 'scorer' };
  return evaluator;
}
