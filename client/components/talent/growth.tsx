import { useLocale, useTranslation } from '@nocobase/i18n/client';
import {
  AwardIcon,
  BookOpenIcon,
  BriefcaseIcon,
  ClipboardCheckIcon,
  GaugeIcon,
  PrinterIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { cn } from '@/lib/utils';

import { CertificateStatusBadge } from './certificate-card.js';
import { printCertificate } from './certificate-print.js';
import type { Certificate } from './exam-types.js';
import { BlockSkeleton, LoadError } from './states.js';
import type { GapRow } from './types.js';
import { useRemote } from './use-remote.js';

interface CertificateWall {
  required: {
    certificationId: string;
    title: string;
    status: 'held' | 'expiring' | 'missing';
    certificateId: string | null;
    expiresAt: string | null;
  }[];
  others: {
    id: string;
    certificationId: string;
    title: string;
    certificateNo: string;
    issuedAt: string;
    expiresAt: string | null;
    status: Certificate['status'];
  }[];
}

interface TimelineEntry {
  kind: 'jobEvent' | 'course' | 'exam' | 'certificate' | 'assessment';
  at: string;
  title: string;
  detail: string | null;
}

function useDate(): (value: string | null) => string {
  const { locale } = useLocale();
  return (value) =>
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
          new Date(value.length === 10 ? `${value}T00:00:00` : value),
        )
      : '—';
}

