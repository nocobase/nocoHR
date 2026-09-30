import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { AwardIcon, BotIcon, PlusIcon } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { AssistantLauncher } from '@/components/talent/ai-chat';
import type { CertificationSummary } from '@/components/talent/exam-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

import { MyExternalCertificates } from './my-external.js';
import { CertificationDialog } from './certification-dialog.js';
import type { CertificationsOutletContext } from './types.js';

/** 认证项目 — programmes employees may earn; HR administrators maintain them and see holders. */
export default function CertificationsPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const list = useRemote<{ items: CertificationSummary[]; canManage: boolean }>(
    'talent/certifications',
  );
  const steward = useCan({
    resource: { type: 'composite', id: 'talent.certificationSteward' },
    action: 'use',
  });
  const [creating, setCreating] = useState(false);
  const context = useMemo<CertificationsOutletContext>(
    () => ({ reload: list.reload }),
    [list.reload],
  );
  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentCertifications')}
        description={t('talent.certifications.description')}
        actions={
          <>
            {steward.can ? (
              <AssistantLauncher
                employee='certificationSteward'
                chatId='steward-certifications'
                label={t('talent.certifications.askSteward')}
                icon={<BotIcon data-icon='inline-start' />}
                task={() => ({
                  title: t('talent.certifications.stewardTitle'),
                  system: 'The user is on the certification programmes page.',
                  user: t('talent.certifications.stewardPrompt'),
                })}
              />
            ) : null}
            {list.data?.canManage ? (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon data-icon='inline-start' />
                {t('talent.certifications.create')}
              </Button>
            ) : null}
          </>
        }
      />
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={3} />
      ) : !list.data.items.length ? (
        <EmptyState title={t('talent.certifications.empty')} />
      ) : (
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
          {list.data.items.map((item) => (
            <Link
              key={item.id}
              to={encodeURIComponent(item.id)}
              className='group rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
            >
              <Card className='h-full transition-colors group-hover:bg-muted/40'>
                <CardContent className='space-y-3'>
                  <div className='flex items-start justify-between gap-2'>
                    <span className='flex items-center gap-2 font-medium'>
                      <AwardIcon className='size-4 text-primary' />
                      {item.title}
                    </span>
                    {!item.active ? (
                      <Badge variant='outline'>
                        {t('talent.common.disabled')}
                      </Badge>
                    ) : item.kind === 'external' ? (
                      <Badge variant='outline'>
                        {t('talent.externalCerts.kinds.external')}
                      </Badge>
                    ) : item.qualifiesPositionTitle ? (
                      <Badge variant='secondary'>
                        {t('talent.qualification.badge', {
                          position: item.qualifiesPositionTitle,
                        })}
                      </Badge>
                    ) : null}
                  </div>
                  {item.description ? (
                    <p className='line-clamp-2 text-sm text-muted-foreground'>
                      {item.description}
                    </p>
                  ) : null}
                  <ul className='space-y-1 text-sm'>
                    {item.courses.map((c) => (
                      <li key={c.id}>
                        ·{' '}
                        {t('talent.certifications.completeCourse', {
                          title: c.title,
                        })}
                      </li>
                    ))}
                    {item.exams.map((e) => (
                      <li key={e.id}>
                        ·{' '}
                        {t('talent.certifications.passExam', {
                          title: e.title,
                        })}
                      </li>
                    ))}
                  </ul>
                  <div className='flex flex-wrap gap-3 text-xs text-muted-foreground'>
                    <span>
                      {item.validityMonths
                        ? t('talent.certifications.validFor', {
                            months: item.validityMonths,
                          })
                        : t('talent.certifications.noExpiry')}
                    </span>
                    <span>
                      {t('talent.certifications.holders', {
                        count: item.holderCount,
                      })}
                    </span>
                    {item.expiringCount ? (
                      <span>
                        {t('talent.externalCerts.expiringCount', {
                          count: item.expiringCount,
                        })}
                      </span>
                    ) : null}
                    {item.issuingAuthority ? (
                      <span>{item.issuingAuthority}</span>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      {/* V3-10 外部证书登记 */}
      <MyExternalCertificates />
      <CertificationDialog
        open={creating}
        onOpenChange={setCreating}
        certification={null}
        onSaved={(id) => {
          list.reload();
          void navigate(encodeURIComponent(id));
        }}
      />
      <Outlet context={context} />
    </PageContainer>
  );
}
