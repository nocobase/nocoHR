import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  Employee,
  EmployeeProfile,
} from '../../client/components/talent/types';
import type { Question } from '../../client/components/talent/exam-types';
import type { Practice } from '../../client/components/talent/training-types';
import type { LearnerCourse } from '../../client/components/talent/learning-types';

const mocks = vi.hoisted(() => {
  const request = vi.fn();
  return {
    api: { request },
    request,
    t: (key: string) => key,
    remote: vi.fn(),
    mail: {
      listProviders: vi.fn(),
      listAccounts: vi.fn(),
      connectAccount: vi.fn(),
    },
  };
});
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => mocks.api,
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({ t: mocks.t }),
}));
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: mocks.remote,
}));
vi.mock('../../client/components/talent/custom-field-model', () => ({
  useCustomFieldDefinitions: () => ({ definitions: [] }),
  compactValues: (x: unknown) => x,
}));
vi.mock('../../client/components/ui/toast', () => ({
  toast: { add: vi.fn() },
}));
vi.mock('@nocobase/app-plugin-mail/client', () => ({
  useMailClient: () => mocks.mail,
  mailErrorMessage: (cause: Error, fallback: string) =>
    cause.message || fallback,
}));
vi.mock('@nocobase/app-plugin-mail/client/components', () => ({
  MailAccountCard: ({ statusLabel }: { statusLabel: string }) => (
    <p>{statusLabel}</p>
  ),
  MailAccountConnector: ({
    onConnectCredentials,
  }: {
    onConnectCredentials: (p: unknown, c: unknown) => void;
  }) => (
    <button
      onClick={() =>
        onConnectCredentials({ type: 'imap', name: 'synthetic' }, {})
      }
    >
      connect synthetic
    </button>
  ),
}));

import { ProfileChangeDialog } from '../../client/pages/talent/me/profile-change-dialog';
import { QuestionDialog } from '../../client/pages/talent/questions/question-dialog';
import { VideoLesson } from '../../client/pages/talent/learning/video-lesson';
import MyMailboxPage from '../../client/pages/talent/my-mailbox';
import PracticePage from '../../client/pages/talent/practice';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.remote.mockReturnValue({ data: [], reload: vi.fn() });
  mocks.request.mockResolvedValue({ data: {} });
});
afterEach(() => vi.useRealTimers());

const profile = {
  educations: Array.from({ length: 3 }, () => ({
    school: 'Same school',
    degree: 'bachelor',
  })),
  experiences: Array.from({ length: 3 }, () => ({ company: 'Same company' })),
  emergencyContacts: Array.from({ length: 3 }, () => ({ name: 'Same name' })),
} as unknown as EmployeeProfile;
const employee = { id: 'synthetic', customFields: {} } as Employee;

for (const [kind, label, add, changed] of [
  [
    'educations',
    'talent.profile.school',
    'talent.profile.addEducation',
    'school',
  ],
  [
    'experiences',
    'talent.profile.company',
    'talent.profile.addExperience',
    'company',
  ],
  [
    'emergencyContacts',
    'talent.profile.contactName',
    'talent.profile.addContact',
    'name',
  ],
] as const) {
  it(`keeps ${kind} duplicate rows and focused DOM identity after removal; submits values only and resets on reopen`, async () => {
    const props = {
      open: true,
      employee,
      profile,
      fields: [kind],
      onOpenChange: vi.fn(),
      onSubmitted: vi.fn(),
    };
    const view = render(<ProfileChangeDialog {...props} />);
    const rows = screen.getAllByRole('textbox', { name: label });
    const survivor = rows[2]!;
    survivor.focus();
    fireEvent.click(
      screen.getAllByRole('button', { name: 'talent.common.remove' })[1]!,
    );
    expect(screen.getAllByRole('textbox', { name: label })[1]).toBe(survivor);
    expect(survivor).toHaveFocus();
    fireEvent.change(survivor, { target: { value: 'Edited survivor' } });
    fireEvent.click(screen.getByRole('button', { name: add }));
    expect(screen.getAllByRole('textbox', { name: label })).toHaveLength(3);
    fireEvent.submit(document.getElementById('profile-change-form')!);
    await waitFor(() => expect(props.onSubmitted).toHaveBeenCalledOnce());
    const json = mocks.request.mock.calls[0]![0].json;
    expect(json.changes[kind][1][changed]).toBe('Edited survivor');
    expect(JSON.stringify(json)).not.toContain('uiId');
    expect(JSON.stringify(json)).not.toContain('nextRowId');
    view.rerender(<ProfileChangeDialog {...props} open={false} />);
    view.rerender(<ProfileChangeDialog {...props} open />);
    expect(screen.getAllByRole('textbox', { name: label })).toHaveLength(3);
    expect(screen.getAllByRole('textbox', { name: label })[1]).toHaveValue(
      rows[0]!.getAttribute('value'),
    );
    mocks.request.mockClear();
    fireEvent.submit(document.getElementById('profile-change-form')!);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(await screen.findByText('talent.me.change.noChanges')).toBeVisible();
  });
}

