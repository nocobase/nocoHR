import type { Application } from '@nocobase/app-server/application';

interface ProviderState {
  provider: { name: string };
  state: string;
}

/** Read-only diagnostics for the fixed Server version; never drive shutdown from these states. */
export function fixtureProviderStates(
  application?: Application,
  includeClosed = false,
) {
  const registry = (
    application as unknown as
      { providerRegistry?: { providers: ProviderState[] } } | undefined
  )?.providerRegistry;
  return (registry?.providers ?? [])
    .filter((entry) => includeClosed || entry.state !== 'shutdown')
    .map(({ provider, state }) => ({ name: provider.name, state }));
}

/** Observe the original close promise without a deadline, race, cancellation or forced disposal. */
export async function observeFixtureClose({
  suite,
  stage,
  close,
  application,
  state = () => ({}),
}: {
  suite: string;
  stage: 'application' | 'writeback';
  close: () => Promise<void> | undefined;
  application?: Application;
  state?: () => Record<string, unknown>;
}) {
  const started = performance.now();
  const report = (event: 'begin' | 'waiting' | 'done' | 'failed') => {
    // Direct output survives console interception in application-backed tests.
    process.stderr.write(
      `FIXTURE_CLOSE ${JSON.stringify({
        suite,
        stage,
        event,
        pid: process.pid,
        elapsedMs: Math.round(performance.now() - started),
        providers: fixtureProviderStates(application),
        resources: process.getActiveResourcesInfo(),
        ...state(),
      })}\n`,
    );
  };
  report('begin');
  const observer = setInterval(() => report('waiting'), 5000);
  observer.unref();
  try {
    await close();
    report('done');
  } catch (error) {
    report('failed');
    throw error;
  } finally {
    clearInterval(observer);
  }
}
