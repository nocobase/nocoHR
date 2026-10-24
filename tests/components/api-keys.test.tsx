import { renderWithApp } from '@nocobase/app-testing/client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import ApiKeys from '../../client/pages/settings/api-keys.js';
import enUS from '../../client/locales/en-US.js';
const auth = vi.hoisted(() => ({
  apiKey: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
}));
const { apiKey } = auth;
vi.mock('@nocobase/app-plugin-authentication/client', () => ({
  useAuthenticationClient: () => auth,
}));
it('shows a newly issued key once and clears it when the reveal closes, using the existing native key operations', async () => {
  apiKey.list.mockResolvedValue({ data: { apiKeys: [] } });
  apiKey.create.mockResolvedValue({
    data: { key: 'synthetic-key-for-component-test' },
  });
  const user = userEvent.setup();
  await renderWithApp(<ApiKeys />, {
    namespace: 'key-test',
    namespaces: { 'key-test': { 'en-US': async () => ({ default: enUS }) } },
  });
  await waitFor(() => expect(apiKey.list).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: enUS.apiKeys.page.add }));
  await user.type(
    screen.getByLabelText(enUS.apiKeys.form.name),
    'Independent test',
  );
  await user.click(
    screen.getByRole('button', { name: enUS.apiKeys.form.create }),
  );
  expect(
    await screen.findByText('synthetic-key-for-component-test'),
  ).toBeVisible();
  expect(apiKey.create).toHaveBeenCalledWith({
    name: 'Independent test',
    expiresIn: 90 * 24 * 60 * 60,
  });
  await user.click(
    screen.getByRole('button', { name: enUS.apiKeys.reveal.done }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText('synthetic-key-for-component-test'),
    ).not.toBeInTheDocument(),
  );
  expect(apiKey.list).toHaveBeenCalledTimes(2);
});
