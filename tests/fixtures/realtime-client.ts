import { vi } from 'vitest';

/** Offline transport boundary: native providers keep their actual subscription lifetimes. */
export function createRealtimeFixture() {
  const listeners = new Set<() => void>();
  return {
    active: true,
    state: 'ready' as const,
    reconnect: vi.fn(() =>
      queueMicrotask(() => listeners.forEach((listener) => listener())),
    ),
    onOpen: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    onStateChange: vi.fn(() => () => undefined),
    watch: vi.fn(() => ({ close: vi.fn() })),
  };
}
