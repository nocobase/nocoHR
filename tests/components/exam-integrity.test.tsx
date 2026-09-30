import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';
import zh from '../../client/locales/zh-CN';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: vi.fn(),
  locale: 'en-US',
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
}));
vi.mock('@nocobase/i18n/client', () => ({
  useLocale: () => ({ locale: state.locale }),
  useTranslation: () => ({
    i18n: { language: state.locale },
    t: (key: string, args: Record<string, unknown> = {}) => {
      let result: unknown = state.locale === 'zh-CN' ? zh : en;
      for (const segment of key.split('.'))
        result =
          result && typeof result === 'object'
            ? (result as Record<string, unknown>)[segment]
            : undefined;
      return typeof result === 'string'
        ? result.replace(/\{\{(\w+)\}\}/gu, (_, token: string) =>
            String(args[token] ?? ''),
          )
        : key;
    },
  }),
}));
vi.mock('../../client/components/ui/toast', () => ({
  toast: { add: state.toast },
}));

import { AntiCheatCard } from '../../client/pages/talent/exams/anti-cheat-card';
import { DEFAULT_ANTI_CHEAT } from '../../client/pages/talent/exams/anti-cheat';
import { GradingPanel } from '../../client/pages/talent/exams/grading';
import { IntegrityPanel } from '../../client/pages/talent/exams/integrity';

const attempt = {
  id: 'attempt-1',
  examId: 'exam-1',
  examTitle: '安全实务问答',
  employeeName: '王磊',
  attemptNo: 1,
  status: 'failed',
  score: 40,
  passScore: 70,
  submittedAt: '2026-09-29T02:00:00.000Z',
  answersVisible: true,
  items: [
    {
      questionId: 'q-short',
      type: 'short',
      stem: '加工中发现铁屑缠绕在刀具上，你应如何处理？',
      options: [],
      score: 40,
      earned: null,
      correct: null,
      response: '先停机再清理。',
      answer: '先停机，再用铁钩清理。',
      gradingNotes: '先停机；用铁钩',
      aiSuggestion: {
        score: 20,
        matchedPoints: ['先停机'],
        missingPoints: ['用铁钩'],
        rationale: '命中“先停机”，未提到铁钩。',
        at: '2026-09-29T02:01:00.000Z',
      },
    },
  ],
  lossByCompetency: [],
  wrongByCompetency: [],
  integrity: {
    blurCount: 4,
    flags: [
      { type: 'blur', at: '2026-09-29T02:00:10.000Z', detail: '1' },
      {
        type: 'multiDevice',
        at: '2026-09-29T02:00:20.000Z',
        detail: 'rejected',
      },
    ],
    review: null,
    voidReason: null,
  },
};

beforeEach(() => {
  state.api.request.mockReset();
  state.toast.mockReset();
  state.locale = 'en-US';
});

describe('V3-10 anti-cheating settings', () => {
  it('reports each switch and the blur rule, in both languages', async () => {
    const onChange = vi.fn();
    const onAi = vi.fn();
    const { rerender } = render(
      <AntiCheatCard
        value={DEFAULT_ANTI_CHEAT}
        aiGrading
        disabled={false}
        onChange={onChange}
        onAiGradingChange={onAi}
      />,
    );
    expect(screen.getByText('Anti-cheating and AI grading')).toBeTruthy();
    await userEvent.click(
      screen.getByRole('switch', { name: 'Shuffle options' }),
    );
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_ANTI_CHEAT,
      shuffleOptions: false,
    });
    fireEvent.change(screen.getByLabelText('Times the page may be left'), {
      target: { value: '5' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_ANTI_CHEAT,
      maxBlurCount: 5,
    });
    await userEvent.click(
      screen.getByRole('switch', {
        name: 'Examiner suggests short-answer scores',
      }),
    );
    expect(onAi).toHaveBeenLastCalledWith(false);
    state.locale = 'zh-CN';
    rerender(
      <AntiCheatCard
        value={DEFAULT_ANTI_CHEAT}
        aiGrading
        disabled
        onChange={onChange}
        onAiGradingChange={onAi}
      />,
    );
    expect(screen.getByText('防作弊与 AI 建议分')).toBeTruthy();
  });
});

describe('V3-10 flagged attempts', () => {
  it('shows each flag and voids only with a reason', async () => {
    state.api.request.mockImplementation(async ({ path }: { path: string }) =>
      path.endsWith('/integrity')
        ? { data: [attempt] }
        : { data: { ...attempt, status: 'voided' } },
    );
    render(<IntegrityPanel examId='exam-1' canVoid onChanged={() => {}} />);
    expect(await screen.findByText(/Left the page 4 times/u)).toBeTruthy();
    expect(
      screen.getByText(/submission from the first device refused/u),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Void' }));
    const confirm = screen
      .getAllByRole('button', { name: 'Void' })
      .at(-1) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Reason'), '两台设备作答');
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(state.api.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/attempts/attempt-1/integrity-review',
          json: expect.objectContaining({
            decision: 'void',
            reason: '两台设备作答',
          }),
        }),
      ),
    );
  });
});

describe('V3-10 examiner suggestions in grading', () => {
  it('shows the suggestion and adopts it into the score', async () => {
    state.api.request.mockResolvedValue({
      data: [{ ...attempt, status: 'grading', integrity: null }],
    });
    render(<GradingPanel examId='exam-1' onGraded={() => {}} />);
    expect(await screen.findByText('Examiner suggests 20 / 40')).toBeTruthy();
    expect(screen.getByText('用铁钩')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Adopt' }));
    expect(
      (screen.getByLabelText(/40/u, { selector: 'input' }) as HTMLInputElement)
        .value,
    ).toBe('20');
  });
});
