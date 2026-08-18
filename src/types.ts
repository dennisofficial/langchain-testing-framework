import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
/**
 * Core types for the standalone eval runner.
 *
 * A test author writes a module file that `export default defineModule({...})`. The CLI
 * loads it, runs each dataset case through `runnable()`, grades the output with every
 * `evaluator`, averages the grades per metric key, and renders a table — dumping any case
 * whose grade falls below its metric threshold.
 */

export interface EvalCase<In, Out = unknown> {
  input: In;
  expected?: Out;
  /** Human label for the table/dump and for case-targeted scorers. */
  label?: string;
}

export interface EvalScore {
  key: string;
  grade: number;
  /** Optional judge/scorer rationale, surfaced in below-threshold dumps. */
  comment?: string;
  /** Threshold this score should be measured against (helpers attach it). */
  threshold?: number;
}

export interface EvalContext<In, Out> {
  input: In;
  output: Out;
  expected?: Out;
  label?: string;
  index: number;
  /**
   * The tracing callbacks from `config.tracing()`, the same ones attached to the module's
   * runnable. Pass them to any chain an evaluator builds itself — an LLM judge, most often —
   * so its spans land under the same trace instead of disappearing:
   *
   *   ({ output, callbacks }) => JudgeChain().withConfig({ callbacks }).invoke({ output })
   *
   * Empty when `config.tracing` is unset, so passing it through is always safe.
   *
   * Typed as LangChain's handler array rather than `unknown[]` so it drops straight into
   * `withConfig({ callbacks })` — the one thing it is for — without a cast at the call site.
   */
  callbacks: BaseCallbackHandler[];
}

export type EvaluatorReturn = EvalScore | EvalScore[] | number | boolean | void | null | undefined;

export interface Evaluator<In = any, Out = any> {
  (ctx: EvalContext<In, Out>): EvaluatorReturn | Promise<EvaluatorReturn>;
  /** Set by llmJudge()/scorer() so the runner knows the metric before it runs. */
  evalMeta?: { key: string; threshold?: number; kind: 'llm-judge' | 'scorer' | 'fn' };
}

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
}
