import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestI18nRuntime,
  TestI18nProvider,
} from '@nocobase/i18n/testing';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { FlowDiagram } from '../../client/components/flow-diagram';
import { LifecycleDiagram } from '../../client/components/lifecycle-diagram';
import { WorkflowExecutionDetail } from '../../client/extensions/nocobase-workflow-management/execution-detail';
import { WorkflowExecutionList } from '../../client/extensions/nocobase-workflow-management/execution-list';
import { WorkflowDefinitionList } from '../../client/extensions/nocobase-workflow-management/definition-list';
import {
  WorkflowDefinitionDetail,
  WorkflowManagementLayout,
} from '../../client/extensions/nocobase-workflow-management/layout';
import {
  presentationDescription,
  presentationHistory,
  executionLabels,
} from '../helpers/process-presentation';
import enUS from '../../client/locales/en-US';
import zhCN from '../../client/locales/zh-CN';

async function mount(view: ReactNode, locale = 'en-US') {
  const runtime = await createTestI18nRuntime({
    application: {
      namespace: 'nocohr',
      resources: locale === 'zh-CN' ? zhCN : enUS,
    },
    locale,
  });
  return render(
    <TestI18nProvider runtime={runtime}>
      <MemoryRouter>{view}</MemoryRouter>
    </TestI18nProvider>,
  );
}
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { width: 800, height: 400 },
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(232);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(104);
  SVGElement.prototype.getBBox = () =>
    ({ x: 0, y: 0, width: 80, height: 20 }) as DOMRect;
});
describe('process display components', () => {
  it.each(['en-US', 'zh-CN'])(
    'renders translated empty and invalid graph states: %s',
    async (locale) => {
      const error = vi.fn();
      const view = await mount(
        <FlowDiagram nodes={[]} edges={[]} ariaLabel='Synthetic diagram' />,
        locale,
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        locale === 'en-US' ? 'No states to display.' : zhCN.flowDiagram.empty,
      );
      view.rerender(
        <TestI18nProvider
          runtime={await createTestI18nRuntime({
            application: {
              namespace: 'nocohr',
              resources: locale === 'zh-CN' ? zhCN : enUS,
            },
            locale,
          })}
        >
          <FlowDiagram
            nodes={[{ id: 'a', label: 'A' }]}
            edges={[{ id: 'bad', source: 'a', target: 'absent' }]}
            ariaLabel='Synthetic diagram'
            onLayoutError={error}
          />
        </TestI18nProvider>,
      );
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(
          locale === 'en-US'
            ? 'Unable to lay out this diagram.'
            : zhCN.flowDiagram.failed,
        ),
      );
      await waitFor(() => expect(error).toHaveBeenCalled());
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    },
  );
  it('selects a sorted history prefix without changing input or executing an effect', async () => {
    const input = [...presentationHistory].reverse();
    const original = [...input];
    const diagram = vi.fn(({ current, history }) => (
      <output>
        {current}:{history.length}
      </output>
    ));
    await mount(
      <WorkflowExecutionDetail
        transitions={input}
        state='review'
        effects={[
          {
            id: 'e',
            effect: 'Notify',
            status: 'failed',
            attempts: 1,
            maxAttempts: 3,
            error: 'Synthetic delivery error',
          },
        ]}
        parameters='Snapshot days: 2'
        labels={executionLabels}
        stateLabel={(s) => s}
        transitionLabel={(s) => s}
        dateLabel={(s) => s}
        effectStatusLabel={(s) => s}
        renderDiagram={diagram}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('review:3');
    fireEvent.click(screen.getByRole('button', { name: 'Show step 2' }));
    expect(screen.getByRole('status')).toHaveTextContent('draft:2');
    expect(screen.getByRole('button', { name: 'Show step 2' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      diagram.mock.lastCall?.[0].history.map((e: { id: string }) => e.id),
    ).toEqual(['step-1', 'step-2']);
    expect(input).toEqual(original);
    expect(screen.getByText('Synthetic delivery error')).toBeVisible();
    expect(screen.getByText('Snapshot days: 2')).toBeVisible();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
  it('shows empty history and effects without manufacturing facts', async () => {
    await mount(
      <WorkflowExecutionDetail
        transitions={[]}
        state='draft'
        effects={[]}
        labels={executionLabels}
        stateLabel={(s) => s}
        transitionLabel={(s) => s}
        dateLabel={(s) => s}
        effectStatusLabel={(s) => s}
        renderDiagram={({ current, history }) => (
          <output>
            {current}:{history.length}
          </output>
        )}
      />,
    );
    expect(screen.getByText('No history')).toBeVisible();
    expect(screen.getByText('No effects')).toBeVisible();
  });
  it('keeps route/tab ownership in its caller and hides list chrome in detail mode', async () => {
    const tab = vi.fn();
    const view = await mount(
      <WorkflowManagementLayout
        title='Synthetic workflow host'
        labels={{ definitions: 'Definitions', executions: 'Executions' }}
        tab='definitions'
        onTabChange={tab}
      >
        <p>Fixture content</p>
      </WorkflowManagementLayout>,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Executions' }));
    expect(tab).toHaveBeenCalledWith('executions');
    view.rerender(
      <WorkflowManagementLayout
        title='Hidden title'
        labels={{ definitions: 'Definitions', executions: 'Executions' }}
        tab='definitions'
        onTabChange={tab}
        detail
      >
        <p>Detail content</p>
      </WorkflowManagementLayout>,
    );
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('Hidden title')).toBeNull();
    expect(screen.getByText('Detail content')).toBeVisible();
  });
  it('renders caller-owned definition parameter content without adding controls', async () => {
    await mount(
      <WorkflowDefinitionDetail
        diagram={<p>Diagram slot</p>}
        diagramTitle='Process diagram'
        parametersTitle='Parameters'
        parameters={<p>Read-only authorized parameters</p>}
      />,
    );
    expect(screen.getByText('Read-only authorized parameters')).toBeVisible();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });
  it('retains empty/error list content and disables pending refresh and pagination', async () => {
    const refresh = vi.fn(),
      sort = vi.fn(),
      previous = vi.fn(),
      next = vi.fn();
    await mount(
      <WorkflowExecutionList
        rows={[]}
        loaded
        loading
        filters={<p>Caller filters</p>}
        status={<p role='alert'>Synthetic read failure</p>}
        empty='No synthetic executions'
        labels={{
          refresh: 'Refresh',
          record: 'Record',
          workflow: 'Workflow',
          state: 'State',
          createdAt: 'Created',
          previous: 'Previous',
          next: 'Next',
        }}
        order='newest'
        onSort={sort}
        onRefresh={refresh}
        pagination='Page 1'
        previousDisabled
        nextDisabled
        onPrevious={previous}
        onNext={next}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Synthetic read failure',
    );
    for (const name of ['Refresh', 'Previous', 'Next'])
      expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(refresh).not.toHaveBeenCalled();
    expect(previous).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
  it('renders definition links and delegates activity sorting/refresh without requests', async () => {
    const refresh = vi.fn(),
      sort = vi.fn();
    await mount(
      <WorkflowDefinitionList
        rows={[
          {
            id: 'synthetic',
            title: <a href='#synthetic'>Synthetic review</a>,
            activity: '3 executions',
          },
        ]}
        loaded
        loading={false}
        search={<input aria-label='Search definitions' />}
        empty='No definitions'
        labels={{
          refresh: 'Refresh',
          workflow: 'Workflow',
          executionCount: 'Executions',
          executionActivity: 'Activity',
        }}
        sort={{ ascending: false }}
        onSort={sort}
        onRefresh={refresh}
      />,
    );
    expect(
      screen.getByRole('link', { name: 'Synthetic review' }),
    ).toHaveAttribute('href', '#synthetic');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refresh).toHaveBeenCalledOnce();
    const table = screen.getByRole('table');
    const buttons = within(table).getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(sort).toHaveBeenCalledOnce();
  });
  it('renders a real lifecycle canvas and authorized contextual configuration', async () => {
    const configure = vi.fn();
    await mount(
      <LifecycleDiagram
        description={presentationDescription}
        currentState='review'
        ariaLabel='Synthetic review diagram'
        configuration={{
          label: () => 'Configure rules',
          canConfigure: (_group, key) => key === 'days',
          onConfigure: configure,
        }}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Configure rules' }),
      ).toBeVisible(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configure rules' }));
    expect(configure.mock.lastCall?.[0]).toMatchObject({
      target: { kind: 'state', name: 'review' },
    });
    expect(configure.mock.lastCall?.[0].groups[0].fields).not.toHaveProperty(
      'privateRule',
    );
  });
});
