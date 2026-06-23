export type ModuleStatus = 'pending' | 'running' | 'pass' | 'fail';

export interface ModuleState {
  id: string;
  name: string;
  total: number;
  done: number;
  status: ModuleStatus;
  metricsTotal?: number;
  metricsPassed?: number;
}

/**
 * Live state of a parallel run, shaped for React's `useSyncExternalStore`: `getSnapshot`
 * returns a stable array reference that only changes when something actually changes.
 * Module objects are mutated in place; each change rebuilds the snapshot array.
 */
export class RunStore {
  private readonly map = new Map<string, ModuleState>();
  private readonly order: string[] = [];
  private snapshot: ModuleState[] = [];
  private readonly listeners = new Set<() => void>();

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): ModuleState[] => this.snapshot;

  private emit(): void {
    this.snapshot = this.order.map((id) => this.map.get(id)!);
    for (const l of this.listeners) l();
  }

  init(id: string, name: string): void {
    if (!this.map.has(id)) this.order.push(id);
    this.map.set(id, { id, name, total: 0, done: 0, status: 'pending' });
    this.emit();
  }

  rename(id: string, name: string): void {
    const s = this.map.get(id);
    if (s) {
      s.name = name;
      this.emit();
    }
  }

  start(id: string, total: number): void {
    const s = this.map.get(id);
    if (s) {
      s.total = total;
      s.status = 'running';
      this.emit();
    }
  }

  tick(id: string): void {
    const s = this.map.get(id);
    if (s) {
      s.done += 1;
      this.emit();
    }
  }

  finish(id: string, opts: { failed: boolean; metricsTotal: number; metricsPassed: number }): void {
    const s = this.map.get(id);
    if (s) {
      s.status = opts.failed ? 'fail' : 'pass';
      s.metricsTotal = opts.metricsTotal;
      s.metricsPassed = opts.metricsPassed;
      if (s.total === 0) s.total = s.done;
      this.emit();
    }
  }

  fail(id: string): void {
    const s = this.map.get(id);
    if (s) {
      s.status = 'fail';
      this.emit();
    }
  }
}
