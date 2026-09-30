import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
  useLocale: () => ({ locale: 'zh-CN' }),
}));

import { NineBox, type NineBoxCard } from '../../client/components/talent/talent-review-nine-box';

const card = (overrides: Partial<NineBoxCard>): NineBoxCard => ({
  id: 'p1',
  employeeName: '王磊',
  departmentTitle: '机加工车间',
  performanceRating: 'A',
  performanceBand: 3,
  potentialBand: 3,
  box: 9,
  aiSuggestion: { suggestedBox: 9 },
  decidedAt: null,
  ...overrides,
});

describe('NineBox', () => {
  it('shows the cards in their boxes, the rating and the unplaced people', () => {
    render(
      <NineBox
        placements={[card({}), card({ id: 'p2', employeeName: '钱进', box: null, performanceRating: 'B' })]}
        canPlace={false}
        onMove={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const box9 = document.querySelector('[data-box="9"]')!;
    expect(box9.textContent).toContain('王磊');
    expect(box9.textContent).toContain('A');
    expect(screen.getByText(/talentReview.nineBox.unplaced/u).textContent).toContain('"count":1');
    expect(screen.getByRole('button', { name: /钱进/u })).toBeTruthy();
  });

  it('a drop on another box asks the parent to move (the parent asks for the reason)', () => {
    const onMove = vi.fn();
    render(<NineBox placements={[card({})]} canPlace onMove={onMove} onOpen={vi.fn()} />);
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
    };
    fireEvent.dragStart(screen.getByRole('button', { name: /王磊/u }), { dataTransfer });
    const box8 = document.querySelector('[data-box="8"]')!;
    fireEvent.dragOver(box8, { dataTransfer });
    fireEvent.drop(box8, { dataTransfer });
    expect(onMove).toHaveBeenCalledWith('p1', 8);
    // Dropping on the same box moves nothing.
    fireEvent.drop(document.querySelector('[data-box="9"]')!, { dataTransfer });
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('marks a card whose pre-placement differs from its box', () => {
    render(
      <NineBox placements={[card({ box: 8, aiSuggestion: { suggestedBox: 9 } })]} canPlace={false} onMove={vi.fn()} onOpen={vi.fn()} />,
    );
    expect(screen.getByTitle('talentReview.nineBox.suggested').textContent).toContain('9');
  });
});
