import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../client/locales/en-US';

// The personnel action form pre-filled from a link: V3-10 任职资格材料 opens a
// promotion with its target (?type=promote&employeeId=…&toPositionId=…).
const state = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request: state.request }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({
    can: true,
    isPending: false,
    error: undefined,
    retry: () => undefined,
  }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useLocale: () => ({ locale: 'en-US' }),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, args: Record<string, unknown> = {}) => {
      let result: unknown = en;
      for (const segment of key.split('.'))
        result =
          result && typeof result === 'object'
            ? (result as Record<string, unknown>)[segment]
            : undefined;
      if (typeof result !== 'string') return key;
      for (const [name, value] of Object.entries(args))
        result = (result as string).replaceAll(`{{${name}}}`, String(value));
      return result;
    },
  }),
}));
vi.mock('../../client/components/ui/toast', () => ({
  toast: { add: state.toast },
}));
vi.mock('../../client/components/talent/use-lookups', () => ({
  useLookups: () => ({
    departments: [
      {
        id: 'nj-mc',
        title: 'Machining',
        label: 'Machining',
        parentId: null,
        active: true,
        depth: 0,
      },
    ],
    positions: [
      {
        id: 'pos-cnc',
        code: 'cnc',
        title: 'CNC operator',
        active: true,
        jobFamilyId: 'jf',
      },
      {
        id: 'pos-cnc-lead',
        code: 'cnc-lead',
        title: 'CNC team lead',
        active: true,
        jobFamilyId: 'jf',
      },
    ],
    departmentTitle: (id: string) => id,
    positionTitle: (id: string) => id,
    loading: false,
    reload: () => undefined,
  }),
}));

import NewActionPage from '../../client/pages/talent/actions/new';

function Where() {
  const location = useLocation();
  return <p aria-label='location'>{location.search}</p>;
}

beforeEach(() => {
  state.request.mockReset();
  state.request.mockImplementation((options: { path: string }) => {
    if (options.path === 'talent/employees')
      return Promise.resolve({
        data: {
          items: [
            {
              id: 'emp-limin',
              name: 'Li Min',
              employeeNo: 'QH1001',
              departmentId: 'nj-mc',
              positionId: 'pos-cnc',
              status: 'active',
            },
          ],
        },
      });
    if (options.path === 'talent/framework')
      return Promise.resolve({ data: { requirements: [], competencies: [] } });
    if (options.path === 'talent/custom-fields/definitions')
      return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
});

describe('personnel action form links', () => {
  it('pre-fills a promotion with its target position and department, then drops them from the URL', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/talent/actions/new?type=promote&employeeId=emp-limin&toPositionId=pos-cnc-lead&toDepartmentId=nj-mc',
        ]}
      >
        <Where />
        <Routes>
          <Route
            path='/talent/actions'
            element={<Outlet context={{ reload: () => undefined }} />}
          >
            <Route path='new' element={<NewActionPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(
        (screen.getByLabelText(en.talent.actions.employee) as HTMLSelectElement)
          .value,
      ).toBe('emp-limin'),
    );
    expect(
      (screen.getByLabelText(en.talent.actions.type) as HTMLSelectElement)
        .value,
    ).toBe('promote');
    expect(
      (
        screen.getByLabelText(
          en.talent.actions.targetPosition,
        ) as HTMLSelectElement
      ).value,
    ).toBe('pos-cnc-lead');
    expect(screen.getByLabelText('location')).not.toHaveTextContent(
      'toPositionId',
    );
  });
});