/** 证书墙: certificates the position requires (held, expiring or missing) and every other certificate on record. */
export function CertificateWallCard({
  employeeId,
}: {
  employeeId: string;
}): ReactElement {
  const { t } = useTranslation();
  const format = useDate();
  const wall = useRemote<CertificateWall>(
    `talent/people/${encodeURIComponent(employeeId)}/certificate-wall`,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talent.growth.certificateWall')}</CardTitle>
        <CardDescription>
          {t('talent.growth.certificateWallDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {wall.error ? (
          <LoadError error={wall.error} onRetry={wall.reload} />
        ) : !wall.data ? (
          <BlockSkeleton rows={2} />
        ) : !wall.data.required.length && !wall.data.others.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('talent.growth.noCertificates')}
          </p>
        ) : (
          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
            {wall.data.required.map((item) => (
              <div
                key={item.certificationId}
                className={cn(
                  'space-y-2 rounded-lg border p-3',
                  item.status === 'missing' && 'border-dashed bg-muted/30',
                )}
              >
                <div className='flex items-start justify-between gap-2'>
                  <Link
                    to={`/talent/certifications/${encodeURIComponent(item.certificationId)}`}
                    className='flex items-center gap-2 text-sm font-medium hover:underline'
                  >
                    <AwardIcon
                      className={cn(
                        'size-4',
                        item.status === 'missing'
                          ? 'text-muted-foreground'
                          : 'text-primary',
                      )}
                    />
                    {item.title}
                  </Link>
                  <Badge
                    variant={
                      item.status === 'missing'
                        ? 'destructive'
                        : item.status === 'expiring'
                          ? 'outline'
                          : 'secondary'
                    }
                  >
                    {t(`talent.growth.requiredStatus.${item.status}`)}
                  </Badge>
                </div>
                <div className='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
                  <span>
                    {item.status === 'missing'
                      ? t('talent.growth.requiredByPosition')
                      : t('talent.growth.expires', {
                          date: format(item.expiresAt),
                        })}
                  </span>
                  {item.certificateId ? (
                    <Button
                      size='icon-xs'
                      variant='ghost'
                      aria-label={t('talent.certifications.print')}
                      onClick={() => printCertificate(item.certificateId!)}
                    >
                      <PrinterIcon />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            {wall.data.others.map((item) => (
              <div key={item.id} className='space-y-2 rounded-lg border p-3'>
                <div className='flex items-start justify-between gap-2'>
                  <span className='flex items-center gap-2 text-sm font-medium'>
                    <AwardIcon className='size-4 text-muted-foreground' />
                    {item.title}
                  </span>
                  <CertificateStatusBadge status={item.status} />
                </div>
                <div className='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
                  <span className='font-mono'>{item.certificateNo}</span>
                  {item.status === 'valid' || item.status === 'expiring' ? (
                    <Button
                      size='icon-xs'
                      variant='ghost'
                      aria-label={t('talent.certifications.print')}
                      onClick={() => printCertificate(item.id)}
                    >
                      <PrinterIcon />
                    </Button>
                  ) : (
                    <span>{format(item.expiresAt)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Ten axes is where a radar stops being readable; beyond that the same data is a bar chart. */
const RADAR_LIMIT = 10;

/**
 * 能力雷达: required against current level per competency. Qualifications are
 * proven by certificates, not graded, so they are left out.
 */
export function AbilityRadarCard({
  rows,
}: {
  rows: readonly GapRow[] | undefined;
}): ReactElement | null {
  const { t } = useTranslation();
  const config = {
    required: { label: t('talent.gap.required'), color: 'var(--chart-2)' },
    current: { label: t('talent.gap.current'), color: 'var(--chart-1)' },
  } satisfies ChartConfig;
  const data = (rows ?? [])
    .filter((row) => row.category !== 'qualification')
    .map((row) => ({
      title: row.title,
      required: row.requiredLevel ?? 0,
      current: row.currentLevel,
    }));
  if (data.length < 3) return null;
  const max = Math.max(5, ...data.map((d) => Math.max(d.required, d.current)));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talent.growth.radar')}</CardTitle>
        <CardDescription>{t('talent.growth.radarDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.length > RADAR_LIMIT ? (
          <ChartContainer config={config} className='h-80 w-full'>
            <BarChart
              data={data}
              layout='vertical'
              margin={{ left: 8, right: 8 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis
                type='number'
                domain={[0, max]}
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                type='category'
                dataKey='title'
                width={96}
                tickLine={false}
                axisLine={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar
                dataKey='required'
                fill='var(--color-required)'
                radius={3}
                isAnimationActive={false}
              />
              <Bar
                dataKey='current'
                fill='var(--color-current)'
                radius={3}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
        ) : (
          <ChartContainer
            config={config}
            className='mx-auto aspect-square max-h-80 w-full'
          >
            <RadarChart data={data} outerRadius='70%'>
              <ChartTooltip content={<ChartTooltipContent />} />
              <PolarGrid />
              <PolarAngleAxis dataKey='title' tick={{ fontSize: 12 }} />
              <PolarRadiusAxis
                domain={[0, max]}
                tick={false}
                axisLine={false}
              />
              <Radar
                dataKey='required'
                stroke='var(--color-required)'
                fill='var(--color-required)'
                fillOpacity={0.1}
                strokeDasharray='4 4'
                isAnimationActive={false}
              />
              <Radar
                dataKey='current'
                stroke='var(--color-current)'
                fill='var(--color-current)'
                fillOpacity={0.35}
                isAnimationActive={false}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </RadarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

const TIMELINE_ICONS = {
  jobEvent: BriefcaseIcon,
  course: BookOpenIcon,
  exam: ClipboardCheckIcon,
  certificate: AwardIcon,
  assessment: GaugeIcon,
} as const;

/** 成长时间线: job changes, completed courses, passed exams, certificates and assessments, newest first. */
export function GrowthTimelineCard({
  employeeId,
}: {
  employeeId: string;
}): ReactElement {
  const { t } = useTranslation();
  const format = useDate();
  const timeline = useRemote<TimelineEntry[]>(
    `talent/people/${encodeURIComponent(employeeId)}/timeline`,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talent.growth.timeline')}</CardTitle>
      </CardHeader>
      <CardContent>
        {timeline.error ? (
          <LoadError error={timeline.error} onRetry={timeline.reload} />
        ) : !timeline.data ? (
          <BlockSkeleton rows={3} />
        ) : !timeline.data.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('talent.growth.noTimeline')}
          </p>
        ) : (
          <ol className='relative space-y-4 border-l pl-5'>
            {timeline.data.map((entry, index) => {
              const Icon = TIMELINE_ICONS[entry.kind];
              const title =
                entry.kind === 'jobEvent'
                  ? t(`talent.actionType.${entry.title}`)
                  : entry.title;
              return (
                <li
                  key={`${entry.kind}-${entry.at}-${index}`}
                  className='relative'
                >
                  <span className='absolute top-0.5 -left-[1.95rem] flex size-5 items-center justify-center rounded-full border bg-background'>
                    <Icon className='size-3 text-muted-foreground' />
                  </span>
                  <p className='text-sm font-medium'>
                    {t(`talent.growth.kinds.${entry.kind}`)} · {title}
                  </p>
                  <p className='text-xs text-muted-foreground tabular-nums'>
                    {format(entry.at)}
                    {entry.detail
                      ? ` · ${entry.kind === 'exam' ? t('talent.growth.score', { score: entry.detail }) : entry.detail}`
                      : ''}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
