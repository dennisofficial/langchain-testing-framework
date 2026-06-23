import type { EvaluatorResult } from 'openevals';
import type { EvalScore } from '../types.js';

/** Normalize an openevals result (score may be boolean or number) into EvalScore[]. */
export function adaptOpenevalsResult(
  result: EvaluatorResult | EvaluatorResult[],
  defaults: { key: string; threshold?: number },
): EvalScore[] {
  const arr = Array.isArray(result) ? result : [result];
  return arr.map((r) => ({
    key: r.key ?? defaults.key,
    grade: toGrade(r.score),
    comment: r.comment,
    threshold: defaults.threshold,
  }));
}

/** Booleans → 0/1; numbers pass through (clamped at the aggregation step). */
export function toGrade(score: number | boolean): number {
  if (typeof score === 'boolean') return score ? 1 : 0;
  return Number(score);
}
