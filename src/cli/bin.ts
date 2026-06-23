import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Sema } from 'async-sema';
import chalk from 'chalk';
import { Command } from 'commander';
import { register } from 'tsx/esm/api';
import { printModuleReport, printRunSummary } from '../reporter/report.js';
import { drainGlobalLogs } from '../runner/console-proxy.js';
import type { ModuleResult } from '../runner/run-module.js';
import { runModule } from '../runner/run-module.js';
import { discover, listAll } from './discover.js';
import { findConfigPath, loadConfig, resolveTsconfig } from './load-config.js';
import { loadModule } from './load-module.js';
import { mountDashboard } from './tui/dashboard.js';
import { RunStore } from './tui/store.js';

const TSX_SENTINEL = '__AI_TESTING_TSX';
// Fallback global case concurrency when neither --concurrency nor ai-testing.config.ts sets it.
const DEFAULT_CONCURRENCY = 12;

/**
 * Loading project TypeScript (config + `.eval.ts`) that imports a CommonJS-typed backend
 * works cleanly only under a GLOBALLY registered tsx (`node --import tsx`). So the parent
 * process re-execs itself once under `--import <tsx loader>` (see plan / memory notes).
 */
function reExecUnderTsx(): Promise<number> {
  const require = createRequire(import.meta.url);
  const tsxLoader = require.resolve('tsx'); // → tsx/dist/loader.mjs
  const self = fileURLToPath(import.meta.url);

  const cwd = process.cwd();
  const configPath = findConfigPath(cwd);
  const root = configPath ? dirname(configPath) : cwd;
  const flagIdx = process.argv.indexOf('--tsconfig');
  const tsconfig = resolveTsconfig(root, flagIdx >= 0 ? process.argv[flagIdx + 1] : undefined);

  const env: NodeJS.ProcessEnv = { ...process.env, [TSX_SENTINEL]: '1' };
  if (tsconfig) env.TSX_TSCONFIG_PATH = tsconfig;

  const child = spawn(
    process.execPath,
    ['--import', pathToFileURL(tsxLoader).href, self, ...process.argv.slice(2)],
    { stdio: 'inherit', env },
  );
  return new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve(signal ? 1 : (code ?? 1)));
    child.on('error', (err) => {
      console.error(chalk.red('failed to start loader:'), err);
      resolve(1);
    });
  });
}

const passedCount = (r: ModuleResult) => r.metrics.filter((m) => m.pass).length;

/**
 * `--check`: load every module and validate its dataset/runnable/evaluators WITHOUT running
 * any case (no LLM calls). Catches broken imports, bad default exports, empty datasets, and
 * runnables that aren't invokable — the cheap gate for a freshly written/migrated .eval.ts.
 */
async function checkModules(files: string[], root: string, jobs: number): Promise<number> {
  const sema = new Sema(jobs);
  let failed = 0;
  await Promise.all(
    files.map(async (file) => {
      await sema.acquire();
      try {
        const mod = await loadModule(file);
        const dataset = await mod.dataset();
        const runnable = await mod.runnable();
        const problem =
          !Array.isArray(dataset) || dataset.length === 0
            ? 'empty or non-array dataset'
            : !runnable || typeof runnable.invoke !== 'function'
              ? 'runnable() did not return something with .invoke()'
              : !Array.isArray(mod.evaluators) || mod.evaluators.length === 0
                ? 'no evaluators'
                : undefined;
        if (problem) {
          failed += 1;
          console.log(`  ${chalk.red('✗')} ${relative(root, file)} — ${problem}`);
        } else {
          console.log(
            `  ${chalk.green('✓')} ${mod.name} ${chalk.dim(`(${dataset.length} cases, ${mod.evaluators.length} evaluators)`)}`,
          );
        }
      } catch (e) {
        failed += 1;
        console.log(`  ${chalk.red('✗')} ${relative(root, file)} — ${(e as Error).message}`);
      } finally {
        sema.release();
      }
    }),
  );
  console.log(
    failed
      ? chalk.red(`\n${failed}/${files.length} module(s) failed to load`)
      : chalk.green(`\n✓ all ${files.length} module(s) load cleanly`),
  );
  return failed ? 1 : 0;
}

