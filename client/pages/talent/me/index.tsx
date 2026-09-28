import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { ClockIcon, PencilIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { AssessmentHistory } from '@/components/talent/assessment-history';
import { ContractTable } from '@/components/talent/contract-table';
import { EmployeeBasics } from '@/components/talent/employee-info';
import { useGapRecommendations } from '@/components/talent/gap-recommendations';
import { GapTable } from '@/components/talent/gap-table';
import {
  AbilityRadarCard,
  CertificateWallCard,
  GrowthTimelineCard,
} from '@/components/talent/growth';
import { LearningRecordsCard } from '@/components/talent/learning-records';
import { ProfileSections } from '@/components/talent/profile-sections';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import type {
  AssessmentRow,
  Contract,
  EmployeeDetail,
  EmployeeProfile,
  GapRow,
  ProfileChangeRequest,
} from '@/components/talent/types';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { ProfileChangeDialog } from './profile-change-dialog.js';

/** 我的档案 — the signed-in employee's own record, requirements, gaps and history. */
export default function MyProfilePage(): ReactElement {
  const { t } = useTranslation();
  const me = useRemote<EmployeeDetail | null>('talent/me');
  const lookups = useLookups();

  let body: ReactElement;
  if (me.error) body = <LoadError error={me.error} onRetry={me.reload} />;
  else if (me.data === undefined) body = <BlockSkeleton rows={6} />;
  else if (me.data === null)
    body = (
      <EmptyState
        title={t('talent.me.notLinked')}
        description={t('talent.me.notLinkedDescription')}
      />
    );
  else
    body = (
      <MyProfileBody
        detail={me.data}
        departmentTitle={
          lookups.departmentTitle(me.data.employee.departmentId) ||
          me.data.departmentTitle
        }
        onChanged={me.reload}
      />
    );

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.me.title')}
        description={t('talent.me.description')}
      />
      {body}
    </PageContainer>
  );
}

function MyProfileBody({
  detail,
  departmentTitle,
  onChanged,
}: {
  detail: EmployeeDetail;
  departmentTitle: string;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const id = encodeURIComponent(detail.employee.id);
  const gaps = useRemote<{ rows: GapRow[]; positionTitle: string | null }>(
    `talent/employees/${id}/gaps`,
  );
  const assessments = useRemote<AssessmentRow[]>(
    detail.can.viewAssessments ? `talent/employees/${id}/assessments` : null,
  );
  const profile = useRemote<EmployeeProfile>(
    detail.can.viewProfile || detail.can.viewContacts
      ? `talent/employees/${id}/profile`
      : null,
  );
  const contracts = useRemote<{ items: Contract[] }>(
    detail.can.viewContracts ? 'talent/contracts' : null,
    { employeeId: detail.employee.id },
  );
  const change = useRemote<ProfileChangeRequest | null>(
    'talent/me/profile-change',
  );
  const canRequest = useCan({
    resource: { type: 'composite', id: 'talent.profileChange' },
    action: 'request',
  });
  const [changeOpen, setChangeOpen] = useState(false);
  const pending = change.data?.status === 'pending';
  const recommendations = useGapRecommendations(
    detail.employee.id,
    gaps.data?.rows,
    { self: true },
  );

  return (
    <>
      {pending ? (
        <Alert>
          <ClockIcon />
          <AlertTitle>{t('talent.me.change.pendingTitle')}</AlertTitle>
          <AlertDescription>
            {t('talent.me.change.pendingDescription')}
          </AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardHeader className='flex flex-row items-start justify-between gap-4'>
          <div>
            <CardTitle>{t('talent.me.basic')}</CardTitle>
            <CardDescription>{t('talent.me.basicDescription')}</CardDescription>
          </div>
          {canRequest.can && profile.data ? (
            <Button
              variant='outline'
              size='sm'
              disabled={pending}
              onClick={() => setChangeOpen(true)}
            >
              <PencilIcon data-icon='inline-start' />
              {pending
                ? t('talent.me.change.pendingButton')
                : t('talent.me.change.open')}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <EmployeeBasics
            detail={detail}
            departmentTitle={departmentTitle}
            full
          />
        </CardContent>
      </Card>

      <CertificateWallCard employeeId={detail.employee.id} />

      <div className='grid gap-4 lg:grid-cols-2'>
        <AbilityRadarCard rows={gaps.data?.rows} />
        <LearningRecordsCard employeeId={detail.employee.id} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('talent.me.gaps')}</CardTitle>
          <CardDescription>
            {gaps.data?.positionTitle
              ? t('talent.me.gapsDescription', {
                  position: gaps.data.positionTitle,
                })
              : t('talent.me.noPosition')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {gaps.error ? (
            <LoadError error={gaps.error} onRetry={gaps.reload} />
          ) : !gaps.data ? (
            <BlockSkeleton />
          ) : gaps.data.rows.length ? (
            <GapTable rows={gaps.data.rows} extra={recommendations.extra} />
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('talent.me.noRequirements')}
            </p>
          )}
        </CardContent>
      </Card>

      {detail.can.viewAssessments ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('talent.me.assessments')}</CardTitle>
          </CardHeader>
          <CardContent>
            {assessments.error ? (
              <LoadError
                error={assessments.error}
                onRetry={assessments.reload}
              />
            ) : !assessments.data ? (
              <BlockSkeleton rows={2} />
            ) : (
              <AssessmentHistory rows={assessments.data} />
            )}
          </CardContent>
        </Card>
      ) : null}

      {profile.data ? (
        <ProfileSections profile={profile.data} />
      ) : profile.error ? (
        <LoadError error={profile.error} onRetry={profile.reload} />
      ) : null}

      <div className='grid gap-4 lg:grid-cols-2'>
        {detail.can.viewContracts ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('talent.me.contracts')}</CardTitle>
            </CardHeader>
            <CardContent>
              {contracts.error ? (
                <LoadError error={contracts.error} onRetry={contracts.reload} />
              ) : !contracts.data ? (
                <BlockSkeleton rows={2} />
              ) : (
                <ContractTable rows={contracts.data.items} />
              )}
            </CardContent>
          </Card>
        ) : null}
        <GrowthTimelineCard employeeId={detail.employee.id} />
      </div>

      {recommendations.dialog}
      {profile.data ? (
        <ProfileChangeDialog
          open={changeOpen}
          onOpenChange={setChangeOpen}
          employee={detail.employee}
          profile={profile.data}
          onSubmitted={() => {
            change.reload();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}
