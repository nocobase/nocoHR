import { ApiClientError } from '@nocobase/app-client';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const { remote } = vi.hoisted(() => ({
  remote: { current: {} as Record<string, unknown> },
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key} ${JSON.stringify(params)}` : key,
  }),
}));
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: () => ({
    loading: false,
    reload: () => undefined,
    ...remote.current,
  }),
}));

import { JobEventLearningBlock } from '../../client/components/talent/job-event-learning';

function mount() {
  return render(
    <MemoryRouter>
      <JobEventLearningBlock eventId='e1' />
    </MemoryRouter>,
  );
}

describe('学习处理 on a job event', () => {
  it('lists the assigned path, the steps counted as completed and the cancelled tasks', () => {
    remote.current = {
      data: {
        eventId: 'e1',
        eventType: 'transfer',
        processed: true,
        assignedPath: {
          assignmentId: 'a1',
          title: '装配工上岗路径',
          dueDate: '2026-10-09',
          completedSteps: ['质量记录填写规范'],
          attachedSteps: [],
        },
        cancelled: [
          {
            assignmentId: 'a0',
            title: 'CNC 操作工上岗路径',
            kind: 'learningPath',
            status: 'cancelled',
            cancelReason: 'jobChange',
          },
        ],
        plans: [],
      },
    };
    mount();
    expect(screen.getByText('装配工上岗路径')).toBeInTheDocument();
    expect(
      screen.getByText(/jobEventLearning.completedSteps .*质量记录填写规范/u),
    ).toBeInTheDocument();
    expect(screen.getByText('CNC 操作工上岗路径')).toBeInTheDocument();
    expect(
      screen.getByText('jobEventLearning.reason.jobChange'),
    ).toBeInTheDocument();
  });

  it('says so when the event changed nothing, and waits for an unprocessed one', () => {
    remote.current = {
      data: {
        eventId: 'e1',
        eventType: 'promote',
        processed: true,
        assignedPath: null,
        cancelled: [],
        plans: [],
      },
    };
    const { unmount } = mount();
    expect(screen.getByText('jobEventLearning.none')).toBeInTheDocument();
    unmount();
    remote.current = {
      data: {
        eventId: 'e1',
        eventType: 'promote',
        processed: false,
        assignedPath: null,
        cancelled: [],
        plans: [],
      },
    };
    mount();
    expect(screen.getByText('jobEventLearning.pending')).toBeInTheDocument();
  });

  it('shows nothing to a viewer without access', () => {
    remote.current = {
      error: new ApiClientError('forbidden', {
        status: 403,
        code: 'FORBIDDEN',
        payload: { code: 'FORBIDDEN' },
        method: 'GET',
        url: '/api/talent/learning-job-events/e1',
      }),
    };
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
  });
});
