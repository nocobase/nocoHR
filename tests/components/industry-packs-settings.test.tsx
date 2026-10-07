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
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
  useLocale: () => ({ locale: 'zh-CN' }),
}));
vi.mock('../../client/components/ui/toast', () => ({ toast: { add: added } }));

import {
  IndustryPackList,
  type IndustryPacksData,
} from '../../client/pages/settings/licensed/industry-packs';

const pack = (enabled: boolean): IndustryPacksData => ({
  packs: [
    {
      key: 'manufacturing',
      title: '制造业',
      description: '设备开工登记、叉车出库登记',
      enabled,
      changedAt: null,
      operations: [
        {
          kind: 'machineStart',
          page: 'demo.batchRecord',
          path: '/demo/batch-record',
          title: '设备开工登记',
          permissionSet: 'prod.cncOperator',
          permissionSetExists: true,
          certifications: [{ id: 'cert-cnc', title: 'CNC 岗位上岗证' }],
        },
        {
          kind: 'forkliftDispatch',
          page: 'demo.forkliftDispatch',
          path: '/demo/forklift-dispatch',
          title: '叉车出库登记',
          permissionSet: 'equip.forkliftOperator',
          permissionSetExists: false,
          certifications: [],
        },
      ],
    },
  ],
});

function renderList(data: IndustryPacksData, onChanged = vi.fn()) {
  render(
    <MemoryRouter>
      <IndustryPackList data={data} onChanged={onChanged} />
    </MemoryRouter>,
  );
  return onChanged;
}

describe('IndustryPackList', () => {
  beforeEach(() => {
    request.mockReset();
    added.mockReset();
  });

  it('lists each pack with its operations and who grants them', () => {
    renderList(pack(true));
    expect(screen.getByText('制造业')).toBeTruthy();
    expect(screen.getByText('设备开工登记')).toBeTruthy();
    expect(screen.getByText(/CNC 岗位上岗证/u)).toBeTruthy();
    expect(
      screen.getByText('licensed.industryPacks.setCreatedOnEnable'),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('switch', { name: '制造业' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('asks before turning a pack off, and saves only on confirmation', async () => {
    request.mockResolvedValue({ data: pack(false) });
    const onChanged = renderList(pack(true));
    fireEvent.click(screen.getByRole('switch', { name: '制造业' }));
    expect(request).not.toHaveBeenCalled();
    expect(
      await screen.findByText('licensed.industryPacks.confirmDescription'),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'licensed.industryPacks.confirmDisable',
      }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'talent/licensed/industry-packs/manufacturing',
        method: 'PUT',
        json: { enabled: false },
      }),
    );
  });

  it('turns a pack on without asking', async () => {
    request.mockResolvedValue({ data: pack(true) });
    const onChanged = renderList(pack(false));
    fireEvent.click(screen.getByRole('switch', { name: '制造业' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ json: { enabled: true } }),
    );
    expect(
      screen.queryByText('licensed.industryPacks.confirmDescription'),
    ).toBeNull();
  });
});
