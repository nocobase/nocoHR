import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../client/locales/en-US';

// V1-03 realigned UI: 手工指定 (the choice offered and what is sent), 开通账号, and the
// work context 问人事助理 carries for the current tab and item.
const state = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request: state.request }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useLocale: () => ({ locale: 'en-US' }),
  useTranslation: () => ({ t: translate }),
}));
vi.mock('../../client/components/ui/toast', () => ({
  toast: { add: state.toast },
}));

function translate(key: string, args: Record<string, unknown> = {}): string {
  let result: unknown = en;
  for (const segment of key.split('.'))
    result =
      result && typeof result === 'object'
        ? (result as Record<string, unknown>)[segment]
        : undefined;
  if (typeof result !== 'string') return key;
  for (const [name, value] of Object.entries(args))
    result = (result as string).replaceAll(`{{${name}}}`, String(value));
  return result as string;
}

const { AccountDialog, AssignDialog } =
  await import('../../client/pages/settings/org-sync/resolve-dialogs');
const { choiceOf, workContextOf } =
  await import('../../client/pages/settings/org-sync/helpers');

const lookups = {
  departments: [
    { id: 'sz', title: 'Suzhou', label: 'Suzhou', parentId: null, depth: 0 },
    { id: 'sz-mc', title: 'M', label: 'Machining', parentId: 'sz', depth: 1 },
  ] as never,
  departmentTitle: (id: string | null | undefined) =>
    ({ sz: 'Suzhou', 'sz-mc': 'Machining' })[id ?? ''] ?? String(id),
};

const duplicate = {
  key: 'duplicateMatch:a+b:1',
  type: 'duplicateMatch' as const,
  externalId: 'a+b',
  detail: { employee: { id: 'emp-guofan', name: '郭凡' }, members: ['a', 'b'] },
  status: 'open' as const,
};

describe('手工指定', () => {
  beforeEach(() => {
    state.request.mockReset();
    state.toast.mockReset();
    state.request.mockResolvedValue({ data: {} });
  });

  it('offers the candidates of each kind of item', () => {
    expect(
      choiceOf(
        {
          ...duplicate,
          type: 'departmentAmbiguous',
          detail: { candidates: ['sz', 'sz-mc'] },
        },
        lookups,
        () => undefined,
      ),
    ).toEqual({
      field: 'departmentId',
      options: [
        { value: 'sz', label: 'Suzhou' },
        { value: 'sz-mc', label: 'Machining' },
      ],
    });
    expect(choiceOf(duplicate, lookups, () => undefined).field).toBe(
      'memberId',
    );
    expect(
      choiceOf(
        {
          ...duplicate,
          detail: {
            candidates: [{ id: 'e1', name: '王磊', employeeNo: 'QH2001' }],
          },
        },
        lookups,
        () => undefined,
      ).options,
    ).toEqual([{ value: 'e1', label: '王磊 · QH2001' }]);
  });

  it('requires a choice, then sends the key with the chosen member', async () => {
    const onAssigned = vi.fn();
    render(
      <AssignDialog
        issue={duplicate}
        subject='郭凡'
        lookups={lookups}
        employeeName={() => undefined}
        onClose={() => undefined}
        onAssigned={onAssigned}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Choose one.')).toBeTruthy();
    expect(state.request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Bind to/u), {
      target: { value: 'b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
    expect(state.request).toHaveBeenCalledWith({
      path: 'talent/org-sync/issues/assign',
      method: 'POST',
      json: { key: duplicate.key, memberId: 'b' },
    });
  });

  it('creates an account for a noAccount item with the email entered', async () => {
    const onCreated = vi.fn();
    render(
      <AccountDialog
        issue={{
          ...duplicate,
          type: 'noAccount',
          employeeId: 'emp-sunli',
          detail: { name: '孙丽' },
        }}
        subject='孙丽'
        provider='Feishu'
        onClose={() => undefined}
        onCreated={onCreated}
      />,
    );
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'sunli@qiheng.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create and link' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(state.request).toHaveBeenCalledWith({
      path: 'talent/org-sync/employees/emp-sunli/account',
      method: 'POST',
      json: { email: 'sunli@qiheng.test' },
    });
  });
});

describe('问人事助理', () => {
  it('carries the tab and the selected item as work context, without personal details', () => {
    const context = workContextOf(
      {
        tab: 'issues',
        issue: {
          ...duplicate,
          type: 'newMember',
          detail: { name: '冯涛', mobile: '139****0021' },
        },
      },
      translate,
    );
    expect(context.map((c) => c.type)).toEqual(['orgSyncTab', 'orgSyncIssue']);
    expect(context[0].title).toBe('Organization sync / Pending items');
    expect(context[1].title).toBe('New member');
    expect(JSON.stringify(context)).not.toContain('0021');
  });
});
