import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  FilePreviewDialog,
  type FileRecord,
} from '../../client/extensions/nocobase-file-component-ui/index';

const viewer = vi.hoisted(() => ({
  load: vi.fn<(data: ArrayBuffer) => Promise<void>>(),
  destroy: vi.fn(),
  createObjectURL: vi.fn<(blob: Blob) => string>(),
  revokeObjectURL: vi.fn<(url: string) => void>(),
}));

class TestURL extends URL {
  static createObjectURL = viewer.createObjectURL;
  static revokeObjectURL = viewer.revokeObjectURL;
}

vi.mock('@silurus/ooxml/docx', () => ({
  DocxScrollViewer: class {
    load = viewer.load;
    destroy = viewer.destroy;
  },
}));
vi.mock('@silurus/ooxml/xlsx', () => ({
  XlsxViewer: class {
    load = viewer.load;
    destroy = viewer.destroy;
  },
}));
vi.mock('@silurus/ooxml/pptx', () => ({
  PptxScrollViewer: class {
    load = viewer.load;
    destroy = viewer.destroy;
  },
}));

function file(ext: string): FileRecord {
  return {
    id: 'attachment',
    filename: `attachment.${ext}`,
    ext,
    mimeType: 'application/octet-stream',
    size: 3,
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    contentUrl: `/main/expense-files/attachment.${ext}`,
  };
}

beforeEach(() => {
  viewer.load.mockReset().mockResolvedValue(undefined);
  viewer.destroy.mockReset();
  viewer.createObjectURL.mockReset().mockReturnValue('blob:preview');
  viewer.revokeObjectURL.mockReset();
  vi.stubGlobal('URL', TestURL);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(['docx', 'xlsx', 'pptx'])(
  'preinstalled preview fetches private %s content for the local viewer',
  async (ext) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchMock);
    const { unmount } = render(
      <FilePreviewDialog files={[file(ext)]} open onOpenChange={vi.fn()} />,
    );
    await waitFor(() => expect(viewer.load).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(
      `/main/expense-files/attachment.${ext}`,
      {
        credentials: 'same-origin',
        signal: expect.any(AbortSignal),
      },
    );
    expect(new Uint8Array(viewer.load.mock.calls[0]![0])).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(
      document.querySelector(`[data-office-open-xml-format="${ext}"]`),
    ).not.toBeNull();
    expect(document.querySelector('iframe')).toBeNull();
    unmount();
    expect(viewer.destroy).toHaveBeenCalledOnce();
  },
);

it('shows the denied content response without trying a third-party viewer', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 403 })),
  );
  render(
    <FilePreviewDialog
      files={[file('docx')]}
      open
      onOpenChange={vi.fn()}
      download={false}
    />,
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('403');
  expect(viewer.load).not.toHaveBeenCalled();
  expect(document.querySelector('iframe')).toBeNull();
  expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
});

it.each(['text/html; charset=utf-8', 'application/problem+xml'])(
  'rejects a PDF content response with active markup MIME %s',
  async (mimeType) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html>not a PDF</html>', {
        headers: { 'content-type': mimeType },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(
      <FilePreviewDialog files={[file('pdf')]} open onOpenChange={vi.fn()} />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file URL returned HTML or XML instead of a PDF.',
    );
    expect(document.querySelector('iframe')).toBeNull();
    expect(viewer.createObjectURL).not.toHaveBeenCalled();
  },
);

it('embeds a valid PDF blob with a fixed MIME type and revokes it on close', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response('%PDF-1.7', {
      headers: { 'content-type': 'application/octet-stream' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const props = { files: [file('pdf')], onOpenChange: vi.fn() };
  const { rerender } = render(<FilePreviewDialog {...props} open />);

  await waitFor(() => expect(viewer.createObjectURL).toHaveBeenCalledOnce());
  const blob = viewer.createObjectURL.mock.calls[0]![0];
  expect(blob.type).toBe('application/pdf');
  expect(screen.getByTitle('attachment.pdf')).toHaveAttribute(
    'src',
    'blob:preview',
  );

  rerender(<FilePreviewDialog {...props} open={false} />);
  expect(viewer.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
});

it('shows a download fallback after an image preview fails without retrying its thumbnail', () => {
  const image = {
    ...file('png'),
    mimeType: 'image/png',
    contentUrl: '/main/files/attachment.png',
  };
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => undefined);
  render(<FilePreviewDialog files={[image]} open onOpenChange={vi.fn()} />);

  fireEvent.error(screen.getByRole('img', { name: 'attachment.png' }));

  expect(screen.getByText(/This image could not be displayed/)).toBeVisible();
  expect(screen.queryByRole('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Download file' }));
  expect(click).toHaveBeenCalledOnce();
  click.mockRestore();
});

function useShortOfficePreviewTimeout(): {
  readonly timeoutId: number | undefined;
  readonly advance: (milliseconds?: number) => Promise<void>;
} {
  vi.useFakeTimers();
  const fakeSetTimeout = window.setTimeout.bind(window);
  let timeoutId: number | undefined;
  vi.spyOn(window, 'setTimeout').mockImplementation(
    (handler, timeout, ...args) => {
      const id = fakeSetTimeout(
        handler,
        timeout === 180_000 ? 5 : timeout,
        ...args,
      );
      if (timeout === 180_000) timeoutId = id;
      return id;
    },
  );
  return {
    get timeoutId() {
      return timeoutId;
    },
    advance: (milliseconds = 5) =>
      act(async () => vi.advanceTimersByTimeAsync(milliseconds)),
  };
}

it('aborts a hung OOXML request at the preview deadline and offers download', async () => {
  const timer = useShortOfficePreviewTimeout();
  let requestSignal: AbortSignal | undefined;
  const fetchMock = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
    requestSignal = init?.signal as AbortSignal;
    return new Promise<Response>(() => undefined);
  });
  vi.stubGlobal('fetch', fetchMock);
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => undefined);
  render(
    <FilePreviewDialog files={[file('docx')]} open onOpenChange={vi.fn()} />,
  );

  expect(screen.getByRole('status')).toHaveTextContent('Loading preview');
  expect(timer.timeoutId).toBeDefined();
  await timer.advance();

  expect(requestSignal?.aborted).toBe(true);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The preview did not finish loading within 3 minutes.',
  );
  expect(viewer.load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Download file' }));
  expect(click).toHaveBeenCalledOnce();
  click.mockRestore();
});

