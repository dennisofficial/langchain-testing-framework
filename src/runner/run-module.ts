import type { AIConfig } from '../config.js';
import type { EvalCase, EvalModule, EvalScore, Evaluator } from '../types.js';
import { type CapturedLog, installConsoleCapture, restoreConsole, withCaseCapture } from './console-proxy.js';
import { mapWithConcurrency } from './semaphore.js';

export interface CaseResult<In = unknown, Out = unknown> {
  index: number;
  label?: string;
  input: In;
  expected?: Out;
  output?: Out;
  error?: Error;
  scores: EvalScore[];
  logs: CapturedLog[];
}

export interface MetricSummary {
  key: string;
  avg: number;
  n: number;
  threshold: number;
  pass: boolean;
}

export interface ModuleResult {
  name: string;
  cases: CaseResult[];
  metrics: MetricSummary[];
  durationMs: number;
  /** Below-threshold (case, score) pairs, for the dump. */
  belowThreshold: Array<{ case: CaseResult; score: EvalScore; threshold: number }>;
  failed: boolean;
}

export interface RunModuleOptions {
  config: AIConfig;
  callbacks?: unknown[];
  /** From `--threshold`; overrides every metric's threshold when set. */
  thresholdOverride?: number;
  /** Called once after the dataset resolves, before cases run (to size a progress bar). */
  onStart?: (total: number) => void;
  onCaseDone?: (done: number, total: number) => void;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

function normalizeScores(raw: unknown, evaluator: Evaluator): EvalScore[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw.flatMap((r) => normalizeScores(r, evaluator));
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    const grade = typeof raw === 'boolean' ? (raw ? 1 : 0) : raw;
    return [{ key: evaluator.evalMeta?.key ?? 'score', grade, threshold: evaluator.evalMeta?.threshold }];
  }
  if (typeof raw === 'object' && 'key' in raw && 'grade' in raw) return [raw as EvalScore];
  return [];
}

export async function runModule<In, Out>(
  mod: EvalModule<In, Out>,
  opts: RunModuleOptions,
): Promise<ModuleResult> {
  const { config, callbacks, thresholdOverride, onStart, onCaseDone } = opts;
  const start = Date.now();

  const dataset = (await mod.dataset()) as EvalCase<In, Out>[];
  onStart?.(dataset.length);
  const runnable = await mod.runnable();
  const concurrency = mod.concurrency ?? config.defaults?.concurrency ?? 3;
  const target =
    callbacks && callbacks.length && runnable.withConfig
      ? runnable.withConfig({ callbacks })
      : runnable;

  installConsoleCapture();
  let done = 0;
  let cases: CaseResult<In, Out>[];
  try {
    cases = await mapWithConcurrency(dataset, concurrency, async (caseDef, index) => {
      const logs: CapturedLog[] = [];
      let output: Out | undefined;
      let error: Error | undefined;
      let scores: EvalScore[] = [];

      // Capture invoke AND evaluator logs together so nothing reaches the live TUI.
      await withCaseCapture(logs, async () => {
        try {
          output = await target.invoke(caseDef.input);
        } catch (e) {
          error = asError(e);
          return;
        }
        const ctx = {
          input: caseDef.input,
          output: output as Out,
          expected: caseDef.expected,
          label: caseDef.label,
          index,
        };
        const perEvaluator = await Promise.all(
          mod.evaluators.map(async (ev) => {
            try {
              return normalizeScores(await ev(ctx), ev);
            } catch (e) {
              return [
                { key: ev.evalMeta?.key ?? 'evaluator-error', grade: 0, comment: asError(e).message },
              ] as EvalScore[];
            }
          }),
        );
        scores = perEvaluator.flat();
      });

      onCaseDone?.(++done, dataset.length);
      return { index, label: caseDef.label, input: caseDef.input, expected: caseDef.expected, output, error, scores, logs };
    });
  } finally {
    restoreConsole();
  }

  // Aggregate per metric key.
  const defaultThreshold = mod.threshold ?? config.defaults?.threshold ?? 0.8;
  const groups = new Map<string, { sum: number; n: number; scoreThreshold?: number }>();
  for (const c of cases) {
    for (const s of c.scores) {
      const g = groups.get(s.key) ?? { sum: 0, n: 0, scoreThreshold: undefined };
      g.sum += clamp01(s.grade);
      g.n += 1;
      if (g.scoreThreshold === undefined && s.threshold !== undefined) g.scoreThreshold = s.threshold;
      groups.set(s.key, g);
    }
  }

  const thresholdFor = (key: string) =>
    thresholdOverride ?? groups.get(key)?.scoreThreshold ?? defaultThreshold;

  const metrics: MetricSummary[] = [...groups.entries()].map(([key, g]) => {
    const avg = g.n ? g.sum / g.n : 0;
    const threshold = thresholdFor(key);
    return { key, avg, n: g.n, threshold, pass: avg >= threshold };
  });

  const belowThreshold: ModuleResult['belowThreshold'] = [];
  for (const c of cases) {
    for (const s of c.scores) {
      const threshold = thresholdFor(s.key);
      if (clamp01(s.grade) < threshold) belowThreshold.push({ case: c, score: s, threshold });
    }
  }

  // Objective verdict; the CLI applies `failOnBelowThreshold` to the process exit code.
  const failed = cases.some((c) => c.error) || metrics.some((m) => !m.pass);

  return {
    name: mod.name,
    cases,
    metrics,
    durationMs: Date.now() - start,
    belowThreshold,
    failed,
  };
}
