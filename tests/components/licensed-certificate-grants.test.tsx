import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({
  state: { data: undefined as unknown },
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: () => ({
    data: state.data,
    error: undefined,
    loading: false,
    reload: vi.fn(),
  }),
}));

import { LicensedCertificateGrants } from '../../client/components/talent/licensed-certificate-grants';

const GRANT = {
  certificateId: 'c1',
  certificationId: 'cert-cnc',
  title: 'CNC 岗位上岗证',
  status: 'valid',
  expiresAt: '2027-04-30',
  expiring: false,
  pages: ['demo.batchRecord'],
  permissionSets: ['设备开工登记'],
};

function renderGrants(props: {
  employeeId?: string;
  certificationId?: string;
}) {
  return render(
    <MemoryRouter>
      <LicensedCertificateGrants {...props} />
    </MemoryRouter>,
  );
}

describe('LicensedCertificateGrants', () => {
  beforeEach(() => {
    state.data = { enabled: true, employeeId: 'emp-zhoudi', items: [GRANT] };
  });

  it('says what the holder’s certificate allows and links to the page', () => {
    renderGrants({ employeeId: 'emp-zhoudi' });
    expect(
      screen.getByText(/licensed\.grants\.canOperate/u).textContent,
    ).toContain('navigation.demoBatchRecord');
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/demo/batch-record');
    expect(screen.queryByText(/licensed\.grants\.willLose/u)).toBeNull();
  });

  it('warns what stops working when the certificate is expiring', () => {
    state.data = {
      enabled: true,
      employeeId: 'emp-zhoudi',
      items: [{ ...GRANT, status: 'expiring', expiring: true }],
    };
    renderGrants({ certificationId: 'cert-cnc' });
    expect(screen.getByText(/licensed\.grants\.willLose/u)).toBeTruthy();
  });

  it('shows nothing on someone else’s wall or with the industry pack off', () => {
    const { container, unmount } = renderGrants({ employeeId: 'emp-limin' });
    expect(container.textContent).toBe('');
    unmount();
    state.data = { enabled: false, employeeId: 'emp-zhoudi', items: [] };
    expect(renderGrants({}).container.textContent).toBe('');
  });
});
