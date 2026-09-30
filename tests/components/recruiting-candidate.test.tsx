import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../client/locales/en-US';

// V2-07 候选人详情: the suggestion card lists met / not met / to verify by requirement, an unmet knockout answer is
// flagged only, contact data is hidden from a hiring manager, and a rejection cannot be saved without naming the
// requirements it rests on.
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

import CandidateDetail from '../../client/pages/talent/recruiting/candidates/detail';

const REQUIREMENTS = [
  {
    key: 'c1',
    type: 'education',
    text: '中专或技校及以上',
    mustHave: true,
    origin: 'checklist',
  },
  {
    key: 'c4',
    type: 'other',
    text: '能适应三班倒',
    mustHave: true,
    origin: 'checklist',
  },
  {
    key: 'r1',
    type: 'skill',
    text: '能够完成首件检验',
    mustHave: false,
    origin: 'responsibilities',
  },
];

function detail(can: Record<string, boolean>, contact = false) {
  return {
    id: 'app-1',
    stage: 'applied',
    submitCount: 1,
    knockoutUnmet: true,
    knockoutAnswers: [{ key: 'q1', answer: 'no', meetsExpected: false }],
    screeningSuggestion: {
      matchLevel: 'low',
      met: ['c1'],
      missing: ['c4'],
      toVerify: ['r1'],
      reasons: [{ key: 'c4', text: '门槛问题回答“不能”' }],
    },
    messages: [],
    stageHistory: [
      {
        from: null,
        to: 'applied',
        by: 'candidate',
        at: '2026-09-29T02:00:00.000Z',
      },
    ],
    interviews: [],
    offers: [],
    customFieldDefinitions: [],
    candidate: {
      id: 'cand-1',
      name: '邱明',
      phone: contact ? '13900007201' : null,
      email: contact ? 'qiuming@qiheng.test' : null,
      resumeAvailable: contact,
      parsedProfile: {
        education: [],
        experiences: [],
        skills: ['装配'],
        certificates: [],
      },
      parseStatus: 'parsed',
      sourceChannel: 'careersPage',
      consentAt: '2026-09-29T02:00:00.000Z',
      retentionUntil: '2028-09-29',
      customFields: {},
    },
    posting: {
      id: 'p1',
      title: 'CNC 操作工',
      requirements: REQUIREMENTS,
      knockoutQuestions: [{ key: 'q1', question: '能否接受三班倒？' }],
    },
    requisition: { id: 'r1', departmentTitle: '成都机加工车间' },
    can: {
      manage: false,
      decide: false,
      contact,
      anonymize: false,
      schedule: false,
      offer: false,
      ...can,
    },
  };
}

function renderAt() {
  return render(
    <MemoryRouter initialEntries={['/talent/candidates/app-1']}>
      <Routes>
        <Route
          path='/talent/candidates/:applicationId'
          element={<CandidateDetail />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => state.request.mockReset());

describe('CandidateDetail', () => {
  it('shows the suggestion by requirement and flags the knockout answer; a manager sees no contact data', async () => {
    state.request.mockResolvedValue({ data: detail({}) });
    renderAt();
    await screen.findByText(en.recruiting.candidates.suggestion);
    expect(
      screen.getAllByText(en.recruiting.candidates.knockoutUnmet).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('门槛问题回答“不能”')).toBeTruthy();
    expect(
      screen.getByText(en.recruiting.candidates.contactHidden),
    ).toBeTruthy();
    expect(screen.queryByText(/13900007201/u)).toBeNull();
    expect(screen.queryByText(en.recruiting.candidates.decide)).toBeNull();
  });

  it('requires the requirements a rejection rests on', async () => {
    state.request.mockResolvedValue({
      data: detail({ decide: true, manage: true }, true),
    });
    renderAt();
    await screen.findByText(en.recruiting.candidates.decision);
    expect(screen.getByText(/13900007201/u)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(en.recruiting.candidates.decision), {
      target: { value: 'reject' },
    });
    const save = screen.getByRole('button', {
      name: en.recruiting.candidates.decide,
    });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: '能适应三班倒' }));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() =>
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/recruiting/candidates/app-1/decide',
          json: {
            decision: 'reject',
            rejectRequirementKeys: ['c4'],
            rejectNote: null,
          },
        }),
      ),
    );
  });
});
