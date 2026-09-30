import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router';

import {
  RecordStatusBadge,
  SummaryStatusBadge,
} from '@/components/talent/attendance/badges';
import type {
  AttendanceInquiry,
  Objection,
} from '@/components/talent/attendance/types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

interface Issues {
  anomalies: {
    recordId?: string;
    employeeId: string;
    name: string;
    departmentId: string;
    date: string;
    status: string;
    lateMinutes: number | null;
    earlyMinutes: number | null;
    /** 人事助理的追问 and where it stands. */
    inquiry?: AttendanceInquiry | null;
    followUp?: 'waitingApproval' | 'needsHr' | 'drafted' | 'replied' | null;
  }[];
  openRequests: {
    kind: string;
    id: string;
    employeeId: string;
    name: string;
    departmentId: string;
    date: string;
  }[];
  overtime: {
    employeeId: string;
    name: string;
    departmentId: string;
    hours: number;
    alertHours: number;
  }[];
  summaries: {
    id: string;
    employeeId: string;
    name: string;
    departmentId: string;
    status: string;
    objection: Objection | null;
  }[];
}

function Section({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {title}
          <Badge variant={count ? 'destructive' : 'secondary'}>{count}</Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {count ? (
          <ul className='divide-y'>{children}</ul>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('attendance.board.issues.none')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** 考勤异常追问: whom the HR assistant asked, and the employee's own reply. */
function InquiryLine({
  inquiry,
}: {
  inquiry?: AttendanceInquiry | null;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!inquiry) return null;
  return (
    <span className='block text-xs text-muted-foreground'>
      {inquiry.channel === 'head'
        ? t('attendanceV2.inquiry.askedHead')
        : t('attendanceV2.inquiry.askedFeishu')}
      {inquiry.reply
        ? ` · ${t('attendanceV2.inquiry.reply', { reply: inquiry.reply })}`
        : inquiry.remindedAt
          ? ` · ${t('attendanceV2.inquiry.reminded')}`
          : ''}
    </span>
  );
}

/** 异常: what 月底核对 gathers — anomalies, open requests, overtime near the limit, unconfirmed summaries. */
export function IssuesTab({
  month,
  departmentId,
  refresh,
}: {
  month: string;
  departmentId: string;
  refresh: string;
}): ReactElement {
  const { t } = useTranslation();
  const lookups = useLookups();
  const remote = useRemote<Issues>('talent/attendance/issues', {
    month,
    departmentId: departmentId || undefined,
    refresh,
  });
  if (remote.error && !remote.data)
    return <LoadError error={remote.error} onRetry={remote.reload} />;
  if (!remote.data) return <BlockSkeleton rows={6} />;
  const data = remote.data;
  const where = (id: string) => lookups.departmentTitle(id);
  return (
    <div className='grid gap-4 lg:grid-cols-2'>
      {remote.loading ? <Spinner aria-label={t('status.loading')} /> : null}
      <Section
        title={t('attendance.board.issues.anomalies')}
        description={t('attendance.board.issues.anomaliesDescription')}
        count={data.anomalies.length}
      >
        {data.anomalies.map((row) => (
          <li
            key={`${row.employeeId}:${row.date}`}
            className='flex flex-wrap items-center justify-between gap-2 py-2 text-sm'
          >
            <span className='min-w-0'>
              <span className='font-medium'>{row.name}</span>
              <span className='text-muted-foreground'>
                {' '}
                · {where(row.departmentId)} · {row.date}
              </span>
              <InquiryLine inquiry={row.inquiry} />
            </span>
            <span className='flex flex-wrap items-center gap-2'>
              <RecordStatusBadge status={row.status} />
              {row.followUp ? (
                <Badge
                  variant={
                    row.followUp === 'needsHr' ? 'destructive' : 'outline'
                  }
                >
                  {t(`attendanceV2.inquiry.followUp.${row.followUp}`)}
                </Badge>
              ) : null}
              {row.lateMinutes ? (
                <span className='text-muted-foreground'>
                  {t('attendance.board.issues.lateMinutes', {
                    minutes: row.lateMinutes,
                  })}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </Section>
      <Section
        title={t('attendance.board.issues.openRequests')}
        description={t('attendance.board.issues.openRequestsDescription')}
        count={data.openRequests.length}
      >
        {data.openRequests.map((row) => (
          <li
            key={`${row.kind}:${row.id}`}
            className='flex flex-wrap items-center justify-between gap-2 py-2 text-sm'
          >
            <span>
              <span className='font-medium'>{row.name}</span>
              <span className='text-muted-foreground'>
                {' '}
                · {where(row.departmentId)} · {row.date}
              </span>
            </span>
            {row.kind === 'leave' ? (
              <Link
                className='text-primary underline-offset-4 hover:underline'
                to={`/talent/approvals/leave/${encodeURIComponent(row.id)}`}
              >
                {t('attendance.adjustments.types.leave')}
              </Link>
            ) : (
              <Link
                className='text-primary underline-offset-4 hover:underline'
                to={{
                  pathname: `/talent/approvals/adjustments/${encodeURIComponent(row.id)}`,
                  search: `?tab=${encodeURIComponent(row.kind)}&view=scope`,
                }}
              >
                {t(`attendance.adjustments.types.${row.kind}`)}
              </Link>
            )}
          </li>
        ))}
      </Section>
      <Section
        title={t('attendance.board.issues.overtime')}
        description={t('attendance.board.issues.overtimeDescription')}
        count={data.overtime.length}
      >
        {data.overtime.map((row) => (
          <li
            key={row.employeeId}
            className='flex flex-wrap items-center justify-between gap-2 py-2 text-sm'
          >
            <span>
              <span className='font-medium'>{row.name}</span>
              <span className='text-muted-foreground'>
                {' '}
                · {where(row.departmentId)}
              </span>
            </span>
            <span>
              {t('attendance.board.issues.overtimeValue', {
                hours: row.hours,
                limit: row.alertHours,
              })}
            </span>
          </li>
        ))}
      </Section>
      <Section
        title={t('attendance.board.issues.summaries')}
        description={t('attendance.board.issues.summariesDescription')}
        count={data.summaries.length}
      >
        {data.summaries.map((row) => (
          <li
            key={row.id}
            className='flex flex-wrap items-center justify-between gap-2 py-2 text-sm'
          >
            <span>
              <span className='font-medium'>{row.name}</span>
              <span className='text-muted-foreground'>
                {' '}
                · {where(row.departmentId)}
              </span>
            </span>
            <span className='flex items-center gap-2'>
              <SummaryStatusBadge status={row.status} />
              {row.objection && !row.objection.handledBy ? (
                <Badge variant='destructive'>
                  {t('attendance.board.objectionOpen')}
                </Badge>
              ) : null}
            </span>
          </li>
        ))}
      </Section>
    </div>
  );
}
