import { Box, render, Text } from 'ink';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import type { ModuleState, RunStore } from './store.js';

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const BAR_WIDTH = 22;

function useSpinner(): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => f + 1), 80);
    return () => clearInterval(t);
  }, []);
  return SPINNER[frame % SPINNER.length];
}

function Bar({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? done / total : 0;
  const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(ratio * BAR_WIDTH)));
  return (
    <Text>
      <Text color="cyan">{'█'.repeat(filled)}</Text>
      <Text color="gray">{'░'.repeat(BAR_WIDTH - filled)}</Text>
    </Text>
  );
}

function RunningRow({ m, spinner }: { m: ModuleState; spinner: string }) {
  const name = m.name.length > 32 ? `${m.name.slice(0, 31)}…` : m.name.padEnd(32);
  const count = m.total > 0 ? `${m.done}/${m.total}` : '…';
  return (
    <Box>
      <Text color="cyan">{spinner} </Text>
      <Text>{name} </Text>
      <Bar done={m.done} total={m.total} />
      <Text color="yellow"> {count}</Text>
    </Box>
  );
}

export function Dashboard({ store }: { store: RunStore }) {
  const modules = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const spinner = useSpinner();

  const running = modules.filter((m) => m.status === 'running');
  const passed = modules.filter((m) => m.status === 'pass').length;
  const failed = modules.filter((m) => m.status === 'fail').length;
  const settled = passed + failed;

  return (
    <Box flexDirection="column">
      <Box>
        <Text backgroundColor="blue" color="white" bold>
          {' AI EVAL '}
        </Text>
        <Text>
          {' '}
          {settled}/{modules.length} modules
        </Text>
        {passed > 0 && <Text color="green"> · {passed} ✓</Text>}
        {failed > 0 && <Text color="red"> · {failed} ✗</Text>}
        {running.length > 0 && <Text color="gray"> · {running.length} running</Text>}
      </Box>
      {running.map((m) => (
        <RunningRow key={m.id} m={m} spinner={spinner} />
      ))}
    </Box>
  );
}

export interface DashboardHandle {
  unmount: () => void;
  waitUntilExit: () => Promise<void>;
}

/** Mount the live dashboard. Returns a handle; call unmount() when the run is done. */
export function mountDashboard(store: RunStore): DashboardHandle {
  // patchConsole:false — our console-proxy owns capture; Ink must not also patch it.
  const instance = render(<Dashboard store={store} />, { patchConsole: false });
  return {
    unmount: () => instance.unmount(),
    waitUntilExit: () => instance.waitUntilExit(),
  };
}
