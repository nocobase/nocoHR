import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface Dossier {
  readonly employeeName: string;
  readonly positionTitle: string;
  readonly certificateNo: string;
  readonly text: string;
  readonly fallback: boolean;
  readonly gap: {
    then: number;
    now: number;
    items: {
      competency: string;
      required: number;
      then: number;
      now: number;
    }[];
  };
  readonly courses: string[];
  readonly plansApproved: number;
  readonly exams: { title: string; score: number | null; passed: boolean }[];
  readonly practice: { count: number; average: number | null };
  readonly promotionLink: string;
}

/**
 * V3-10 任职准备材料: what the certification steward prepared when someone
 * obtained a 任职资格认证 for their target position. The head decides; the
 * link opens a pre-filled promotion form, nothing is started automatically.
 */
export function QualificationDossier({
  certificateId,
}: {
  certificateId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const dossier = useRemote<Dossier | null>(
    `talent/certificates/${encodeURIComponent(certificateId)}/qualification-dossier`,
  );
  if (dossier.error)
    return <LoadError error={dossier.error} onRetry={dossier.reload} />;
  if (!dossier.data) return null;
  const d = dossier.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2'>
          {t('talent.qualification.dossierTitle', {
            name: d.employeeName,
            position: d.positionTitle,
          })}
          {d.fallback ? (
            <Badge variant='outline'>
              {t('talent.qualification.template')}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>{d.certificateNo}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4 text-sm'>
        <p className='whitespace-pre-wrap'>{d.text}</p>
        <div>
          <p className='font-medium'>
            {t('talent.qualification.gap', {
              then: d.gap.then,
              now: d.gap.now,
            })}
          </p>
          <ul className='mt-1 space-y-0.5 text-muted-foreground'>
            {d.gap.items.map((g) => (
              <li key={g.competency}>{t('talent.qualification.gapItem', g)}</li>
            ))}
          </ul>
        </div>
        {d.courses.length ? (
          <p>
            {t('talent.qualification.courses')}：
            {d.courses.map((c) => `《${c}》`).join('、')}
          </p>
        ) : null}
        {d.exams.length ? (
          <p>
            {t('talent.qualification.exams')}：
            {d.exams.map((e) => `《${e.title}》${e.score ?? '—'}`).join('、')}
          </p>
        ) : null}
        <p>
          {t('talent.qualification.practice', {
            count: d.practice.count,
            average: d.practice.average ?? '—',
          })}
        </p>
        <p className='text-muted-foreground'>
          {t('talent.qualification.decision')}
        </p>
        <Link to={d.promotionLink} className={buttonVariants({ size: 'sm' })}>
          {t('talent.qualification.promote')}
        </Link>
      </CardContent>
    </Card>
  );
}