it('keeps blank-answer row identity, positional alternatives, empty rows and draft reset across types/questions', async () => {
  mocks.remote.mockReturnValue({ data: { competencies: [] } });
  const question = {
    id: 'q1',
    type: 'blank',
    stem: '___ ___ ___',
    answer: [['same'], ['same'], ['same']],
    options: [],
    competencies: [],
  } as unknown as Question;
  const props = {
    open: true,
    question,
    onOpenChange: vi.fn(),
    onSaved: vi.fn(),
  };
  const view = render(<QuestionDialog {...props} />);
  const answers = screen.getAllByDisplayValue('same');
  const survivor = answers[2]!;
  survivor.focus();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'talent.common.remove' })[0]!,
  );
  expect(screen.getAllByDisplayValue('same')[1]).toBe(survivor);
  expect(survivor).toHaveFocus();
  fireEvent.change(survivor, { target: { value: ' second / alternative / ' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'talent.questions.addBlank' }),
  );
  fireEvent.submit(document.getElementById('question-form')!);
  await waitFor(() => expect(props.onSaved).toHaveBeenCalledOnce());
  expect(mocks.request.mock.calls[0]![0].json.answer).toEqual([
    ['same'],
    ['second', 'alternative'],
    [],
  ]);
  expect(JSON.stringify(mocks.request.mock.calls[0]![0].json)).not.toContain(
    'uiId',
  );
  const emptyAnswer = screen
    .getAllByRole('textbox')
    .find((input) => input instanceof HTMLInputElement && input.value === '');
  expect(emptyAnswer).toBeDefined();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'talent.common.remove' })[1]!,
  );
  expect(emptyAnswer).toBeInTheDocument();
  view.rerender(<QuestionDialog {...props} open={false} />);
  view.rerender(
    <QuestionDialog
      {...props}
      question={{ ...question, id: 'q2', answer: [['other']] }}
    />,
  );
  expect(screen.getAllByDisplayValue('other')).toHaveLength(1);
  view.rerender(<QuestionDialog {...props} question={null} />);
  const type = screen.getByLabelText('talent.questions.fields.type');
  fireEvent.change(type, { target: { value: 'blank' } });
  fireEvent.click(
    screen.getByRole('button', { name: 'talent.questions.addBlank' }),
  );
  fireEvent.change(type, { target: { value: 'short' } });
  fireEvent.change(type, { target: { value: 'blank' } });
  expect(
    screen.getAllByRole('button', { name: 'talent.common.remove' }),
  ).toHaveLength(2);
});

