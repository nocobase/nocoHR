import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NotificationLogsPage } from '../../client/extensions/nocobase-notification-logs-ui/page.js';

const { request, api } = vi.hoisted(() => {
  const request = vi.fn();
  return { request, api: { request } };
});
vi.mock('@nocobase/app-client', () => ({ useApiClient: () => api }));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));
beforeEach(() => {
  request.mockReset();
});

it('reads the existing logs endpoint, renders real log fields and refreshes without sending', async () => {
  request.mockResolvedValue({
    data: [
      {
        log: {
          id: 'log-1',
          sourceType: 'learning-reminder',
          status: 'completed',
          createdAt: '2026-10-23T00:00:00Z',
          updatedAt: '2026-10-23T00:00:00Z',
        },
        deliveries: [],
      },
    ],
  });
  render(<NotificationLogsPage />);
  expect(await screen.findByText('learning-reminder')).toBeVisible();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenLastCalledWith({
    path: 'notifications/logs',
    query: { pageSize: 100 },
    signal: expect.any(AbortSignal),
  });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(
    request.mock.calls.every(([input]) => input.method === undefined),
  ).toBe(true);
});

it('shows loading and empty feedback, and cancels the content read on unmount', async () => {
  let finish!: (value: { data: [] }) => void;
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<NotificationLogsPage />);
  expect(screen.getByText('Loading delivery history…')).toBeVisible();
  finish({ data: [] });
  expect(await screen.findByText('No deliveries yet')).toBeVisible();
  const signal = request.mock.calls[0][0].signal as AbortSignal;
  view.unmount();
  expect(signal.aborted).toBe(true);
});

it('shows an explicit denied read and permits a manual retry', async () => {
  request.mockRejectedValueOnce(
    new Error('Notification logs access is required.'),
  );
  request.mockResolvedValue({ data: [] });
  render(<NotificationLogsPage />);
  expect(
    await screen.findByText('Notification logs access is required.'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('No deliveries yet')).toBeVisible();
  expect(
    screen.queryByText('Notification logs access is required.'),
  ).not.toBeInTheDocument();
});
