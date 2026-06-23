export { defineModule } from './define-module.js';
export { llmJudge } from './evaluators/llm-judge.js';
export type { LLMJudgeOptions } from './evaluators/llm-judge.js';
export { scorer } from './evaluators/scorer.js';
export type { ScorerOptions } from './evaluators/scorer.js';

export type {
  EvalCase,
  EvalContext,
  EvalModule,
  EvalScore,
  Evaluator,
  EvaluatorReturn,
  RunnableLike,
} from './types.js';

// TRANSITIONAL — remove with the last migrated *.ai.test.ts (plan Part C).
export { evalDataset } from './eval-dataset.js';
export type {
  EvalDatasetOptions,
  EvalDatasetResult,
  SimpleEvaluator,
} from './eval-dataset.js';