it('destroys a viewer that has not rendered before the OOXML deadline', async () => {
  const timer = useShortOfficePreviewTimeout();
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      requestSignal = init?.signal as AbortSignal;
      return Promise.resolve(new Response(new Uint8Array([1, 2, 3])));
    }),
  );
  viewer.load.mockImplementation(() => new Promise<void>(() => undefined));
  render(
    <FilePreviewDialog files={[file('docx')]} open onOpenChange={vi.fn()} />,
  );
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
  expect(viewer.load).toHaveBeenCalledOnce();

  await timer.advance();

  expect(requestSignal?.aborted).toBe(true);
  expect(viewer.destroy).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The preview did not finish loading within 3 minutes.',
  );
});

it('aborts pending OOXML work and clears the preview deadline on unmount', () => {
  const timer = useShortOfficePreviewTimeout();
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }),
  );
  const clearTimeout = vi.spyOn(window, 'clearTimeout');
  const { unmount } = render(
    <FilePreviewDialog files={[file('docx')]} open onOpenChange={vi.fn()} />,
  );

  unmount();

  expect(requestSignal?.aborted).toBe(true);
  expect(clearTimeout).toHaveBeenCalledWith(timer.timeoutId);
  expect(viewer.destroy).not.toHaveBeenCalled();
});

it('keeps one deadline across fetch and render and ignores late render completion', async () => {
  const timer = useShortOfficePreviewTimeout();
  let finishFetch!: (response: Response) => void;
  let finishRender!: () => void;
  let requestSignal: AbortSignal | undefined;
  const pendingFetch = new Promise<Response>((resolve) => {
    finishFetch = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      requestSignal = init?.signal as AbortSignal;
      return pendingFetch;
    }),
  );
  viewer.load.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishRender = resolve;
      }),
  );
  const { unmount } = render(
    <FilePreviewDialog files={[file('docx')]} open onOpenChange={vi.fn()} />,
  );

  await timer.advance(3);
  finishFetch(new Response(new Uint8Array([1, 2, 3])));
  await act(async () => {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  });
  expect(viewer.load).toHaveBeenCalledOnce();

  await timer.advance(2);

  expect(requestSignal?.aborted).toBe(true);
  expect(viewer.destroy).toHaveBeenCalledOnce();
  expect(screen.getByRole('alert')).toHaveTextContent('within 3 minutes');

  await act(async () => finishRender());
  expect(screen.getByRole('alert')).toHaveTextContent('within 3 minutes');
  unmount();
  expect(viewer.destroy).toHaveBeenCalledOnce();
});

it('clears the deadline after successful rendering and destroys the viewer on close', async () => {
  const timer = useShortOfficePreviewTimeout();
  const clearTimeout = vi.spyOn(window, 'clearTimeout');
  vi.stubGlobal(
    'fetch',
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(new Uint8Array([1, 2, 3]))),
  );
  const props = { files: [file('docx')], onOpenChange: vi.fn() };
  const { rerender } = render(<FilePreviewDialog {...props} open />);

  await act(async () => {
    for (let turn = 0; turn < 12; turn += 1) await Promise.resolve();
  });
  expect(viewer.load).toHaveBeenCalledOnce();
  expect(clearTimeout).toHaveBeenCalledWith(timer.timeoutId);

  await timer.advance();

  expect(screen.queryByRole('alert')).toBeNull();
  expect(viewer.destroy).not.toHaveBeenCalled();
  rerender(<FilePreviewDialog {...props} open={false} />);
  expect(viewer.destroy).toHaveBeenCalledOnce();
});

it('does not create a PDF object URL when its request returns after close', async () => {
  let finishFetch!: (response: Response) => void;
  const pendingFetch = new Promise<Response>((resolve) => {
    finishFetch = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => pendingFetch),
  );
  const props = { files: [file('pdf')], onOpenChange: vi.fn() };
  const { rerender } = render(<FilePreviewDialog {...props} open />);

  rerender(<FilePreviewDialog {...props} open={false} />);
  finishFetch(
    new Response('%PDF-1.7', {
      headers: { 'content-type': 'application/pdf' },
    }),
  );
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });

  expect(viewer.createObjectURL).not.toHaveBeenCalled();
});
