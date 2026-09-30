import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request, added } = vi.hoisted(() => ({
  request: vi.fn(),
  added: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN' },
  }),
}));
vi.mock('../../client/components/ui/toast', () => ({ toast: { add: added } }));

import {
  ChecklistItems,
  type Checklist,
} from '../../client/components/talent/change-checklist';
import type { CustomFieldDefinition } from '../../client/components/talent/custom-field-model';
import { CustomFieldInputs } from '../../client/components/talent/custom-fields';
import { FieldDialog } from '../../client/pages/settings/custom-fields/field-dialog';

const SIZE: CustomFieldDefinition = {
  id: 'f1',
  collection: 'employees',
  key: 'cf_size',
  label: { 'zh-CN': '工服尺码', 'en-US': null },
  type: 'select',
  options: [
    { value: 'm', label: 'M', active: true },
    { value: 'l', label: 'L', active: true },
  ],
  required: true,
  defaultValue: null,
  placements: ['onboardForm'],
  sensitive: false,
  aiReadable: false,
  sortOrder: 0,
  active: true,
};

beforeEach(() => {
  request.mockReset();
  added.mockReset();
});

describe('CustomFieldInputs', () => {
  it('renders a required choice, reports the new value and shows the server error', () => {
    const onChange = vi.fn();
    render(
      <CustomFieldInputs
        definitions={[SIZE]}
        values={{}}
        onChange={onChange}
        errors={{ cf_size: 'CUSTOM_FIELD_REQUIRED' }}
        idPrefix='t'
      />,
    );
    const select = screen.getByLabelText('工服尺码 *');
    fireEvent.change(select, { target: { value: 'l' } });
    expect(onChange).toHaveBeenCalledWith({ cf_size: 'l' });
    expect(
      screen.getByText('talent.errors.CUSTOM_FIELD_REQUIRED'),
    ).toBeTruthy();
  });

  it('leaves out inactive fields', () => {
    const { container } = render(
      <CustomFieldInputs
        definitions={[{ ...SIZE, active: false }]}
        values={{}}
        onChange={() => undefined}
        idPrefix='t'
      />,
    );
    expect(container.textContent).toBe('');
  });
});

const CHECKLIST: Checklist = {
  id: 'c1',
  employeeId: 'emp-wanglei',
  employeeName: '王磊',
  kind: 'change',
  actionId: 'a1',
  stage: 'open',
  aiSummary: null,
  ownerUserId: 'u1',
  dueDate: null,
  items: [
    {
      key: 'manager',
      provider: 'manager',
      code: 'managerChange',
      params: { current: '陈静', suggested: '周宏' },
      status: 'todo',
      link: '/talent/employees/emp-wanglei',
      action: { type: 'adoptManager', employeeId: 'emp-mgr-east' },
      note: null,
      aiNote: '先改直属上级',
      handledBy: null,
      handledAt: null,
    },
    {
      key: 'contract',
      provider: 'contract',
      code: 'contractAmend',
      params: {},
      status: 'todo',
      link: null,
      action: null,
      note: null,
      aiNote: null,
      handledBy: null,
      handledAt: null,
    },
  ],
};

describe('ChecklistItems', () => {
  it('adopts the suggested manager in one click', async () => {
    const onChanged = vi.fn();
    request.mockResolvedValue({ data: { ...CHECKLIST, stage: 'open' } });
    render(
      <MemoryRouter>
        <ChecklistItems checklist={CHECKLIST} onChanged={onChanged} />
      </MemoryRouter>,
    );
    expect(screen.getByText('先改直属上级')).toBeTruthy();
    fireEvent.click(screen.getByText('checklists.adoptManager'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'talent/checklists/c1/items/manager/perform',
        method: 'POST',
      }),
    );
  });

  it('asks why before marking an item not needed', async () => {
    request.mockResolvedValue({ data: CHECKLIST });
    render(
      <MemoryRouter>
        <ChecklistItems checklist={CHECKLIST} onChanged={() => undefined} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getAllByText('checklists.markNotNeeded')[1]!);
    const save = await screen.findByText('actions.save');
    expect((save.closest('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('checklists.notNeededReason *'), {
      target: { value: '岗位地点未变' },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/checklists/c1/items/contract',
          json: { status: 'notNeeded', note: '岗位地点未变' },
        }),
      ),
    );
  });

  it('shows a preview without any actions', () => {
    render(
      <MemoryRouter>
        <ChecklistItems
          checklist={{ ...CHECKLIST, stage: 'preview' }}
          onChanged={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText('checklists.adoptManager')).toBeNull();
    expect(screen.queryByText('checklists.markDone')).toBeNull();
  });
});

describe('FieldDialog', () => {
  it('requires a name, then creates the field with its placements', async () => {
    const onSaved = vi.fn();
    request.mockResolvedValue({ data: {} });
    render(
      <FieldDialog
        collection='employees'
        definition={null}
        onClose={() => undefined}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByText('actions.save'));
    expect(await screen.findByText('customFields.labelRequired')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('customFields.label *'), {
      target: { value: '宿舍号' },
    });
    fireEvent.click(screen.getByText('actions.save'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'talent/custom-fields',
        method: 'POST',
        json: expect.objectContaining({
          collection: 'employees',
          type: 'text',
          label: { 'zh-CN': '宿舍号', 'en-US': null },
          placements: ['detail', 'list'],
        }),
      }),
    );
  });
});
