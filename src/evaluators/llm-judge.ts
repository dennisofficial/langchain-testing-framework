import { createLLMAsJudge } from 'openevals';
import type { Evaluator } from '../types.js';
import { adaptOpenevalsResult } from './adapt.js';

export interface LLMJudgeOptions {
  /** Metric name shown in the table and used as the openevals feedbackKey. */
  key: string;
  /** Judge prompt. Use {inputs}/{outputs}/{reference_outputs} placeholders. */
  prompt: string;
  /** Model spec, e.g. 'openai:gpt-4.1-mini'. */
  model?: string;
  /** Average score the metric must meet; below this, cases are dumped. */
  threshold?: number;
  /** Return a 0..1 score instead of a boolean pass/fail. */
  continuous?: boolean;
  /** Discrete score choices (passed through to openevals). */
  choices?: number[];
  /** Bring your own judge client (passed through to openevals). */
  judge?: unknown;
  /** Extra system text (passed through to openevals). */
  system?: string;
}

/**
 * LLM-as-judge evaluator backed by openevals `createLLMAsJudge`. The author never imports
 * openevals — they get a ready `Evaluator` carrying its `key` + `threshold`.
 */
export function llmJudge<In = any, Out = any>(opts: LLMJudgeOptions): Evaluator<In, Out> {
  const { key, threshold, ...rest } = opts;
  // openevals' option bag is loosely typed across versions; pass through what it accepts.
  const judge = createLLMAsJudge({ feedbackKey: key, ...rest } as never);

  const evaluator: Evaluator<In, Out> = async ({ input, output, expected }) => {
    const result = await judge({
      inputs: input,
      outputs: output,
      reference_outputs: expected,
    } as never);
    return adaptOpenevalsResult(result as never, { key, threshold });
  };
  evaluator.evalMeta = { key, threshold, kind: 'llm-judge' };
  return evaluator;
}
