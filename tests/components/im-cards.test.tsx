import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request, added, remote } = vi.hoisted(() => ({
  request: vi.fn(),
  added: vi.fn(),
  remote: new Map<string, unknown>(),
}));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request }),
}));
// Real Chinese wording, so the tests read what a user reads.
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
    const text = typeof value === 'string' ? value : key;
    return text.replace(/\{\{(\w+)\}\}/gu, (_, name: string) =>
      String(options[name] ?? ''),
    );
  };
  return {
    useTranslation: () => ({ t }),
    useLocale: () => ({ locale: 'zh-CN' }),
  };
});
vi.mock('../../client/components/ui/toast', () => ({ toast: { add: added } }));
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: (path: string | null) => ({
    data: path ? remote.get(path) : undefined,
    error: undefined,
    loading: false,
    reload: () => undefined,
  }),
}));

import { MockCard, MockInbox } from '../../client/pages/dev/im-mock-inbox';
import { NotificationSettingsCard } from '../../client/pages/talent/me/notifications/section';
import {
  arrange,
  SERVICES,
} from '../../client/pages/talent/self-service/services';

const APPROVAL = {
  title: '调岗审批',
  lines: ['李敏 · 调岗 · 机加工车间 → 装配车间', '生效日期 2026-10-01'],
  buttons: [
    { key: 'approve', label: '同意', style: 'primary' as const },
    {
      key: 'reject',
      label: '驳回',
      style: 'danger' as const,
      comment: 'required' as const,
    },
  ],
  link: { label: '在 NocoHR 中查看', path: '/talent/actions/a1' },
  state: 'open' as const,
};

beforeEach(() => {
  request.mockReset();
  added.mockReset();
  remote.clear();
});

describe('模拟渠道 cards', () => {
  it('presses 同意 as the member and shows the card as handled', async () => {
    request.mockResolvedValue({
      data: {
        ok: true,
        message: '已同意，单据已流转到下一步。',
        card: {
          ...APPROVAL,
          buttons: [],
          state: 'handled',
          stateText: '已处理 · 已同意 · 已生效',
        },
      },
    });
    const changed = vi.fn();
    render(
      <MemoryRouter>
        <MockCard
          cardId='c1'
          senderId='fs-u-mgr-east'
          view={APPROVAL}
          onChanged={changed}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByText('李敏 · 调岗 · 机加工车间 → 装配车间'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '同意' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        path: 'talent/ai-entry/dev/im-mock/card',
        method: 'POST',
        json: {
          senderId: 'fs-u-mgr-east',
          cardId: 'c1',
          button: 'approve',
          comment: null,
        },
      }),
    );
    expect(
      await screen.findByText('已处理 · 已同意 · 已生效'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '同意' })).toBeNull();
    expect(changed).toHaveBeenCalled();
    expect(added).toHaveBeenCalledWith({
      type: 'success',
      title: '已同意，单据已流转到下一步。',
    });
  });

  it('asks for a comment before sending 驳回', async () => {
    request.mockResolvedValue({
      data: { ok: true, message: '已驳回', card: null },
    });
    render(
      <MemoryRouter>
        <MockCard
          cardId='c1'
          senderId='fs-u-mgr-east'
          view={APPROVAL}
          onChanged={() => undefined}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '驳回' }));
    expect(request).not.toHaveBeenCalled();
    const reject = screen.getByRole('button', { name: '驳回' });
    expect(reject).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/意见/u), {
      target: { value: '装配车间暂不缺人' },
    });
    fireEvent.click(reject);
    await waitFor(() =>
      expect(request.mock.calls[0]?.[0].json).toMatchObject({
        button: 'reject',
        comment: '装配车间暂不缺人',
      }),
    );
  });

  it('shows a refusal without closing the card', async () => {
    request.mockResolvedValue({
      data: {
        ok: false,
        message: '你不是这张单据的当前审批人，无权审批。',
        card: APPROVAL,
      },
    });
    render(
      <MemoryRouter>
        <MockCard
          cardId='c1'
          senderId='fs-u-mgr-njl'
          view={APPROVAL}
          onChanged={() => undefined}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '同意' }));
    await waitFor(() =>
      expect(added).toHaveBeenCalledWith({
        type: 'info',
        title: '你不是这张单据的当前审批人，无权审批。',
      }),
    );
    expect(screen.getByRole('button', { name: '同意' })).toBeEnabled();
  });

  it('lists cards and pushed messages in the inbox', () => {
    remote.set('talent/ai-entry/dev/im-mock/outbox', {
      messages: [{ id: 'm1', text: '知识缺口周报\n/talent/knowledge', at: '' }],
      cards: [
        {
          id: 'c1',
          kind: 'personnelActionApproval',
          createdAt: '',
          view: APPROVAL,
        },
      ],
    });
    render(
      <MemoryRouter>
        <MockInbox senderId='fs-u-mgr-east' revision={0} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('group', { name: '调岗审批' })).toBeInTheDocument();
    expect(screen.getByText(/知识缺口周报/u)).toBeInTheDocument();
    expect(screen.getByText('在 NocoHR 中查看').closest('a')).toHaveAttribute(
      'href',
      '/talent/actions/a1',
    );
  });
});

describe('通知设置', () => {
  it('keeps the inbox on and switches Feishu off', async () => {
    remote.set('talent/notification-channels', {
      inbox: true,
      channels: [{ provider: 'feishu', bound: true, enabled: true }],
    });
    request.mockResolvedValue({
      data: {
        inbox: true,
        channels: [{ provider: 'feishu', bound: true, enabled: false }],
      },
    });
    render(<NotificationSettingsCard />);
    expect(screen.getByText('始终开启')).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: '推送到飞书' });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith({
        path: 'talent/notification-channels',
        method: 'PUT',
        json: { channels: { feishu: false } },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('switch', { name: '推送到飞书' }),
      ).not.toBeChecked(),
    );
  });

  it('lists no switch for a channel the user is not bound to', () => {
    remote.set('talent/notification-channels', {
      inbox: true,
      channels: [{ provider: 'feishu', bound: false, enabled: true }],
    });
    render(<NotificationSettingsCard />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(
      screen.getByText('你的账号还没有绑定办公软件。'),
    ).toBeInTheDocument();
  });
});

describe('自助 card order', () => {
  it('applies the configured order, hides hidden cards and appends new ones', () => {
    const keys = arrange(SERVICES, {
      cards: [
        { key: 'orgChart', visible: true },
        { key: 'contracts', visible: false },
        { key: 'gone', visible: true },
      ],
    }).map((s) => s.key);
    expect(keys[0]).toBe('orgChart');
    expect(keys).not.toContain('contracts');
    expect(keys).toContain('profileChange');
    expect(keys).toHaveLength(SERVICES.length - 1);
  });
});
