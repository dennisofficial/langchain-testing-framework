/**
 * Core types for the standalone eval runner.
 *
 * A test author writes a module file that `export default defineModule({...})`. The CLI
 * loads it, runs each dataset case through `runnable()`, grades the output with every
 * `evaluator`, averages the grades per metric key, and renders a table — dumping any case
 * whose grade falls below its metric threshold.
 */

/** One dataset row. `expected` is optional reference output (passed to evaluators). */
export interface EvalCase<In, Out = unknown> {
  input: In;
  expected?: Out;
  /** Human label for the table/dump and for case-targeted scorers. */
  label?: string;
}

/** A single graded metric for one case. `grade` is normalized to [0, 1]. */
export interface EvalScore {
  key: string;
  grade: number;
  /** Optional judge/scorer rationale, surfaced in below-threshold dumps. */
  comment?: string;
  /** Threshold this score should be measured against (helpers attach it). */
  threshold?: number;
}

/** What an evaluator receives for each case. */
export interface EvalContext<In, Out> {
  input: In;
  output: Out;
  expected?: Out;
  label?: string;
  index: number;
}

/** Return `[]` / `undefined` to skip a case (e.g. a scorer that targets one label). */
export type EvaluatorReturn = EvalScore | EvalScore[] | number | boolean | void | null | undefined;

export interface Evaluator<In = any, Out = any> {
  (ctx: EvalContext<In, Out>): EvaluatorReturn | Promise<EvaluatorReturn>;
  /** Set by llmJudge()/scorer() so the runner knows the metric before it runs. */
  evalMeta?: { key: string; threshold?: number; kind: 'llm-judge' | 'scorer' | 'fn' };
}

/** Minimal structural contract satisfied by any LangChain `Runnable`. */
export interface RunnableLike<In, Out> {
  invoke(input: In, config?: Record<string, unknown>): Promise<Out> | Out;
  withConfig?(config: Record<string, unknown>): RunnableLike<In, Out>;
}

export interface EvalModule<In = any, Out = any> {
  /** Display name for the report header. */
  name: string;
  dataset: () => EvalCase<In, Out>[] | Promise<EvalCase<In, Out>[]>;
  /** Build the chain/agent under test (any LangChain Runnable). */
  runnable: () => RunnableLike<In, Out> | Promise<RunnableLike<In, Out>>;
  evaluators: Evaluator<In, Out>[];
  /** Default threshold for metrics without their own; falls back to config default. */
  threshold?: number;
  /** Max concurrent cases; falls back to config default (3). */
  concurrency?: number;
}
