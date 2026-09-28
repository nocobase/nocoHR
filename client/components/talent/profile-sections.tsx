import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { EmployeeProfile } from './types.js';
import { str as toText } from './text.js';

function str(value: unknown): string {
  return value == null || value === '' ? '—' : toText(value);
}

function Range({ start, end }: { start: unknown; end: unknown }): ReactElement {
  return (
    <span className='text-muted-foreground tabular-nums'>
      {str(start)} – {value(end)}
    </span>
  );
}
function value(v: unknown): string {
  return v == null || v === '' ? '' : toText(v);
}

/** Education, experience and emergency contacts; read-only presentation shared by several pages. */
export function ProfileSections({
  profile,
  actions,
}: {
  profile: EmployeeProfile;
  actions?: (
    kind: 'educations' | 'experiences' | 'emergencyContacts',
    item: Record<string, unknown> | null,
  ) => ReactElement | null;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle>{t('talent.profile.educations')}</CardTitle>
          {actions?.('educations', null)}
        </CardHeader>
        <CardContent className='space-y-3'>
          {profile.educations.length ? (
            profile.educations.map((item) => (
              <div
                key={String(item.id)}
                className='flex items-start justify-between gap-3 text-sm'
              >
                <div className='min-w-0'>
                  <p className='font-medium'>{str(item.school)}</p>
                  <p className='text-muted-foreground'>
                    {t(`talent.degree.${String(item.degree)}`)}
                    {item.major ? ` · ${str(item.major)}` : ''}
                  </p>
                  <Range start={item.startDate} end={item.endDate} />
                </div>
                {actions?.('educations', item)}
              </div>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('talent.common.none')}
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle>{t('talent.profile.experiences')}</CardTitle>
          {actions?.('experiences', null)}
        </CardHeader>
        <CardContent className='space-y-3'>
          {profile.experiences.length ? (
            profile.experiences.map((item) => (
              <div
                key={String(item.id)}
                className='flex items-start justify-between gap-3 text-sm'
              >
                <div className='min-w-0'>
                  <p className='font-medium'>
                    {str(item.company)}
                    {item.title ? ` · ${str(item.title)}` : ''}
                  </p>
                  <Range start={item.startDate} end={item.endDate} />
                  {item.description ? (
                    <p className='text-muted-foreground'>
                      {str(item.description)}
                    </p>
                  ) : null}
                </div>
                {actions?.('experiences', item)}
              </div>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('talent.common.none')}
            </p>
          )}
        </CardContent>
      </Card>
      {profile.can.viewContacts ? (
        <Card>
          <CardHeader className='flex flex-row items-center justify-between'>
            <CardTitle>{t('talent.profile.emergencyContacts')}</CardTitle>
            {actions?.('emergencyContacts', null)}
          </CardHeader>
          <CardContent className='space-y-3'>
            {profile.emergencyContacts.length ? (
              profile.emergencyContacts.map((item) => (
                <div
                  key={String(item.id)}
                  className='flex items-start justify-between gap-3 text-sm'
                >
                  <div>
                    <p className='font-medium'>
                      {str(item.name)}
                      {item.relation ? (
                        <span className='text-muted-foreground'>
                          {' '}
                          · {str(item.relation)}
                        </span>
                      ) : null}
                    </p>
                    <p className='tabular-nums text-muted-foreground'>
                      {str(item.phone)}
                    </p>
                  </div>
                  {actions?.('emergencyContacts', item)}
                </div>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('talent.common.none')}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
