import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import {
  ClientApplicationContext,
  apiClientToken,
  realtimeClientToken,
  type ClientApplication,
} from '@nocobase/app-client';
import { ChatProvider } from '@nocobase/app-plugin-agents/client/chat';
import { ServiceContainer } from '@nocobase/service-provider';
import { createRealtimeFixture } from '../fixtures/realtime-client';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request, added, remote, grants } = vi.hoisted(() => ({
  request: vi.fn(),
  added: vi.fn(),
  remote: new Map<string, unknown>(),
  grants: new Set<string>(),
}));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request }),
}));
// Real Chinese wording, so the tests read what an employee reads.
vi.mock('@nocobase/i18n/client', async () => {
  const zh = (await import('../../client/locales/zh-CN')).default as Record<
    string,
    unknown
  >;
  const t = (key: string, options: Record<string, unknown> = {}) => {
    const value = key
      .split('.')
      .reduce<unknown>(
        (node, part) =>
          node && typeof node === 'object'
            ? (node as Record<string, unknown>)[part]
            : undefined,
        zh,
      );
    const text =
      typeof value === 'string'
        ? value
        : typeof options.defaultValue === 'string'
          ? options.defaultValue
          : key;
    return text.replace(/\{\{(\w+)\}\}/gu, (_, name: string) =>
      String(options[name] ?? ''),
    );
  };
  return {
    useTranslation: () => ({ t }),
    useLocale: () => ({ locale: 'zh-CN' }),
  };
});
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: (check?: { resource: { id: string }; action: string }) => ({
    can: check ? grants.has(`${check.resource.id}:${check.action}`) : false,
    isPending: false,
    error: undefined,
    retry: () => undefined,
  }),
}));
vi.mock('../../client/components/ui/toast', () => ({ toast: { add: added } }));
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: (path: string | null) => ({
    data: path ? remote.get(path) : undefined,
    error: undefined,
    loading: false,
    reload: () => undefined,
  }),
}));
import { UnifiedAssistant } from '../../client/components/talent/unified-assistant';
import AiEntrySettingsPage from '../../client/pages/settings/ai-entry/index';
import { ConflictsPanel } from '../../client/pages/talent/knowledge/conflicts-panel';
import SelfServicePage from '../../client/pages/talent/self-service/index';

const CONFLICT = {
  id: 'c1',
  documentId: 'd1',
  documentTitle: '考勤与加班管理制度 V3.2',
  sectionTitle: '夜班津贴',
  otherDocumentId: 'd2',
  otherDocumentTitle: '机加工车间排班须知 V1.0',
  otherSectionTitle: '津贴',
  description: '夜班津贴金额不一致',
  excerpt: '夜班津贴每班 50 元',
  otherExcerpt: '夜班津贴每班 40 元',
  status: 'open',
  handledByName: null,
  createdAt: '2026-09-28T01:00:00.000Z',
  can: { resolve: true, ignore: true },
};

beforeEach(() => {
  request.mockReset();
  added.mockReset();
  remote.clear();
  grants.clear();
});

describe('document conflicts', () => {
  it('requires a note before ignoring a conflict', async () => {
    remote.set('talent/kb/conflicts', [CONFLICT]);
    request.mockResolvedValue({ data: { ...CONFLICT, status: 'ignored' } });
    render(
      <MemoryRouter>
        <ConflictsPanel />
      </MemoryRouter>,
    );
    expect(screen.getByText('夜班津贴每班 50 元')).toBeInTheDocument();
    expect(screen.getByText('夜班津贴每班 40 元')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '忽略' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '忽略' }));
    expect(await within(dialog).findByText('请填写忽略的原因。')).toBeVisible();
    expect(request).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/说明/u), {
      target: { value: '两份文件适用不同车间' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '忽略' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        path: 'talent/kb/conflicts/c1/ignore',
        method: 'POST',
        json: { note: '两份文件适用不同车间' },
      }),
    );
    await waitFor(() =>
      expect(added).toHaveBeenCalledWith(
        expect.objectContaining({ title: '已忽略冲突' }),
      ),
    );
  });
});

describe('unified native AI entry', () => {
  it('uses the native model and history services without the retired hand-off protocol', async () => {
    request.mockResolvedValue({ data: [], meta: {} });
    const services = new ServiceContainer();
    services.instance(apiClientToken, { request } as never);
    services.instance(realtimeClientToken, createRealtimeFixture() as never);
    render(
      <ClientApplicationContext.Provider
        value={{ services } as unknown as ClientApplication}
      >
        <MemoryRouter>
          <ChatProvider>
            <UnifiedAssistant layout='page' />
          </ChatProvider>
        </MemoryRouter>
      </ClientApplicationContext.Provider>,
    );
    expect(await screen.findByText('尚未配置 AI 模型')).toBeVisible();
    fireEvent.click(screen.getByTestId('chat-history-button'));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'agents/conversations' }),
      ),
    );
    expect(screen.getByTestId('chat-history-button')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      request.mock.calls.every(
        ([input]) => !String(input.path).startsWith('talent/ai-entry/'),
      ),
    ).toBe(true);
  });
});

describe('self-service', () => {
  it('shows only the cards whose target the user may open', () => {
    grants.add('talent.me:access');
    grants.add('talent.profileChange:request');
    render(
      <MemoryRouter>
        <SelfServicePage />
      </MemoryRouter>,
    );
    expect(screen.getByText('申请修改信息')).toBeInTheDocument();
    expect(screen.getByText('我的合同')).toBeInTheDocument();
    expect(screen.getByText('我的异动记录')).toBeInTheDocument();
    // No org chart page, no HR assistant and no leave request grant.
    expect(screen.queryByText('组织架构')).not.toBeInTheDocument();
    expect(screen.queryByText('问人事助理')).not.toBeInTheDocument();
    expect(screen.queryByText('请假')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /申请修改信息/u })).toHaveAttribute(
      'href',
      '/talent/me?change=1',
    );
  });
});

describe('AI entry settings', () => {
  it('saves the whole value at the loaded revision', async () => {
    const value = {
      routes: [
        {
          key: 'policy',
          description: '制度、规定',
          employee: 'knowledgeAssistant',
          permissionSets: [],
          enabled: true,
          keywords: ['制度'],
        },
        {
          key: 'hrData',
          description: '导入体检',
          employee: 'hrAssistant',
          permissionSets: ['hr.admin'],
          enabled: true,
          keywords: [],
        },
      ],
      knowledgeScopes: {},
    };
    remote.set('talent/ai-entry', {
      value,
      revision: 3,
      employees: ['knowledgeAssistant', 'hrAssistant'],
      permissionSets: ['hr.admin', 'hr.employee'],
    });
    request.mockResolvedValue({ data: { value, revision: 4 } });
    render(
      <MemoryRouter>
        <AiEntrySettingsPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('switch', { name: '启用“导入体检”' }));
    const card = screen.getByText('路由表').closest('[data-slot="card"]');
    fireEvent.click(
      within(card as HTMLElement).getByRole('button', { name: '保存' }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        path: 'talent/ai-entry',
        method: 'PATCH',
        json: {
          revision: 3,
          value: {
            routes: [value.routes[0], { ...value.routes[1], enabled: false }],
            knowledgeScopes: {},
          },
        },
      }),
    );
  });
});
