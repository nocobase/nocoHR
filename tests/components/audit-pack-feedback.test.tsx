import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';
import { coreHrAdditions } from '../../client/locales/modules/core-hr-additions';

const { request, added, state } = vi.hoisted(() => ({
  request: vi.fn(),
  added: vi.fn(),
  state: { locale: 'en' as 'en' | 'zh' },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    i18n: { language: state.locale === 'en' ? 'en-US' : 'zh-CN' },
    t: (key: string) =>
      key
        .split('.')
        .reduce<unknown>(
          (value, part) =>
            value && typeof value === 'object'
              ? (value as Record<string, unknown>)[part]
              : undefined,
          coreHrAdditions[state.locale].top,
        ) ?? key,
  }),
}));
vi.mock('../../client/components/ui/toast', () => ({ toast: { add: added } }));
vi.mock('../../client/components/talent/use-lookups', () => ({
  useLookups: () => ({
    departments: [],
    positions: [],
    departmentTitle: (id: string) => id,
    positionTitle: (id: string) => id,
  }),
}));
vi.mock('../../client/components/talent/mail-thread', () => ({
  MailThread: () => <div>Existing mail thread</div>,
}));
import { AuditRequestsTab } from '../../client/components/talent/audit-requests';
const audit = {
  id: 'completion',
  customerName: 'Synthetic auditor',
  requesterAddress: 'auditor@completion.test',
  scope: { departmentIds: [], positionIds: [], materials: ['certificates'] },
  excludedRequests: [],
  unmatchedNames: [],
  dueDate: '2026-12-20',
  status: 'confirmed',
  reviewStatus: 'confirmed',
  risks: [],
  packFileName: null,
  hasPack: false,
  share: null,
  downloads: [],
  createdAt: '2026-10-24T00:00:00Z',
  can: { confirm: true, share: true, revoke: false },
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it.each(['en', 'zh'] as const)(
  'reports only the saved pack in %s, without promising a reply draft',
  async (locale) => {
    state.locale = locale;
    request.mockImplementation(
      async ({ path, method }: { path: string; method?: string }) =>
        method === 'POST'
          ? { data: { ...audit, hasPack: true, status: 'packReady' } }
          : { data: path === 'talent/audit-requests' ? [audit] : audit },
    );
    render(
      <MemoryRouter initialEntries={['/?request=completion']}>
        <AuditRequestsTab />
      </MemoryRouter>,
    );
    await fireEvent.click(
      await screen.findByRole('button', {
        name: coreHrAdditions[locale].top.auditRequests.build,
      }),
    );
    await waitFor(() =>
      expect(added).toHaveBeenCalledExactlyOnceWith({
        type: 'success',
        title: locale === 'en' ? 'Audit pack built' : '审核包已生成',
      }),
    );
    expect(
      request.mock.calls.filter(([input]) => input.method === 'POST'),
    ).toEqual([
      [{ path: 'talent/audit-requests/completion/pack', method: 'POST' }],
    ]);
  },
);
