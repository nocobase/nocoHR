import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';

const rowIdentity = vi.hoisted(() => ({ next: 0 }));

vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/ui/table', async () => {
  const React = await import('react');
  return {
    Table: ({ children }: { children?: ReactNode }) =>
      React.createElement('table', null, children),
    TableBody: ({ children }: { children?: ReactNode }) =>
      React.createElement('tbody', null, children),
    TableCell: ({ children }: { children?: ReactNode }) =>
      React.createElement('td', null, children),
    TableHead: ({ children }: { children?: ReactNode }) =>
      React.createElement('th', null, children),
    TableHeader: ({ children }: { children?: ReactNode }) =>
      React.createElement('thead', null, children),
    TableRow: ({ children }: { children?: ReactNode }) => {
      const [instance] = React.useState(() => ++rowIdentity.next);
      return React.createElement('tr', { 'data-instance': instance }, children);
    },
  };
});

import { DetailTable } from '../../client/pages/talent/training-reports/index.js';

const first = {
  rowKey: 'attendance:["enrollment-1"]',
  employee: 'Same name',
  session: 'Same course',
  startAt: '2026-10-01T09:00:00.000Z',
  status: 'attended',
  method: 'manual',
};
const second = {
  ...first,
  rowKey: 'attendance:["enrollment-2"]',
  method: 'qr',
};

function report(
  attendance: (typeof first)[],
): Parameters<typeof DetailTable>[0]['report'] {
  return {
    details: { attendance },
  } as Parameters<typeof DetailTable>[0]['report'];
}

it('preserves same-name detail row identity through sorting and filtering', () => {
  const view = render(
    <DetailTable report={report([first, second])} list='attendance' />,
  );
  const manualCell = screen.getByText('talent.sessions.method.manual');
  const qrCell = screen.getByText('talent.sessions.method.qr');
  const manualRow = manualCell.closest('tr');
  const qrRow = qrCell.closest('tr');
  expect(manualRow).not.toBeNull();
  expect(qrRow).not.toBeNull();
  expect(manualRow).not.toBe(qrRow);

  view.rerender(
    <DetailTable report={report([second, first])} list='attendance' />,
  );
  expect(screen.getByText('talent.sessions.method.manual').closest('tr')).toBe(
    manualRow,
  );
  expect(screen.getByText('talent.sessions.method.qr').closest('tr')).toBe(
    qrRow,
  );

  view.rerender(<DetailTable report={report([second])} list='attendance' />);
  expect(screen.getByText('talent.sessions.method.qr').closest('tr')).toBe(
    qrRow,
  );
});
