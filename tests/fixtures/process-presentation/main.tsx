import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { I18nRuntime } from '@nocobase/i18n';
import { I18nProvider } from '@nocobase/i18n/client';
import { TooltipProvider } from '../../../client/components/ui/tooltip';
import { LifecycleDiagram } from '../../../client/components/lifecycle-diagram';
import { WorkflowExecutionDetail } from '../../../client/extensions/nocobase-workflow-management/execution-detail';
import {
  presentationDescription,
  presentationHistory,
  executionLabels,
} from '../../helpers/process-presentation';
import appLocales from '../../../client/locales';
import '../../../client/styles.css';

const runtime = new I18nRuntime({
  defaultLocale: 'en-US',
  locales: ['en-US', 'zh-CN'],
  applicationNamespace: 'nocohr',
});
runtime.registerApplicationNamespace('nocohr', appLocales);
await runtime.init('en-US');
export function Host() {
  const [configured, setConfigured] = useState('No parameter editor connected');
  const [mode, setMode] = useState<'execution' | 'definition'>('execution');
  return (
    <main className='mx-auto max-w-7xl space-y-6 p-6 text-foreground'>
      <header className='space-y-2'>
        <h1 className='text-2xl font-semibold'>
          Process presentation component host
        </h1>
        <p className='text-muted-foreground'>
          Synthetic display data · Native test sign-in · Process execution and
          outbound channels disabled
        </p>
        <p className='text-sm text-muted-foreground'>
          Component verification only. No real HR process, parameter editor or
          execution history is connected.
        </p>
        <div className='flex gap-3'>
          <button
            className='rounded border p-2'
            onClick={() => setMode('execution')}
          >
            Execution display
          </button>
          <button
            className='rounded border p-2'
            onClick={() => setMode('definition')}
          >
            Definition display
          </button>
        </div>
      </header>
      {mode === 'execution' ? (
        <WorkflowExecutionDetail
          transitions={presentationHistory}
          state='review'
          effects={[
            {
              id: 'synthetic-effect',
              effect: 'Synthetic notification',
              status: 'failed',
              attempts: 1,
              maxAttempts: 3,
              error: 'Synthetic failure — no message sent',
            },
          ]}
          labels={executionLabels}
          parameters={<p>Not recorded — synthetic fixture only</p>}
          stateLabel={(s) =>
            presentationDescription.stateInfo.find((x) => x.name === s)
              ?.title ?? s
          }
          transitionLabel={(s) =>
            presentationDescription.transitions.find((x) => x.name === s)
              ?.title ?? s
          }
          dateLabel={(s) => s}
          effectStatusLabel={(s) => s}
          renderDiagram={({ current, history }) => (
            <LifecycleDiagram
              description={presentationDescription}
              currentState={current}
              history={history}
              ariaLabel='Synthetic execution diagram'
              autoHeight={false}
              initialMinZoom={0.1}
              style={{ height: 650 }}
            />
          )}
        />
      ) : (
        <section className='space-y-4'>
          <p role='status'>{configured}</p>
          <LifecycleDiagram
            description={presentationDescription}
            presentation='process'
            ariaLabel='Synthetic definition diagram'
            style={{ height: 650 }}
            configuration={{
              label: () => 'Parameters',
              canConfigure: (_group, key) => key === 'days',
              onConfigure: (s) =>
                setConfigured(
                  `Display callback only: ${s.target.kind} ${s.target.name}; fields: ${Object.keys(s.groups[0].fields).join(', ')}`,
                ),
            }}
          />
        </section>
      )}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <I18nProvider runtime={runtime}>
    <TooltipProvider>
      <Host />
    </TooltipProvider>
  </I18nProvider>,
);
