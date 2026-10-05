import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

// 工作台 · AI 员工已办完: counts, one row per task with its AI employee and latest line, links, and the first six
// kinds of work until "show all".
const { remote } = vi.hoisted(() => ({
  remote: { value: undefined as unknown },
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && 'count' in values ? `${key}:${String(values.count)}` : key,
  }),
  useLocale: () => ({ locale: 'zh-CN' }),
}));
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: (path: string | null) => ({
    data: path === 'talent/work-items/ai-done' ? remote.value : undefined,
    loading: false,
    reload: () => undefined,
  }),
}));

import { AiDonePanel } from '../../client/pages/talent/workbench/ai-done';

const group = (task: string, text: string | null, link: string | null) => ({
  task,
  employee: task.split('.')[0],
  today: 1,
  week: 2,
  latestAt: '2026-10-05T01:00:00.000Z',
  entries: [{ at: '2026-10-05T01:00:00.000Z', text, link }],
});

describe('AI 员工已办完', () => {
  it('lists each kind of work with its employee, latest line and link', () => {
    remote.value = {
      timeZone: 'Asia/Shanghai',
      today: 1,
      week: 2,
      groups: [
        group(
          'hrAssistant.renewalPrep',
          '为 2 份即将到期的合同准备了续签材料',
          '/talent/contracts',
        ),
      ],
    };
    render(
      <MemoryRouter>
        <AiDonePanel />
      </MemoryRouter>,
    );
    expect(screen.getByText('workbench.aiDone.title')).toBeVisible();
    expect(
      screen.getByText('aiAutomations.employees.hrAssistant'),
    ).toBeVisible();
    expect(
      screen.getByText('aiAutomations.tasks.hrAssistant.renewalPrep.title', {
        exact: false,
      }),
    ).toBeVisible();
    expect(
      screen.getByText('为 2 份即将到期的合同准备了续签材料'),
    ).toBeVisible();
    expect(
      screen.getByText('workbench.aiDone.view').closest('a'),
    ).toHaveAttribute('href', '/talent/contracts');
  });

  it('shows the first six kinds of work until "show all", and an empty week plainly', () => {
    remote.value = {
      timeZone: 'Asia/Shanghai',
      today: 8,
      week: 16,
      groups: Array.from({ length: 8 }, (_, i) =>
        group(`hrAssistant.task${i}`, `第 ${i} 项`, null),
      ),
    };
    const { rerender } = render(
      <MemoryRouter>
        <AiDonePanel />
      </MemoryRouter>,
    );
    expect(screen.getByText('第 5 项')).toBeVisible();
    expect(screen.queryByText('第 6 项')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'workbench.aiDone.showAll:8' }),
    );
    expect(screen.getByText('第 7 项')).toBeVisible();
    remote.value = { timeZone: 'Asia/Shanghai', today: 0, week: 0, groups: [] };
    rerender(
      <MemoryRouter>
        <AiDonePanel />
      </MemoryRouter>,
    );
    expect(screen.getByText('workbench.aiDone.empty')).toBeVisible();
  });
});
