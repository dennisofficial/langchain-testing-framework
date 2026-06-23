# @workspace/ai-testing

A standalone CLI **eval runner** for LangChain chains and agents. You write an *eval module*, run `ai-eval`, and get a live dashboard, a per-metric score table, and a dump of every case that scored below threshold — so you can actually see *how well* a chain performs, not just a green checkmark.

```
 AI EVAL  summarize · faithfulness   8 cases · 2 metrics · 6.4s
  ┌───────────────┬────────┬───┬───────────┬────────┐
  │ metric        │    avg │ n │ threshold │        │
  ├───────────────┼────────┼───┼───────────┼────────┤
  │ faithfulness  │  87.5% │ 8 │   ≥ 80.0% │ ✓ PASS │
  ├───────────────┼────────┼───┼───────────┼────────┤
  │ has-summary   │ 100.0% │ 8 │  ≥ 100.0% │ ✓ PASS │
  └───────────────┴────────┴───┴───────────┴────────┘
```

It is **runner-agnostic about tracing** (LangFuse/LangSmith/PostHog are wired in *your* config, optionally) and uses real provider calls — these are efficacy tests, not unit tests.

---

## Why not just use vitest?

Vitest tells you *pass* or *fail*. An eval needs the number: `faithfulness = 66.7%` against a `≥ 80%` bar, **which** of the 12 cases failed, the judge's reasoning, and the captured logs for that case. This runner computes the score across a dataset, averages per metric, and surfaces all of it. It exits non-zero when a metric is below threshold, so it still works in CI.

---

## Install

It's a workspace package. Add it to the project you want to test from (e.g. a backend):

```jsonc
// package.json
{ "dependencies": { "@workspace/ai-testing": "workspace:*" } }
```

The CLI is exposed as the `ai-eval` bin:

```bash
pnpm exec ai-eval --list
```

> Peer dep: `@langchain/core` (>=1). The judge helpers use `openevals`/`agentevals`, bundled as deps.

---

## Quick start

### 1. `ai-testing.config.ts` (project root)

```ts
import { defineConfig } from '@workspace/ai-testing/config';

export default defineConfig({
  // Runs once before any module loads — load env, warm caches, start a tracer.
  setup: async () => {
    const { config } = await import('@dotenvx/dotenvx');
    config({ path: '.env.test.enc', strict: true });
  },

  // Optional. Return LangChain callbacks attached to every runnable.invoke. [] = no tracing.
  tracing: async () =>
    process.env.LANGFUSE_SECRET_KEY
      ? [new (await import('@workspace/langfuse')).LangfuseCallbackHandler({ tags: ['ai-eval'] })]
      : [],

  defaults: {
    threshold: 0.8,         // metric average must be ≥ this unless overridden
    concurrency: 24,        // max in-flight test cases across ALL modules (rate-limit knob)
    failOnBelowThreshold: true,
  },
  report: { dumpBelowThreshold: true, showConsoleLogs: true, maxDumps: 5 },
});
```

### 2. A `*.eval.ts` module

A module wires a **dataset** through a **runnable** and grades the output with **evaluators**. Reuse whatever dataset you already have.

```ts
import { defineModule, llmJudge, scorer } from '@workspace/ai-testing';
import { makeSummarizer } from './summarizer';

type In = { article: string };
type Out = { summary: string };

export default defineModule<In, Out>({
  name: 'summarize · faithfulness',
  dataset: () => [
    { input: { article: 'The city council approved a $2M park renovation…' }, label: 'park' },
    { input: { article: 'Quarterly revenue rose 12% on strong cloud sales…' }, label: 'earnings' },
  ],
  runnable: () => makeSummarizer(),        // any LangChain Runnable (has .invoke / .withConfig)
  evaluators: [
    // EFFICACY: does the summary stay true to the article?
    llmJudge({
      key: 'faithfulness',
      threshold: 0.8,
      model: 'openai:gpt-4.1-mini',
      prompt: `Does the summary contain only claims supported by the article?
<article>{inputs}</article>
<summary>{outputs}</summary>
Score true only if every claim in the summary is grounded in the article.`,
    }),
    // STRUCTURE: programmatic invariant
    scorer({ key: 'has-summary', threshold: 1, run: ({ output }) => (output.summary.trim() ? 1 : 0) }),
  ],
});
```

### 3. Run it

```bash
cd <project>
pnpm exec ai-eval summarize          # fuzzy-match by file path
pnpm exec ai-eval --all              # every *.eval.ts
pnpm exec ai-eval --all --check      # validate all modules load — no LLM calls
```

---

## Concepts

### Module — `defineModule({ name, dataset, runnable, evaluators })`

| field | type | notes |
|---|---|---|
| `name` | `string` | shown in the report header |
| `dataset` | `() => EvalCase[] \| Promise<EvalCase[]>` | `{ input, expected?, label? }[]` — may be **async**; `label` shows in dumps and lets a scorer target one case |
| `runnable` | `() => Runnable \| Promise<Runnable>` | builds the chain/agent under test (may be **async**); any LangChain `Runnable` (`invoke` + `withConfig`) |
| `evaluators` | `Evaluator[]` | one or more graders (see below) |
| `threshold?` | `number` | module-level default threshold for metrics without their own |

`dataset` and `runnable` may both be **async** (return a `Promise`). The package imports no
dataset/tracing SDK, so to pull a dataset from Langfuse you bring your own client (load creds in
`config.setup()`):