it('retains the ten-second video cadence/latest callback, pause deduplication and old-lesson final report', async () => {
  vi.useFakeTimers();
  mocks.request.mockResolvedValue({
    data: { watchedSeconds: 10, maxPositionSeconds: 10, canComplete: false },
  });
  const lesson = {
    id: 'lesson1',
    maxPositionSeconds: 0,
    watchedSeconds: 0,
    videoSeconds: 100,
    minWatchPercent: 80,
  } as LearnerCourse['lessons'][number];
  const first = vi.fn(),
    latest = vi.fn();
  const view = render(
    <VideoLesson
      key={lesson.id}
      courseId='course1'
      lesson={lesson}
      onProgress={first}
    />,
  );
  let video = view.container.querySelector('video')!;
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  fireEvent.play(video);
  await act(() => vi.advanceTimersByTimeAsync(5000));
  view.rerender(
    <VideoLesson
      key={lesson.id}
      courseId='course1'
      lesson={lesson}
      onProgress={latest}
    />,
  );
  expect(mocks.request).not.toHaveBeenCalled();
  video.currentTime = 10;
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledOnce();
  Object.defineProperty(video, 'paused', { configurable: true, value: true });
  video.currentTime = 12;
  await act(async () => {
    fireEvent.pause(video);
    fireEvent.ended(video);
  });
  expect(mocks.request).toHaveBeenCalledTimes(2);
  Object.defineProperty(video, 'paused', { configurable: true, value: false });
  fireEvent.play(video);
  video.currentTime = 15;
  view.rerender(
    <VideoLesson
      key='lesson2'
      courseId='course2'
      lesson={{ ...lesson, id: 'lesson2' }}
      onProgress={latest}
    />,
  );
  expect(mocks.request.mock.calls[2]![0].json).toEqual({
    courseId: 'course1',
    lessonId: 'lesson1',
    from: 12,
    to: 15,
  });
  video = view.container.querySelector('video')!;
  video.playbackRate = 2;
  fireEvent.rateChange(video);
  expect(video.playbackRate).toBe(1.5);
  video.currentTime = 30;
  fireEvent.seeking(video);
  expect(video.currentTime).toBe(0);
  view.unmount();
  await act(() => vi.advanceTimersByTimeAsync(20000));
  expect(mocks.request).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

for (const failed of ['listProviders', 'listAccounts'] as const) {
  it(`starts both mailbox requests and preserves ${failed} failure feedback`, async () => {
    mocks.mail.listProviders.mockResolvedValue([]);
    mocks.mail.listAccounts.mockResolvedValue([]);
    mocks.mail[failed].mockRejectedValueOnce(
      new Error('synthetic load failure'),
    );
    render(
      <MemoryRouter>
        <MyMailboxPage />
      </MemoryRouter>,
    );
    expect(mocks.mail.listProviders).toHaveBeenCalledOnce();
    expect(mocks.mail.listAccounts).toHaveBeenCalledOnce();
    expect(await screen.findByText('synthetic load failure')).toBeVisible();
  });
}

it('retains connection failure feedback and stops removal refresh once no account is removing', async () => {
  vi.useFakeTimers();
  const account = {
    id: 'synthetic',
    provider: { type: 'imap', name: 'synthetic' },
    status: 'removing',
  };
  mocks.mail.listProviders.mockResolvedValue([
    { name: 'synthetic', type: 'imap' },
  ]);
  mocks.mail.listAccounts
    .mockResolvedValueOnce([account])
    .mockResolvedValue([]);
  mocks.mail.connectAccount.mockRejectedValue(
    new Error('synthetic connection failure'),
  );
  const view = render(
    <MemoryRouter>
      <MyMailboxPage />
    </MemoryRouter>,
  );
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'myMailbox.add' }));
  fireEvent.click(screen.getByRole('button', { name: 'connect synthetic' }));
  await act(async () => {});
  expect(screen.getByText('synthetic connection failure')).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.mail.listAccounts).toHaveBeenCalledTimes(2);
  expect(screen.getByText('synthetic connection failure')).toBeVisible();
  await act(() => vi.advanceTimersByTimeAsync(6000));
  expect(mocks.mail.listAccounts).toHaveBeenCalledTimes(2);
  view.unmount();
});

const practice = {
  id: 'p1',
  scenarioTitle: 'Synthetic practice',
  status: 'inProgress',
  fullAccess: true,
  passScore: 60,
  turnCount: 1,
  maxTurns: 5,
  transcript: [
    { role: 'coach', text: 'duplicate', at: 'same' },
    { role: 'coach', text: 'duplicate', at: 'same' },
  ],
  rubric: [],
} as unknown as Practice;
const practiceRoute = (
  <MemoryRouter initialEntries={['/practice/p1']}>
    <Routes>
      <Route path='/practice/:practiceId' element={<PracticePage />} />
    </Routes>
  </MemoryRouter>
);
it('preserves duplicate transcript DOM through append and finish; resets on reopening and hides manager text', async () => {
  Element.prototype.scrollIntoView = vi.fn();
  mocks.remote.mockReturnValue({ data: practice });
  const appended = {
    ...practice,
    transcript: [
      ...practice.transcript!,
      { role: 'employee', text: 'duplicate', at: 'same' },
    ],
  };
  mocks.request
    .mockResolvedValueOnce({ data: appended })
    .mockResolvedValueOnce({ data: { ...appended, status: 'completed' } });
  const view = render(practiceRoute);
  const old = screen.getAllByText('duplicate');
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: ' duplicate ' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'talent.practice.send' }));
  await waitFor(() => expect(screen.getAllByText('duplicate')).toHaveLength(3));
  expect(screen.getAllByText('duplicate')[0]).toBe(old[0]);
  expect(screen.getAllByText('duplicate')[1]).toBe(old[1]);
  expect(mocks.request.mock.calls[0]![0].json).toEqual({ text: 'duplicate' });
  fireEvent.click(
    screen.getByRole('button', { name: 'talent.practice.finish' }),
  );
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'talent.practice.finish' }),
  );
  await screen.findByText('talent.practice.result');
  expect(screen.getAllByText('duplicate')[0]).toBe(old[0]);
  view.unmount();
  mocks.remote.mockReturnValue({ data: { ...appended, status: 'completed' } });
  const reopened = render(practiceRoute);
  expect(screen.getAllByText('duplicate')).toHaveLength(3);
  expect(screen.getByText('talent.practice.result')).toBeVisible();
  reopened.unmount();
  mocks.remote.mockReturnValue({
    data: { ...practice, fullAccess: false, transcript: undefined },
  });
  render(practiceRoute);
  expect(screen.queryByText('duplicate')).toBeNull();
  expect(screen.getByText('talent.practice.scoresOnly')).toBeVisible();
});
