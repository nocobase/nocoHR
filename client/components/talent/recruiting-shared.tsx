/**
 * V2-07 招聘: components the recruiting pages share — status badges, requirement lists with their
 * origin, the screening suggestion card, approval steps and a people picker.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import type { Requirement, Step, Suggestion } from './recruiting-lib';

const TONE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  high: 'default',
  medium: 'secondary',
  low: 'outline',
  rejected: 'destructive',
  declined: 'destructive',
  expired: 'destructive',
  cancelled: 'outline',
  withdrawn: 'outline',
  noShow: 'destructive',
  hired: 'default',
  accepted: 'default',
  published: 'default',
  open: 'default',
  calculated: 'secondary',
  noGap: 'outline',
};

export function StatusBadge({
  kind,
  value,
}: {
  kind: string;
  value: string | null | undefined;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!value) return null;
  return (
    <Badge variant={TONE[value] ?? 'secondary'}>
      {t(`recruiting.status.${kind}.${value}`, { defaultValue: value })}
    </Badge>
  );
}

export function MatchBadge({
  level,
}: {
  level: string | null | undefined;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!level) return null;
  return (
    <Badge variant={TONE[level] ?? 'secondary'}>
      {t(`recruiting.labels.match.${level}`)}
    </Badge>
  );
}

export function RequirementList({
  requirements,
}: {
  requirements: readonly Requirement[];
}): ReactElement {
  const { t } = useTranslation();
  return (
    <ul className='space-y-2'>
      {requirements.map((r) => (
        <li key={r.key} className='flex flex-wrap items-center gap-2 text-sm'>
          <span className='font-mono text-xs text-muted-foreground'>
            {r.key}
          </span>
          <span>{r.text}</span>
          <Badge variant={r.mustHave ? 'default' : 'outline'}>
            {r.mustHave
              ? t('recruiting.common.mustHave')
              : t('recruiting.common.optional')}
          </Badge>
          <Badge variant='secondary'>
            {t(`recruiting.labels.origin.${r.origin}`)}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

export function SuggestionCard({
  suggestion,
  requirements,
}: {
  suggestion: Suggestion | null;
  requirements: readonly Requirement[];
}): ReactElement {
  const { t } = useTranslation();
  const text = (key: string) =>
    requirements.find((r) => r.key === key)?.text ?? key;
  const reason = (key: string) =>
    suggestion?.reasons.find((r) => r.key === key)?.text;
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {t('recruiting.candidates.suggestion')}
          <MatchBadge level={suggestion?.matchLevel} />
        </CardTitle>
        {!suggestion ? (
          <CardDescription>
            {t('recruiting.candidates.suggestionPending')}
          </CardDescription>
        ) : null}
      </CardHeader>
      {suggestion ? (
        <CardContent className='grid gap-4 md:grid-cols-3'>
          {(['met', 'missing', 'toVerify'] as const).map((group) => (
            <div key={group} className='space-y-2'>
              <p className='text-sm font-medium'>
                {t(`recruiting.candidates.${group}`)}
              </p>
              <ul className='space-y-1 text-sm'>
                {suggestion[group].map((key) => (
                  <li key={key}>
                    <span>{text(key)}</span>
                    {reason(key) ? (
                      <span className='block text-xs text-muted-foreground'>
                        {reason(key)}
                      </span>
                    ) : null}
                  </li>
                ))}
                {!suggestion[group].length ? (
                  <li className='text-muted-foreground'>
                    {t('recruiting.common.none')}
                  </li>
                ) : null}
              </ul>
            </div>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}

export function ApprovalList({
  steps,
}: {
  steps: readonly Step[];
}): ReactElement {
  const { t } = useTranslation();
  return (
    <ol className='space-y-2 text-sm'>
      {steps.map((s) => (
        <li key={s.level} className='flex flex-wrap items-center gap-2'>
          <span className='text-muted-foreground'>{s.level}.</span>
          <span>{s.name ?? t(`recruiting.labels.kind.${s.kind}`)}</span>
          {s.approverNames?.length ? (
            <span className='text-muted-foreground'>
              {s.approverNames.slice(0, 3).join('、')}
            </span>
          ) : null}
          <StatusBadge kind='step' value={s.status} />
          {s.comment ? (
            <span className='text-muted-foreground'>“{s.comment}”</span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/** People with an account, for interviewers and recruiters. */
export function PeoplePicker({
  value,
  onChange,
  recruitersOnly = false,
  single = false,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  recruitersOnly?: boolean;
  single?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const people = useRemote<
    { userId: string; name: string; recruiter: boolean }[]
  >('talent/recruiting/people', search ? { search } : undefined);
  const items = (people.data ?? []).filter(
    (p) => !recruitersOnly || p.recruiter,
  );
  return (
    <div className='space-y-2'>
      <input
        className='h-8 w-full rounded-md border border-input bg-background px-2 text-sm'
        placeholder={t('recruiting.common.search')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className='max-h-40 space-y-1 overflow-y-auto'>
        {items.map((p) => (
          <label key={p.userId} className='flex items-center gap-2 text-sm'>
            <Checkbox
              checked={value.includes(p.userId)}
              onCheckedChange={(checked) =>
                onChange(
                  single
                    ? checked
                      ? [p.userId]
                      : []
                    : checked
                      ? [...value, p.userId]
                      : value.filter((v) => v !== p.userId),
                )
              }
            />
            {p.name}
          </label>
        ))}
      </div>
    </div>
  );
}
