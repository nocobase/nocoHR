import { ApiClientError } from '@nocobase/app-client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../client/locales/en-US';

// V2-07 公开页 · 对话式投递: the knockout questions come one at a time as buttons, the form needs consent and a
// resume, and a self-booking posting offers its open slots right after the application.
const state = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request: state.request }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, args: Record<string, unknown> = {}) => {
      let result: unknown = en;
      for (const segment of key.split('.'))
        result =
          result && typeof result === 'object'
            ? (result as Record<string, unknown>)[segment]
            : undefined;
      if (typeof result !== 'string')
        return typeof args.defaultValue === 'string' ? args.defaultValue : key;
      for (const [name, value] of Object.entries(args))
        result = (result as string).replaceAll(`{{${name}}}`, String(value));
      return result;
    },
  }),
}));

import PublicJobPage from '../../client/pages/talent/recruiting/public/job';

const JOB = {
  slug: 'cnc',
  title: 'CNC 操作工（成都）',
  description: '负责数控机床的装夹与加工。',
  location: '成都工厂',
  requirements: [{ text: '能适应三班倒', mustHave: true }],
  questions: [
    {
      key: 'q1',
      question: '能否接受三班倒（含夜班）？',
      answerType: 'yesNo',
      options: [],
    },
    {
      key: 'q2',
      question: '是否会看简单零件图纸？',
      answerType: 'yesNo',
      options: [],
    },
  ],
  selfBooking: true,
  maxResumeMb: 10,
  consentText: 'We keep your information for 24 months.',
  fields: [],
};

beforeEach(() => state.request.mockReset());

describe('PublicJobPage', () => {
  it('asks the knockout questions, requires consent, then offers the open slots', async () => {
    const calls: { path: string; body?: FormData; json?: unknown }[] = [];
    state.request.mockImplementation(
      (input?: { path: string; body?: FormData; json?: unknown }) => {
        if (!input) return Promise.resolve({ data: null });
        calls.push(input);
        if (input.path === 'public/recruiting/jobs/cnc')
          return Promise.resolve({ data: JOB });
        if (input.path === 'public/recruiting/jobs/cnc/ticket')
          return Promise.resolve({
            data: { ticket: 'ticket-1', difficulty: 4, minSeconds: 0 },
          });
        if (input.path === 'public/recruiting/jobs/cnc/apply')
          return Promise.resolve({
            data: {
              received: true,
              bookingToken: 'booking-token-aaaaaaaaaaaaaaaaaaaa',
              slots: [
                {
                  start: '2026-10-02T02:00:00.000Z',
                  end: '2026-10-02T03:00:00.000Z',
                  location: '行政楼 201',
                  label: '2026-10-02 10:00',
                },
              ],
            },
          });
        if (input.path.startsWith('public/recruiting/booking/'))
          return Promise.resolve({
            data: { booked: true, label: '2026-10-02 10:00' },
          });
        return Promise.reject(new Error(`unexpected ${input.path}`));
      },
    );
    render(
      <MemoryRouter initialEntries={['/jobs/cnc']}>
        <Routes>
          <Route path='/jobs/:slug' element={<PublicJobPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText(en.recruiting.public.start));
    expect(screen.getByText('能否接受三班倒（含夜班）？')).toBeTruthy();
    // One question at a time: the second appears only after the first is answered.
    expect(screen.queryByText('是否会看简单零件图纸？')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: en.recruiting.common.no }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: en.recruiting.common.yes }),
    );
    fireEvent.change(await screen.findByLabelText(en.recruiting.public.name), {
      target: { value: '周迪' },
    });
    fireEvent.change(screen.getByLabelText(en.recruiting.public.phone), {
      target: { value: '13900007100' },
    });
    const file = new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' });
    fireEvent.change(
      screen.getByLabelText(
        en.recruiting.public.resume.replace('{{mb}}', '10'),
      ),
      { target: { files: [file] } },
    );
    const apply = screen.getByRole('button', {
      name: en.recruiting.public.apply,
    });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(apply);
    const slot = await screen.findByRole('button', {
      name: /2026-10-02 10:00/u,
    });
    const sent = calls.find(
      (c) => c.path === 'public/recruiting/jobs/cnc/apply',
    )!.body!;
    expect(JSON.parse(String(sent.get('answers')))).toEqual({
      q1: 'no',
      q2: 'yes',
    });
    expect(sent.get('consent')).toBe('true');
    // The human check: the ticket fetched when the conversation started, its proof, the hidden field empty.
    expect(sent.get('ticket')).toBe('ticket-1');
    expect(String(sent.get('proof'))).toMatch(/^\d+$/u);
    expect(sent.get('website')).toBe('');
    expect(
      calls.findIndex((c) => c.path === 'public/recruiting/jobs/cnc/ticket'),
    ).toBeLessThan(
      calls.findIndex((c) => c.path === 'public/recruiting/jobs/cnc/apply'),
    );
    fireEvent.click(slot);
    await waitFor(() =>
      expect(
        screen.getByText(
          en.recruiting.public.booked.replace('{{time}}', '2026-10-02 10:00'),
        ),
      ).toBeTruthy(),
    );
  });
  it('solves a new check the server asks for and sends the application again, with nothing for the person to answer', async () => {
    const applied: FormData[] = [];
    state.request.mockImplementation(
      (input?: { path: string; body?: FormData }) => {
        if (!input) return Promise.resolve({ data: null });
        if (input.path === 'public/recruiting/jobs/cnc')
          return Promise.resolve({
            data: { ...JOB, questions: [], selfBooking: false },
          });
        if (input.path === 'public/recruiting/jobs/cnc/ticket')
          return Promise.resolve({
            data: { ticket: 'light', difficulty: 2, minSeconds: 0 },
          });
        if (input.path === 'public/recruiting/jobs/cnc/apply') {
          applied.push(input.body!);
          if (applied.length === 1)
            return Promise.reject(
              new ApiClientError('verify', {
                status: 409,
                method: 'POST',
                url: input.path,
                payload: {
                  code: 'PUBLIC_VERIFY_REQUIRED',
                  details: { ticket: 'heavier', difficulty: 6, minSeconds: 0 },
                },
              }),
            );
          return Promise.resolve({
            data: { received: true, bookingToken: null, slots: [] },
          });
        }
        return Promise.reject(new Error(`unexpected ${input.path}`));
      },
    );
    render(
      <MemoryRouter initialEntries={['/jobs/cnc']}>
        <Routes>
          <Route path='/jobs/:slug' element={<PublicJobPage />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText(en.recruiting.public.start));
    fireEvent.change(await screen.findByLabelText(en.recruiting.public.name), {
      target: { value: '周迪' },
    });
    fireEvent.change(screen.getByLabelText(en.recruiting.public.phone), {
      target: { value: '13900007100' },
    });
    fireEvent.change(
      screen.getByLabelText(
        en.recruiting.public.resume.replace('{{mb}}', '10'),
      ),
      { target: { files: [new File(['%PDF'], 'r.pdf')] } },
    );
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(
      screen.getByRole('button', { name: en.recruiting.public.apply }),
    );
    await screen.findByText(en.recruiting.public.submitted);
    expect(applied.map((f) => f.get('ticket'))).toEqual(['light', 'heavier']);
    // No question appears: the old arithmetic field is gone.
    expect(screen.queryByRole('textbox', { name: /answer/iu })).toBeNull();
  });
});
