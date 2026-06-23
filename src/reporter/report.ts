import { inspect } from 'node:util';
import chalk from 'chalk';
import Table from 'cli-table3';
import prettyMs from 'pretty-ms';
import type { AIConfig } from '../config.js';
import type { CaseResult, ModuleResult } from '../runner/run-module.js';
import type { CapturedLog } from '../runner/console-proxy.js';

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const dim = chalk.dim;

function inspectValue(v: unknown): string {
  return inspect(v, { depth: 4, colors: false, maxStringLength: 800, breakLength: 100 });
}

/** Print one module's header + metric table, then dump below-threshold cases. */
export function printModuleReport(result: ModuleResult, config: AIConfig): void {
  const evaluatorCount = new Set(result.metrics.map((m) => m.key)).size;
  const header = chalk.bgBlue.white.bold(` AI EVAL `);
  const meta = dim(
    `${result.cases.length} cases · ${evaluatorCount} metrics · ${prettyMs(result.durationMs)}`,
  );
  console.log(`\n${header} ${chalk.bold(result.name)}   ${meta}`);

  const caseErrors = result.cases.filter((c) => c.error);
  if (caseErrors.length) {
    console.log(
      chalk.red(`  ✗ ${caseErrors.length}/${result.cases.length} case(s) errored before grading`),
    );
  }

  if (result.metrics.length === 0) {
    console.log(dim('  (no metrics produced)'));
  } else {
    const table = new Table({
      head: ['metric', 'avg', 'n', 'threshold', ''].map((h) => chalk.dim(h)),
      style: { head: [], border: ['gray'] },
      colAligns: ['left', 'right', 'right', 'right', 'left'],
    });
    for (const m of result.metrics) {
      const verdict = m.pass ? chalk.green('✓ PASS') : chalk.red('✗ FAIL');
      const avg = m.pass ? chalk.green(pct(m.avg)) : chalk.red(pct(m.avg));
      table.push([m.key, avg, String(m.n), `≥ ${pct(m.threshold)}`, verdict]);
    }
    console.log(
      table
        .toString()
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
    );
  }

  const dumpEnabled = config.report?.dumpBelowThreshold ?? true;
  if (dumpEnabled && result.belowThreshold.length) {
    dumpBelowThreshold(result, config);
  }
}

function dumpBelowThreshold(result: ModuleResult, config: AIConfig): void {
  const maxDumps = config.report?.maxDumps ?? 5;
  const showLogs = config.report?.showConsoleLogs ?? true;

  // Group by metric so the operator sees "which metric, which cases".
  const byMetric = new Map<string, typeof result.belowThreshold>();
  for (const row of result.belowThreshold) {
    const list = byMetric.get(row.score.key) ?? [];
    list.push(row);
    byMetric.set(row.score.key, list);
  }

  for (const [key, rows] of byMetric) {
    console.log(
      chalk.yellow(`\n  ⚠ ${key} — ${rows.length} case(s) below threshold (≥ ${pct(rows[0].threshold)})`),
    );
    for (const row of rows.slice(0, maxDumps)) {
      dumpCase(row.case, row.score, showLogs);
    }
    if (rows.length > maxDumps) {
      console.log(dim(`    … ${rows.length - maxDumps} more (raise report.maxDumps to see all)`));
    }
  }
}

function dumpCase(c: CaseResult, score: { grade: number; comment?: string }, showLogs: boolean): void {
  const id = c.label ? `${c.label} (#${c.index})` : `case #${c.index}`;
  console.log(chalk.yellow(`  ┌─ ${id} · grade ${pct(score.grade)} ${'─'.repeat(Math.max(0, 48 - id.length))}`));
  const line = (label: string, body: string) => {
    const [first, ...rest] = body.split('\n');
    console.log(`  ${chalk.dim('│')} ${chalk.cyan(label.padEnd(9))} ${first}`);
    for (const r of rest) console.log(`  ${chalk.dim('│')} ${' '.repeat(10)}${r}`);
  };
  line('input', inspectValue(c.input));
  line('output', c.error ? chalk.red(c.error.message) : inspectValue(c.output));
  if (c.expected !== undefined) line('expected', inspectValue(c.expected));
  if (score.comment) line('judge', score.comment);
  if (showLogs && c.logs.length) line('logs', formatLogs(c.logs));
  console.log(`  ${chalk.dim('└' + '─'.repeat(60))}`);
}

function formatLogs(logs: CapturedLog[]): string {
  return logs
    .map((l) => l.args.map((a) => (typeof a === 'string' ? a : inspectValue(a))).join(' '))
    .join('\n');
}

/** Final cross-module summary line + the process exit verdict. */
export function printRunSummary(results: ModuleResult[]): { failed: boolean } {
  const failedModules = results.filter((r) => r.failed);
  const totalMetrics = results.reduce((n, r) => n + r.metrics.length, 0);
  const failedMetrics = results.reduce((n, r) => n + r.metrics.filter((m) => !m.pass).length, 0);

  console.log(chalk.dim('\n' + '─'.repeat(64)));
  if (failedModules.length === 0) {
    console.log(chalk.green.bold(`  ✓ all ${results.length} module(s) passed (${totalMetrics} metrics)`));
    return { failed: false };
  }
  console.log(
    chalk.red.bold(
      `  ✗ ${failedModules.length}/${results.length} module(s) failed — ${failedMetrics}/${totalMetrics} metrics below threshold`,
    ),
  );
  for (const r of failedModules) {
    const failing = r.metrics.filter((m) => !m.pass).map((m) => `${m.key} ${pct(m.avg)}`);
    const errored = r.cases.some((c) => c.error) ? ' +case errors' : '';
    console.log(chalk.red(`    · ${r.name}: ${failing.join(', ') || 'case errors'}${errored}`));
  }
  return { failed: true };
}
