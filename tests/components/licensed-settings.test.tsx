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
  LicensedSettingsForm,
  type LicensedSettingsData,
} from '../../client/pages/settings/licensed/index';

const INITIAL: LicensedSettingsData = {
  value: {
    enabled: true,
    certificationOnlyPermissionSets: [
      'prod.cncOperator',
      'equip.forkliftOperator',
    ],
    scheduleCheckEnabled: true,
    transferCheckEnabled: true,
  },
  enabledRevision: 1,
  packRevision: 0,
  history: [],
  permissionSets: [
    {
      key: 'equip.forkliftOperator',
      title: '叉车出库登记',
      protectedByOther: false,
      otherAssignments: 0,
      certifications: ['cert-forklift'],
    },
    {
      key: 'hr.practicalAssessor',
      title: '实操考评员',
      protectedByOther: false,
      otherAssignments: 1,
      certifications: [],
    },
    {
      key: 'prod.cncOperator',
      title: '设备开工登记',
      protectedByOther: false,
      otherAssignments: 0,
      certifications: ['cert-cnc'],
    },
    {
      key: 'root',
      title: 'Root',
      protectedByOther: true,
      otherAssignments: 1,
      certifications: [],
    },
  ],
};

function renderForm(onSaved = vi.fn()) {
  render(
    <MemoryRouter>
      <LicensedSettingsForm initial={INITIAL} onSaved={onSaved} />
    </MemoryRouter>,
  );
  return onSaved;
}

describe('LicensedSettingsForm', () => {
  beforeEach(() => {
    request.mockReset();
    added.mockReset();
  });

  it('saves the switch and the lists at the loaded revisions', async () => {
    request.mockResolvedValue({ data: INITIAL });
    const onSaved = renderForm();
    fireEvent.click(
      screen.getByRole('switch', {
        name: /licensed\.settings\.transferCheck$/u,
      }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'licensed.settings.save' }),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'talent/licensed/settings',
        method: 'PUT',
        json: {
          enabledRevision: 1,
          packRevision: 0,
          value: { ...INITIAL.value, transferCheckEnabled: false },
        },
      }),
    );
  });

  it('cannot list a platform-protected set or one still assigned elsewhere', () => {
    renderForm();
    const assessor = screen.getByRole('checkbox', { name: '实操考评员' });
    expect(
      assessor.getAttribute('aria-disabled') ??
        (assessor as HTMLInputElement).disabled,
    ).toBeTruthy();
    expect(
      screen.getByText(/licensed\.settings\.otherAssignments/u),
    ).toBeTruthy();
    expect(screen.getByText('licensed.settings.protectedByOther')).toBeTruthy();
  });

  it('shows the server’s refusal', async () => {
    const { ApiClientError } = await import('@nocobase/app-client');
    request.mockRejectedValue(
      new ApiClientError('conflict', {
        status: 409,
        code: 'SETTINGS_CONFLICT',
        payload: { code: 'SETTINGS_CONFLICT' },
        method: 'PUT',
        url: '/api/talent/licensed/settings',
      }),
    );
    renderForm();
    fireEvent.click(
      screen.getByRole('button', { name: 'licensed.settings.save' }),
    );
    expect(await screen.findByText('licensed.settings.conflict')).toBeTruthy();
  });
});
