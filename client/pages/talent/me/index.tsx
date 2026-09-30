import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ClockIcon,
  MessageCircleIcon,
  PencilIcon,
  ReceiptTextIcon,
} from 'lucide-react';
import { useEffect, useReducer, useState, type ReactElement } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { AssessmentHistory } from '@/components/talent/assessment-history';
import { useCompetencyView } from '@/components/talent/competency-types';
import { EmployeeTargetGaps } from '@/components/talent/competency-view';
import { ContractTable } from '@/components/talent/contract-table';
import { LicensedCertificateGrants } from '@/components/talent/licensed-certificate-grants';
import { AgentConnectCard } from '@/components/talent/talent-review-agent-connect';
import { MyPerformanceResultsCard } from '@/components/talent/performance-results';
import { BusinessTimeline } from '@/components/talent/profile/business-timeline';
import { ProfileSummaryCard } from '@/components/talent/profile/profile-summary-card';
import { EmployeeBasics } from '@/components/talent/employee-info';
import { EventTimeline } from '@/components/talent/event-timeline';
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
  JobEvent,
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
// V2-05: 考勤与假期 lives in its own folder; this page only places it.
import { MyAttendanceSection } from './attendance/section.js';
// V1-04: 通知设置 lives in its own folder; this page only places it.
import { NotificationSettingsCard } from './notifications/section.js';

/** 我的档案 — the signed-in employee's own record, requirements, gaps and history. */
export default function MyProfilePage(): ReactElement {
  const { t } = useTranslation();
  const me = useRemote<EmployeeDetail | null>('talent/me');
  const canAsk = useCan({
    resource: { type: 'composite', id: 'talent.hrAssistant' },
    action: 'use',
  });
  const lookups = useLookups();
  const [leaveRevision, reloadLeaveRequests] = useReducer(
    (n: number) => n + 1,
    0,
  );

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
        leaveRevision={leaveRevision}
      />
    );

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.me.title')}
        description={t('talent.me.description')}
        actions={
          canAsk.can && me.data ? (
            <Button
              variant='outline'
              nativeButton={false}
              render={<Link to='assistant' />}
            >
              <MessageCircleIcon data-icon='inline-start' />
              {t('talent.me.askAssistant')}
            </Button>
          ) : null
        }
      />
      {body}
      <Outlet context={{ reloadLeaveRequests }} />
    </PageContainer>
  );
}

function MyProfileBody({
  detail,
  departmentTitle,
  onChanged,
  leaveRevision,
}: {
  detail: EmployeeDetail;
  departmentTitle: string;
  onChanged: () => void;
  leaveRevision: number;
}): ReactElement {
  const { t } = useTranslation();
  const id = encodeURIComponent(detail.employee.id);
  // The V3-08 能力 view: the same rows plus `assessed`, so 未评定 shows.
  const gaps = useCompetencyView(detail.employee.id);
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
  const allowedFields = useRemote<string[]>('talent/me/profile-change/fields');
  const events = useRemote<JobEvent[]>(`talent/employees/${id}/events`);
  const canRequest = useCan({
    resource: { type: 'composite', id: 'talent.profileChange' },
    action: 'request',
  });
  const location = useLocation();
  // 自助 (V1-04) links here with `?change=1` to open 申请修改信息, and with `#contracts` / `#events` for those cards.
  const [changeOpen, setChangeOpen] = useState(
    () => new URLSearchParams(location.search).get('change') === '1',
  );
  const hash = location.hash.slice(1);
  const hashReady =
    (hash === 'contracts' && Boolean(contracts.data)) ||
    (hash === 'events' && Boolean(events.data));
  useEffect(() => {
    if (!hashReady) return;
    window.document
      .getElementById(hash)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hash, hashReady]);
  const pending = change.data?.status === 'pending';
  const recommendations = useGapRecommendations(
    detail.employee.id,
    gaps.data?.rows,
    { self: true },
  );

  return (
    <>
      <MyAttendanceSection
        employeeId={detail.employee.id}
        leaveRevision={leaveRevision}
      />
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
          {canRequest.can && profile.data && allowedFields.data?.length ? (
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
      {/* V4-14 持证上岗: what the signed-in employee's valid certificates let them operate. */}
      <LicensedCertificateGrants />

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

      <EmployeeTargetGaps employeeId={detail.employee.id} />

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

      {/* V4-12 绩效: the signed-in employee's released results. */}
      <MyPerformanceResultsCard />

      {/* V3-11 画像: the AI summary with evidence and the business-data timeline; `me` is scoped to oneself. */}
      <ProfileSummaryCard employeeId='me' />
      <BusinessTimeline employeeId='me' />

      {/* V4-13 连接 AI 助手: connect the employee's own AI assistant. */}
      <AgentConnectCard />

      {/* V2-06 工资条: its own page asks for the password again; #payslips lands here. */}
      <PayslipsCard />

      <div className='grid gap-4 lg:grid-cols-2'>
        {detail.can.viewContracts ? (
          <Card id='contracts' className='scroll-mt-4'>
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

      <Card id='events' className='scroll-mt-4'>
        <CardHeader>
          <CardTitle>{t('talent.me.events')}</CardTitle>
        </CardHeader>
        <CardContent>
          {events.error ? (
            <LoadError error={events.error} onRetry={events.reload} />
          ) : !events.data ? (
            <BlockSkeleton rows={2} />
          ) : (
            // No links to the actions: employees cannot open that page.
            <EventTimeline events={events.data} />
          )}
        </CardContent>
      </Card>
      <NotificationSettingsCard />

      {recommendations.dialog}
      {profile.data ? (
        <ProfileChangeDialog
          open={changeOpen}
          onOpenChange={setChangeOpen}
          employee={detail.employee}
          profile={profile.data}
          fields={allowedFields.data ?? []}
          onSubmitted={() => {
            change.reload();
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

function PayslipsCard(): ReactElement | null {
  const { t } = useTranslation();
  const open = useCan({
    resource: { type: 'page', id: 'talent.myPayslips' },
    action: 'access',
  });
  if (!open.can) return null;
  return (
    <Card id='payslips' className='scroll-mt-4'>
      <CardHeader>
        <CardTitle>{t('talent.me.payslips')}</CardTitle>
        <CardDescription>{t('talent.me.payslipsDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant='outline'
          nativeButton={false}
          render={<Link to='/talent/my-payslips' />}
        >
          <ReceiptTextIcon data-icon='inline-start' />
          {t('talent.me.openPayslips')}
        </Button>
      </CardContent>
    </Card>
  );
}
