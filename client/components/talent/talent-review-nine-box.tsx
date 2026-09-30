/**
 * V4-13 九宫格: nine boxes (potential up, performance right). Each card shows
 * the final rating, the potential band and whether the talent analyst's
 * pre-placement differs. With `canPlace`, a card can be dragged to another
 * box (or moved from its menu on touch screens); the parent asks for the
 * reason before anything is saved.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { SparklesIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

import { BOX_ROWS } from './talent-review-lib.js';

export interface NineBoxCard {
  id: string;
  employeeName: string;
  departmentTitle: string;
  performanceRating: string | null;
  performanceBand: number | null;
  potentialBand: number | null;
  box: number | null;
  aiSuggestion: { suggestedBox: number | null } | null;
  decidedAt: string | null;
}

export function NineBox({
  placements,
  canPlace,
  onMove,
  onOpen,
}: {
  placements: readonly NineBoxCard[];
  canPlace: boolean;
  onMove: (placementId: string, box: number) => void;
  onOpen: (placementId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const unplaced = placements.filter((p) => !p.box);
  const card = (p: NineBoxCard) => (
    <button
      key={p.id}
      type='button'
      draggable={canPlace}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', p.id);
        setDragging(p.id);
      }}
      onDragEnd={() => setDragging(null)}
      onClick={() => onOpen(p.id)}
      className={cn(
        'bg-card hover:bg-accent flex w-full flex-col items-start gap-1 rounded-md border px-2 py-1.5 text-start text-sm shadow-xs',
        dragging === p.id && 'opacity-50',
        canPlace && 'cursor-grab',
      )}
      aria-label={t('talentReview.nineBox.cardLabel', { name: p.employeeName })}
    >
      <span className='flex w-full items-center justify-between gap-1'>
        <span className='truncate font-medium'>{p.employeeName}</span>
        {p.performanceRating ? (
          <Badge variant='outline'>{p.performanceRating}</Badge>
        ) : null}
      </span>
      <span className='text-muted-foreground flex items-center gap-1 text-xs'>
        {t('talentReview.nineBox.bands', {
          performance: p.performanceBand ?? '—',
          potential: p.potentialBand ?? '—',
        })}
        {p.aiSuggestion?.suggestedBox && p.aiSuggestion.suggestedBox !== p.box ? (
          <span className='inline-flex items-center gap-0.5' title={t('talentReview.nineBox.suggested')}>
            <SparklesIcon className='size-3' />
            {p.aiSuggestion.suggestedBox}
          </span>
        ) : null}
        {p.decidedAt ? <span>· {t('talentReview.nineBox.decided')}</span> : null}
      </span>
    </button>
  );
  return (
    <div className='flex flex-col gap-3'>
      <div className='grid grid-cols-[auto_1fr] gap-2'>
        <div className='text-muted-foreground flex items-center text-xs [writing-mode:vertical-rl]'>
          {t('talentReview.nineBox.potentialAxis')}
        </div>
        <div className='grid grid-cols-3 gap-2'>
          {BOX_ROWS.flat().map((box) => {
            const cards = placements.filter((p) => p.box === box);
            return (
              <div
                key={box}
                data-box={box}
                onDragOver={(event) => {
                  if (!canPlace) return;
                  event.preventDefault();
                  setOver(box);
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  setOver(null);
                  const id = event.dataTransfer.getData('text/plain');
                  const current = placements.find((p) => p.id === id);
                  if (id && current && current.box !== box) onMove(id, box);
                }}
                className={cn(
                  'bg-muted/40 flex min-h-28 flex-col gap-1.5 rounded-lg border p-2',
                  over === box && 'ring-primary ring-2',
                )}
              >
                <div className='flex items-center justify-between text-xs'>
                  <span className='font-medium'>{t(`talentReview.nineBox.box${box}`)}</span>
                  <span className='text-muted-foreground tabular-nums'>{cards.length}</span>
                </div>
                {cards.map(card)}
              </div>
            );
          })}
        </div>
      </div>
      <div className='text-muted-foreground text-end text-xs'>
        {t('talentReview.nineBox.performanceAxis')}
      </div>
      {unplaced.length ? (
        <div className='flex flex-col gap-2'>
          <div className='text-sm font-medium'>
            {t('talentReview.nineBox.unplaced', { count: unplaced.length })}
          </div>
          <div className='grid grid-cols-2 gap-2 sm:grid-cols-4'>{unplaced.map(card)}</div>
        </div>
      ) : null}
    </div>
  );
}
