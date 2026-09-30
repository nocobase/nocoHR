import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));

import { EvaluationForm } from '../../client/components/talent/talent-review-evaluation-form';

const QUESTIONS = [
  { key: 'useful', title: '课程内容对我有用', kind: 'scale' as const },
  { key: 'clear', title: '讲解清楚、容易理解', kind: 'scale' as const },
  { key: 'example', title: '请举一个事例', kind: 'text' as const },
];

describe('EvaluationForm', () => {
  it('submits once every question is answered', () => {
    const onSubmit = vi.fn();
    render(<EvaluationForm questions={QUESTIONS} onSubmit={onSubmit} />);
    const submit = screen.getByRole('button', { name: 'talentReview.evaluations.submit' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole('radio', { name: /"value":4/u })[0]!);
    fireEvent.click(screen.getAllByRole('radio', { name: /"value":5/u })[1]!);
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: '请举一个事例' }), {
      target: { value: '按新流程做首件检验' },
    });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ useful: 4, clear: 5, example: '按新流程做首件检验' });
  });

  it('shows an answered questionnaire read-only', () => {
    render(
      <EvaluationForm
        questions={QUESTIONS}
        initial={{ useful: 3, clear: 4, example: '有改进' }}
        disabled
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'talentReview.evaluations.submit' })).toBeNull();
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(2);
  });
});