```ts
dataset: async () => {
  const lf = new LangfuseClient();                  // creds from env
  const ds = await lf.dataset.get('MLS/GOLD-9');    // exact call depends on your SDK version
  return ds.items.map((item) => ({
    input: item.input,
    expected: item.expectedOutput ?? undefined,
    label: item.id,
  }));
},
```

`runnable` can likewise be an async factory (e.g. one that fetches a managed prompt before
building the chain).

### Evaluators

Three flavours, mix freely. All produce metrics keyed by `key`, normalized to `[0,1]`.

**`llmJudge` — LLM-as-judge (efficacy).** Wraps `openevals`; you never import it.

```ts
llmJudge({
  key: 'groundedness',
  threshold: 0.8,
  model: 'openai:gpt-4.1-mini',
  prompt: `…{inputs}…{outputs}…{reference_outputs}…`,   // placeholders are filled per case
  // continuous?: true   // return a 0..1 score instead of pass/fail
});
```

**`scorer` — programmatic.** Return a number (`0..1`), a boolean (→ 0/1), or `[]`/`undefined` to **skip** a case (useful for an invariant that only applies to one labelled case).

```ts
scorer({
  key: 'tier-correct',
  threshold: 1,
  run: ({ output, expected, label, index }) =>
    label === 'three-beats' ? (output.tier === 'standard' ? 1 : 0) : [],
});
```

**Bare function.** Return an `EvalScore` (`{ key, grade, comment? }`) or an array.

```ts
({ output }) => ({ key: 'non-empty', grade: output.text ? 1 : 0 });
```

### Scoring & thresholds

- Each evaluator runs on every case; grades are averaged **per metric key**.
- A metric **passes** when `avg ≥ threshold`. Threshold resolution: `--threshold` flag → the evaluator's own `threshold` → the module's `threshold` → `config.defaults.threshold` (0.8).
- A case is **dumped** (input / output / expected / judge comment / captured logs) when its own grade for a metric is below that metric's threshold.
- The process exits `1` if any metric is below threshold or any case errored (gate with `config.defaults.failOnBelowThreshold` / `--no-fail`).

---

## CLI

```
ai-eval [selectors...] [options]
```

**Selectors** are case-sensitive **substrings matched against the file path** (`summarize`, `phase01`, `node-00a` all work) or explicit paths. Multiple selectors run the union. No selector + no `--all` → lists what's available.

| option | meaning |
|---|---|
| `-a, --all` | run every discovered `*.eval.ts` |
| `-c, --concurrency <n>` | max concurrent test **cases** across all modules (the rate-limit knob) |
| `-j, --jobs <n>` | max modules open at once (default = `--concurrency`) |
| `-t, --threshold <n>` | override every metric threshold (0..1) — e.g. `--threshold 0.99` to force dumps |
| `--check` | dry-run: load + validate every module (dataset/runnable/evaluators), **no LLM calls** |
| `--list` | list discovered modules and exit |
| `--no-tui` | disable the live dashboard (plain per-module lines) |
| `--no-fail` | always exit 0 |
| `--tsconfig <path>` | tsconfig the loader uses for path aliases |

---

## Output

- **Live dashboard (TTY):** an Ink TUI — `AI EVAL  m/N modules · ✓ · ✗`, with a spinner + progress bar per running module. Non-TTY/CI or `--no-tui` falls back to plain `✓/✗` lines.
- **After the run:** a score table per module, then below-threshold case dumps, then a summary line.
- **Console logs** emitted while a case runs are captured and replayed only in that case's dump — they never scramble the dashboard.

---

## Concurrency & rate limits

`--concurrency` caps the total number of in-flight **cases** (each case ≈ one chain call + its judge calls) across all modules — implemented with a single shared `async-sema` semaphore. Because most chains hit more than one provider, and provider limits are per-model, you can usually run quite high. Rough sizing:

```
concurrency ≈ (your tier's RPM ÷ 60) × avg_latency_seconds
```

LangChain models retry 429s with backoff, so modest overshoot self-heals (slower, not broken). Set a project-wide default in `ai-testing.config.ts` (`defaults.concurrency`) and override per-run with `--concurrency`.

---

## Tracing (optional)

The package imports **no** tracing SDK. Wire it in your config's `tracing()` (return LangChain callbacks) and, if you use OpenTelemetry spans, start the SDK in `setup()` and flush it in `teardown()`. Return `[]` to disable.

---

## Writing evals that actually measure efficacy

A `.eval.ts` is only useful if it tells you whether the node *works well* — not just whether it returns the right shape. Aim for, per module:

1. **A quality judge (the point).** An `llmJudge` that grades the output against the node's actual job — groundedness, faithfulness, correct classification, adherence to the spec — using the **input as the only evidence**. Score `false` for fabrication, projection, or clearly-wrong outputs; don't penalize wording.
2. **Structural invariants** as `scorer`s with `threshold: 1` — required fields present, enums valid, arrays are arrays.
3. **Semantic invariants** as case-targeted `scorer`s — when a specific input has a known-correct answer (e.g. "this 3-beat brief must be classified `standard`"), assert it (target by `label`/`index`, return `[]` for other cases).
4. **Calibration cases** — include a deliberately thin/ambiguous/adversarial input and assert the node *hedges* instead of fabricating confidence.

Keep datasets compact (real LLM calls cost money) but representative of the cases that matter.

---

## Loader notes

`ai-eval` loads your TypeScript via a globally-registered `tsx` (it re-execs itself once under `node --import tsx`). Path aliases and any stub mappings come from your `tsconfig` (auto-detected `tsconfig.eval.json`, else `tsconfig.json`, or `--tsconfig`).