/** Real work — runs in the child, where tsx is globally registered. */
async function run(): Promise<number> {
  const program = new Command();
  program
    .name('ai-eval')
    .description('Standalone eval runner for LangChain modules (.eval.ts).')
    .argument('[selectors...]', 'file-name substrings or paths to run')
    .option('-a, --all', 'run every discovered .eval.ts')
    .option('-c, --concurrency <n>', 'max concurrent test cases across ALL modules (the rate-limit knob)', (v) => Number.parseInt(v, 10))
    .option('-j, --jobs <n>', 'max modules open at once (default: --concurrency)', (v) => Number.parseInt(v, 10))
    .option('-t, --threshold <n>', 'override all metric thresholds (0..1)', (v) => Number.parseFloat(v))
    .option('--tsconfig <path>', 'tsconfig used by the loader (alias/path resolution)')
    .option('--list', 'list discovered modules and exit')
    .option('--check', 'validate modules load (dataset/runnable/evaluators), no LLM calls')
    .option('--no-tui', 'disable the live dashboard (plain output)')
    .option('--no-fail', 'always exit 0 (ignore below-threshold)')
    .allowExcessArguments(false)
    .parse();

  const opts = program.opts<{
    all?: boolean;
    jobs?: number;
    threshold?: number;
    concurrency?: number;
    list?: boolean;
    check?: boolean;
    tui?: boolean;
    fail?: boolean;
  }>();
  const selectors = program.args;
  const cwd = process.cwd();
  const configPath = findConfigPath(cwd);
  const root = configPath ? dirname(configPath) : cwd;

  const { config } = await loadConfig(cwd);
  if (opts.fail === false) config.defaults = { ...config.defaults, failOnBelowThreshold: false };
  const thresholdOverride =
    opts.threshold !== undefined && Number.isFinite(opts.threshold) ? opts.threshold : undefined;
  // Global concurrent cases (the rate-limit knob). Modules open at `jobs` (default = it).
  const concurrency =
    opts.concurrency && opts.concurrency > 0
      ? opts.concurrency
      : (config.defaults?.concurrency ?? DEFAULT_CONCURRENCY);
  const jobs = opts.jobs && opts.jobs > 0 ? opts.jobs : concurrency;
  const patterns = config.testMatch;

  if (opts.list) {
    const files = await listAll(root, patterns);
    console.log(chalk.bold(`\n${files.length} module(s) under ${root}:`));
    for (const f of files) console.log('  ' + relative(root, f));
    return 0;
  }

  const files = await discover({ root, selectors, all: Boolean(opts.all), patterns });
  if (files.length === 0) {
    const available = await listAll(root, patterns);
    if (selectors.length) console.log(chalk.yellow(`\nNo modules matched: ${selectors.join(', ')}`));
    console.log(chalk.dim(`Pass a name, or \`ai-eval --all\`. ${available.length} module(s) available:`));
    for (const f of available.slice(0, 50)) console.log('  ' + relative(root, f));
    if (available.length > 50) console.log(chalk.dim(`  … ${available.length - 50} more`));
    return selectors.length ? 1 : 0;
  }

  await config.setup?.();

  if (opts.check) {
    try {
      return await checkModules(files, root, jobs);
    } finally {
      await config.teardown?.();
    }
  }

  const callbacks = (await config.tracing?.()) ?? [];

  const tui = Boolean(process.stdout.isTTY) && opts.tui !== false;
  const store = new RunStore();
  for (const file of files) store.init(file, relative(root, file));
  const dashboard = tui ? mountDashboard(store) : undefined;

  const loadErrors: Array<{ file: string; error: Error }> = [];
  const caseSema = new Sema(concurrency);
  const moduleSema = new Sema(jobs);
  let results: Array<ModuleResult | null> = [];
  try {
    results = await Promise.all(
      files.map(async (file) => {
        await moduleSema.acquire();
        try {
          let mod;
          try {
            mod = await loadModule(file);
          } catch (e) {
            loadErrors.push({ file, error: e as Error });
            store.fail(file);
            return null;
          }
          store.rename(file, mod.name);
          const result = await runModule(mod, {
            config,
            callbacks,
            sema: caseSema,
            thresholdOverride,
            onStart: (total) => store.start(file, total),
            onCaseDone: () => store.tick(file),
          });
          store.finish(file, {
            failed: result.failed,
            metricsTotal: result.metrics.length,
            metricsPassed: passedCount(result),
          });
          if (!tui) {
            const tag = result.failed ? chalk.red('✗') : chalk.green('✓');
            process.stderr.write(`  ${tag} ${mod.name} (${passedCount(result)}/${result.metrics.length})\n`);
          }
          return result;
        } finally {
          moduleSema.release();
        }
      }),
    );
  } finally {
    if (dashboard) {
      // NOTE: do NOT await waitUntilExit() — it does not resolve after a manual unmount()
      // and would hang the process before the tables print. unmount() is synchronous; a
      // single tick lets Ink flush its final frame before we print below it.
      dashboard.unmount();
      await new Promise((r) => setImmediate(r));
    }
    await config.teardown?.();
  }

  // Flush any logs emitted during the run but outside a case (rare).
  const stray = drainGlobalLogs();
  if (stray.length) {
    console.log(chalk.dim(`\n— ${stray.length} log line(s) emitted outside a case —`));
    for (const l of stray) console.log('  ', ...l.args);
  }
  for (const { file, error } of loadErrors) {
    console.error(chalk.red(`\n✗ failed to load ${relative(root, file)}: ${error.message}`));
  }

  const moduleResults = results.filter((r): r is ModuleResult => r !== null);
  for (const r of moduleResults) printModuleReport(r, config);
  printRunSummary(moduleResults);

  const hasErrors = loadErrors.length > 0 || moduleResults.some((r) => r.cases.some((c) => c.error));
  const hasBelow = moduleResults.some((r) => r.metrics.some((m) => !m.pass));
  const failOnBelow = config.defaults?.failOnBelowThreshold ?? true;
  return hasErrors || (failOnBelow && hasBelow) ? 1 : 0;
}

const entry = process.env[TSX_SENTINEL] ? run() : reExecUnderTsx();
entry
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(chalk.red('ai-eval crashed:'), err);
    process.exit(1);
  });
