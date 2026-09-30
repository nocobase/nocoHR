/**
 * V4-13 岗位体系 · 版本 Tab (mounted in client/pages/talent/framework): the
 * current version, the draft compared with it (changed levels highlighted),
 * the impact preview (new gaps and who, requirements no longer asked), the
 * framework advisor's change note (editable), publishing (hr.admin), the
 * read-only history, and the requirements in effect on a date.
 */
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { BlockSkeleton, LoadError } from './states.js';
import { formatDate, useTrAction } from './talent-review-lib.js';
import { TrStatusBadge } from './talent-review-shared.js';
import { useRemote } from './use-remote.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

interface Item {
  competencyId: string;
  competency: string;
  requiredLevel: number;
  mandatory: boolean;
}
export interface ModelVersion {
  id: string;
  versionNo: number;
  snapshot: Item[];
  status: string;
  effectiveFrom: string | null;
  changeNote: string | null;
  changeNoteSource: string | null;
  impactPreview: {
    newGaps: { count: number; people: { name: string; competency: string; current: number; required: number }[] };
    removed: { competency: string }[];
  } | null;
  publishedByName: string | null;
}
interface Versions {
  current: ModelVersion | null;
  draft: ModelVersion | null;
  history: ModelVersion[];
  can: { draft: boolean; publish: boolean };
}

