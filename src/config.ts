/**
 * Public config surface. A project drops an `ai-testing.config.ts` at its root and
 * `export default defineConfig({...})`. The CLI loads it, runs `setup()` before any test,
 * forwards `tracing()` callbacks into each `runnable.invoke`, and runs `teardown()` at the
 * end. Tracing is entirely optional — the package imports no tracing SDK.
 */

/** LangChain `BaseCallbackHandler` instances. Typed loosely to avoid an SDK dependency. */
export type TracingCallbacks = unknown[];

export interface AIConfig {
  /** Runs once before any module loads (load env, warm caches, start a tracer SDK). */
  setup?: () => void | Promise<void>;
  /** Runs once after all modules (flush/shutdown a tracer). Always awaited in a finally. */
  teardown?: () => void | Promise<void>;
  /** Return LangChain callbacks to attach to every `runnable.invoke`. `[]` = no tracing. */
  tracing?: () => TracingCallbacks | Promise<TracingCallbacks>;

  defaults?: {
    /** Metric average must be ≥ this unless overridden per-metric/per-module. Default 0.8. */
    threshold?: number;
    /** Max concurrent cases per module. Default 3. */
    concurrency?: number;
    /** Exit non-zero when a metric is below threshold. Default true. */
    failOnBelowThreshold?: boolean;
  };

  report?: {
    /** Print input/output/expected/judge/logs for cases below threshold. Default true. */
    dumpBelowThreshold?: boolean;
    /** Replay each case's captured console output in its dump. Default true. */
    showConsoleLogs?: boolean;
    /** Cap the number of dumped cases per metric. Default 5. */
    maxDumps?: number;
  };

  /**
   * Globs the CLI discovers, relative to the config dir. Default `['**\/*.eval.ts']`.
   *
   * Loader note: tsx resolves module files using `tsconfig.eval.json` (auto-detected next
   * to this config) or a `--tsconfig` flag — that's where path aliases such as
   * `@workspace/shared` → the test stub live.
   */
  testMatch?: string[];
}

export function defineConfig(config: AIConfig): AIConfig {
  return config;
}
