import { AsyncLocalStorage } from 'node:async_hooks';

export interface CapturedLog {
  method: 'log' | 'info' | 'warn' | 'debug' | 'error';
  args: unknown[];
}

interface CaseStore {
  logs: CapturedLog[];
}

const als = new AsyncLocalStorage<CaseStore>();
const METHODS = ['log', 'info', 'warn', 'debug', 'error'] as const;

// Ref-counted so parallel modules can each install/restore without un-patching console
// while another module is still running.
let depth = 0;
const original: Partial<Record<(typeof METHODS)[number], (...a: unknown[]) => void>> = {};
// Writes made while capture is active but OUTSIDE a case (e.g. node construction). Buffered
// rather than written live so they never corrupt the Ink TUI; flushed after the run.
const globalBuffer: CapturedLog[] = [];

/**
 * Patch console so calls are routed by context: a call inside a case (via withCaseCapture)
 * attaches to THAT case; a call outside a case during a run is buffered globally. Nothing
 * is written to the terminal while capture is active — the live TUI owns the screen.
 */
export function installConsoleCapture(): void {
  if (depth++ > 0) return;
  for (const m of METHODS) {
    original[m] = console[m] as (...a: unknown[]) => void;
    console[m] = ((...args: unknown[]) => {
      const store = als.getStore();
      if (store) store.logs.push({ method: m, args });
      else globalBuffer.push({ method: m, args });
    }) as typeof console.log;
  }
}

export function restoreConsole(): void {
  if (depth === 0 || --depth > 0) return;
  for (const m of METHODS) {
    if (original[m]) console[m] = original[m] as typeof console.log;
  }
}

/** Run `fn` so any console.* it triggers is attributed to `logs`. */
export function withCaseCapture<T>(logs: CapturedLog[], fn: () => Promise<T>): Promise<T> {
  return als.run({ logs }, fn);
}

/** Drain logs emitted during a run but outside any case (printed after the TUI exits). */
export function drainGlobalLogs(): CapturedLog[] {
  return globalBuffer.splice(0);
}