export function ModelVersionsPanel({ positionId }: { positionId: string }): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const path = `talent/model-versions/positions/${encodeURIComponent(positionId)}`;
  const versions = useRemote<Versions>(path);
  const action = useTrAction();
  const [edits, setEdits] = useState<Record<string, { requiredLevel: number; mandatory: boolean }> | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const at = useRemote<{ version: ModelVersion | null }>(date ? `${path}/at` : null, { date });
  if (versions.error) return <LoadError error={versions.error} onRetry={versions.reload} />;
  if (!versions.data) return <BlockSkeleton rows={4} />;
  const { current, draft, history, can } = versions.data;
  const base = draft ?? current;
  const rows = (base?.snapshot ?? []).map((item) => ({
    ...item,
    ...(edits?.[item.competencyId] ?? {}),
    currentLevel: current?.snapshot.find((c) => c.competencyId === item.competencyId)?.requiredLevel ?? null,
  }));
  const saveDraft = async () => {
    const done = await action.run(
      {
        method: 'PUT',
        path: `${path}/draft`,
        json: {
          snapshot: rows.map((r) => ({ competencyId: r.competencyId, requiredLevel: r.requiredLevel, mandatory: r.mandatory })),
          ...(note !== null ? { changeNote: note } : {}),
        },
      },
      t('talentReview.versions.draftSaved'),
    );
    if (done) {
      setEdits(null);
      setNote(null);
      versions.reload();
    }
  };
  return (
    <div className='flex flex-col gap-4'>
      <Card>
        <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-2'>
          <div>
            <CardTitle>
              {draft
                ? t('talentReview.versions.draftTitle', { no: draft.versionNo })
                : t('talentReview.versions.currentTitle', { no: current?.versionNo ?? 1 })}
            </CardTitle>
            <CardDescription>
              {current
                ? t('talentReview.versions.currentLine', {
                    no: current.versionNo,
                    date: formatDate(locale, current.effectiveFrom),
                  })
                : null}
            </CardDescription>
          </div>
          <div className='flex gap-2'>
            {can.draft ? (
              <Button size='sm' variant='outline' disabled={action.busy} onClick={() => void saveDraft()}>
                {draft ? t('talentReview.versions.saveDraft') : t('talentReview.versions.newDraft')}
              </Button>
            ) : null}
            {can.publish && draft ? (
              <Button
                size='sm'
                disabled={action.busy || edits !== null}
                onClick={() => { void (async () => {
                  const done = await action.run(
                    {
                      method: 'POST',
                      path: `talent/model-versions/${encodeURIComponent(draft.id)}/publish`,
                      json: note !== null ? { changeNote: note } : {},
                    },
                    t('talentReview.versions.published'),
                  );
                  if (done) versions.reload();
                })(); }}
              >
                {t('talentReview.versions.publish')}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('talentReview.versions.competency')}</TableHead>
                  <TableHead>{t('talentReview.versions.current')}</TableHead>
                  <TableHead>{t('talentReview.versions.required')}</TableHead>
                  <TableHead>{t('talentReview.versions.mandatory')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.competencyId}>
                    <TableCell>{r.competency}</TableCell>
                    <TableCell className='tabular-nums'>{r.currentLevel ?? '—'}</TableCell>
                    <TableCell>
                      <Input
                        type='number'
                        min={1}
                        max={10}
                        className={r.currentLevel !== r.requiredLevel ? 'w-20 border-primary' : 'w-20'}
                        aria-label={t('talentReview.versions.requiredFor', { competency: r.competency })}
                        disabled={!can.draft}
                        value={r.requiredLevel}
                        onChange={(e) =>
                          setEdits((x) => ({
                            ...(x ?? {}),
                            [r.competencyId]: { requiredLevel: Number(e.target.value) || 1, mandatory: r.mandatory },
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Switch
                        aria-label={t('talentReview.versions.mandatoryFor', { competency: r.competency })}
                        disabled={!can.draft}
                        checked={r.mandatory}
                        onCheckedChange={(value) =>
                          setEdits((x) => ({
                            ...(x ?? {}),
                            [r.competencyId]: { requiredLevel: r.requiredLevel, mandatory: value },
                          }))
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {draft?.impactPreview ? (
            <Alert>
              <AlertDescription className='flex flex-col gap-1'>
                <span className='font-medium'>
                  {t('talentReview.versions.impact', { count: draft.impactPreview.newGaps.count })}
                </span>
                {draft.impactPreview.newGaps.people.map((p) => (
                  <span key={`${p.name}-${p.competency}`}>
                    {t('talentReview.versions.impactLine', { name: p.name, competency: p.competency, current: p.current, required: p.required })}
                  </span>
                ))}
                {draft.impactPreview.removed.length ? (
                  <span>
                    {t('talentReview.versions.removed', {
                      list: draft.impactPreview.removed.map((r) => r.competency).join('、'),
                    })}
                  </span>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          {draft ? (
            <div className='flex flex-col gap-1'>
              <span className='flex items-center gap-2 text-sm font-medium'>
                {t('talentReview.versions.changeNote')}
                {draft.changeNoteSource ? (
                  <Badge variant='outline'>{t(`talentReview.card.source.${draft.changeNoteSource}`)}</Badge>
                ) : null}
              </span>
              <Textarea
                aria-label={t('talentReview.versions.changeNote')}
                disabled={!can.draft}
                value={note ?? draft.changeNote ?? ''}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
          ) : null}
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('talentReview.versions.history')}</CardTitle>
        </CardHeader>
        <CardContent className='flex flex-col gap-3'>
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <span>{t('talentReview.versions.onDate')}</span>
            <Input type='date' className='w-44' value={date} aria-label={t('talentReview.versions.onDate')} onChange={(e) => setDate(e.target.value)} />
            {at.data?.version ? (
              <span className='text-muted-foreground'>
                {t('talentReview.versions.onDateResult', { no: at.data.version.versionNo })}{' '}
                {at.data.version.snapshot.map((s) => `${s.competency} ${s.requiredLevel}`).join('、')}
              </span>
            ) : null}
          </div>
          {history.length ? (
            history.map((v) => (
              <div key={v.id} className='flex flex-wrap items-center gap-2 text-sm'>
                <TrStatusBadge status={v.status} />
                <span className='font-medium'>{t('talentReview.versions.versionNo', { no: v.versionNo })}</span>
                <span className='text-muted-foreground'>{formatDate(locale, v.effectiveFrom)}</span>
                <span className='text-muted-foreground'>
                  {v.snapshot.map((s) => `${s.competency} ${s.requiredLevel}`).join('、')}
                </span>
              </div>
            ))
          ) : (
            <p className='text-muted-foreground text-sm'>{t('talentReview.versions.noHistory')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
