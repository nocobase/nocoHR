import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@nocobase/i18n/client', () => ({
  useLocale: () => ({ locale: 'en-US' }),
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { MonthCalendar } from '../../client/pages/talent/sessions/index.js';

function todayCell(
  container: HTMLElement,
  day: number,
): HTMLElement | undefined {
  return Array.from(container.querySelectorAll('span')).find(
    (element) =>
      element.textContent === String(day) &&
      element.classList.contains('bg-primary'),
  );
}

function setVisibilityState(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
}

beforeEach(() => {
  vi.stubEnv('TZ', 'America/New_York');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it.each([
  {
    label: 'spring-forward midnight',
    start: () => new Date(2026, 2, 8),
    next: () => new Date(2026, 2, 9),
    elapsed: 23 * 60 * 60 * 1000,
  },
  {
    label: 'fall-back midnight',
    start: () => new Date(2026, 10, 1),
    next: () => new Date(2026, 10, 2),
    elapsed: 25 * 60 * 60 * 1000,
  },
])(
  'refreshes the highlighted day at $label',
  async ({ start: makeStart, next: makeNext, elapsed }) => {
    const start = makeStart();
    const next = makeNext();
    expect(next.getTime() - start.getTime()).toBe(elapsed);
    vi.setSystemTime(start);
    const timeout = vi.spyOn(window, 'setTimeout');
    const view = render(<MonthCalendar sessions={[]} onOpen={vi.fn()} />);

    expect(timeout).toHaveBeenCalledWith(expect.any(Function), elapsed);
    expect(todayCell(view.container, start.getDate())).toBeDefined();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(elapsed + 1);
    });
    expect(todayCell(view.container, next.getDate())).toBeDefined();

    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removeWindowListener).toHaveBeenCalledWith(
      'focus',
      expect.any(Function),
    );
    expect(removeDocumentListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
  },
);

it('keeps month navigation while refreshing after a background midnight and focus return', async () => {
  vi.setSystemTime(new Date(2026, 5, 30, 23, 59, 59, 500));
  const view = render(<MonthCalendar sessions={[]} onOpen={vi.fn()} />);
  fireEvent.click(
    view.getByRole('button', { name: 'talent.sessions.nextMonth' }),
  );
  expect(view.getByText('July 2026')).toBeVisible();

  await act(async () => {
    setVisibilityState('hidden');
    fireEvent(document, new Event('visibilitychange'));
    vi.setSystemTime(new Date(2026, 6, 1, 1));
    setVisibilityState('visible');
    fireEvent(document, new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(view.getByText('July 2026')).toBeVisible();
  expect(todayCell(view.container, 1)).toBeDefined();

  vi.setSystemTime(new Date(2026, 6, 2, 1));
  await act(async () => {
    fireEvent.focus(window);
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(view.getByText('July 2026')).toBeVisible();
  expect(todayCell(view.container, 2)).toBeDefined();
});
