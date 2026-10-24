import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeSourceSearch } from '../../client/pages/talent/knowledge/source-search.js';
const { request, api } = vi.hoisted(() => {
  const request = vi.fn();
  return { request, api: { request } };
});
vi.mock('@nocobase/app-client', () => ({ useApiClient: () => api }));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@nocobase/app-plugin-knowledge/client/pages', () => ({
  KnowledgeView: ({ space }: { space: { scopeId: string } }) => (
    <div data-testid='official-knowledge-view'>{space.scopeId}</div>
  ),
}));
const spaces = [
  {
    space: {
      id: 'space-id',
      scope: 'hr',
      scopeId: 'alpha',
      title: 'HR handbook',
      access: { read: true, propose: false, edit: false, manage: false },
      inherited: false,
    },
    documents: 1,
    archivedDocuments: 0,
  },
];
const result = {
  legacy: {
    status: 'ready',
    items: [
      {
        documentId: 'legacy-id',
        sectionIndex: 0,
        documentTitle: 'Legacy handbook',
        sectionTitle: 'Leave',
        excerpt: 'Legacy excerpt',
        citation: 'HR-1 § Leave',
        path: '/talent/knowledge/legacy-id',
      },
    ],
  },
  native: {
    status: 'ready',
    semantic: 'ready',
    items: [
      {
        docId: 'native-id',
        scope: 'hr',
        scopeId: 'alpha',
        title: 'Native handbook',
        excerpt: 'Native excerpt',
        spaceTitle: 'HR handbook',
        version: 2,
        headingPath: ['Leave'],
        lines: [1, 4],
      },
    ],
  },
  spaces,
};
function mount(path = '/talent/knowledge?tab=search') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <KnowledgeSourceSearch />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async ({ path }: { path: string }) => ({
    data: path.endsWith('/spaces') ? spaces : result,
  }));
});
describe('knowledge source search', () => {
  it('submits once, keeps source labels/references separate and links the official reader', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByText('HR handbook');
    await user.type(screen.getByLabelText('nativeKnowledge.query'), 'holiday');
    expect(
      request.mock.calls.filter(([r]) => r.path === 'talent/kb/search'),
    ).toHaveLength(0);
    await user.click(
      screen.getByRole('button', { name: 'nativeKnowledge.search' }),
    );
    expect(await screen.findByText('Legacy excerpt')).toBeInTheDocument();
    expect(screen.getByText('Native excerpt')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Legacy handbook · Leave' }),
    ).toHaveAttribute('href', '/talent/knowledge/legacy-id');
    expect(
      screen.getByRole('link', { name: 'Native handbook' }),
    ).toHaveAttribute(
      'href',
      '/talent/knowledge?tab=search&scope=hr&scopeId=alpha&doc=native-id&lines=1-4',
    );
    expect(
      request.mock.calls.filter(([r]) => r.path === 'talent/kb/search'),
    ).toHaveLength(1);
    expect(screen.getByText('nativeKnowledge.qaDeferred')).toBeInTheDocument();
  });
  it('preserves IME input and does not request while composing', async () => {
    mount();
    const input = screen.getByLabelText('nativeKnowledge.query');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '假' } });
    fireEvent.change(input, { target: { value: '假期' } });
    fireEvent.compositionEnd(input);
    await act(async () => {});
    expect(input).toHaveValue('假期');
    expect(
      request.mock.calls.some(([r]) => r.path === 'talent/kb/search'),
    ).toBe(false);
  });
  it('shows source failures and semantic fallback independently', async () => {
    request.mockImplementation(async ({ path }: { path: string }) => ({
      data: path.endsWith('/spaces')
        ? spaces
        : {
            ...result,
            legacy: { status: 'unavailable', items: [] },
            native: { ...result.native, semantic: 'unavailable' },
          },
    }));
    const user = userEvent.setup();
    mount();
    await user.type(screen.getByLabelText('nativeKnowledge.query'), 'holiday');
    await user.click(
      screen.getByRole('button', { name: 'nativeKnowledge.search' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'nativeKnowledge.sourceUnavailable',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'nativeKnowledge.semanticUnavailable',
    );
    expect(screen.getByText('Native excerpt')).toBeInTheDocument();
  });
  it('opens only an admitted native space and refuses a forged URL', async () => {
    const view = mount(
      '/talent/knowledge?tab=search&scope=hr&scopeId=alpha&doc=native-id',
    );
    expect(
      await screen.findByTestId('official-knowledge-view'),
    ).toHaveTextContent('alpha');
    view.unmount();
    mount('/talent/knowledge?tab=search&scope=hr&scopeId=hidden');
    await waitFor(() =>
      expect(screen.getByText('nativeKnowledge.noSpaces')).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId('official-knowledge-view'),
    ).not.toBeInTheDocument();
  });
});
