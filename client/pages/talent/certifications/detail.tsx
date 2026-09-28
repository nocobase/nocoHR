import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import {
  BookOpenIcon,
  CheckCircle2Icon,
  CircleIcon,
  ClipboardCheckIcon,
  ExternalLinkIcon,
  PencilIcon,
  PlayIcon,
  PowerIcon,
  PrinterIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import {
  CertificateCard,
  CertificateStatusBadge,
} from '@/components/talent/certificate-card';
import { printCertificate } from '@/components/talent/certificate-print';
import { errorMessage } from '@/components/talent/errors';
import type {
  Certificate,
  CertificationDetail,
} from '@/components/talent/exam-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import { DEMO_PAGES } from '../../demo/pages.js';
import { CertificationDialog } from './certification-dialog.js';
import type { CertificationsOutletContext } from './types.js';

/** Route `/talent/certifications/:certificationId`. */
export default function CertificationDetailPage(): ReactElement {
  const { certificationId = '' } = useParams();
  const detail = useRemote<CertificationDetail>(
    `talent/certifications/${encodeURIComponent(certificationId)}`,
  );
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : !detail.data ? (
          <BlockSkeleton rows={6} />
        ) : (
          <Body detail={detail.data} onChanged={detail.reload} />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

function Body({
  detail,
  onChanged,
}: {
  detail: CertificationDetail;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const lookups = useLookups();
  const outlet = useOutletContext<CertificationsOutletContext | undefined>();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [revoking, setRevoking] = useState<Certificate | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const format = (date: string | null) =>
    date
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
          new Date(`${date}T00:00:00`),
        )
      : t('talent.certifications.noExpiry');

  // Any enabled certification may be sat; starting here also returns to an attempt already in progress.
  async function startExam(examId: string): Promise<void> {
    try {
      const result = await api.request<{ data: { id: string } }>({
        path: `talent/my-exams/${encodeURIComponent(examId)}/start`,
        method: 'POST',
      });
      void navigate(
        `/talent/my-exams/attempts/${encodeURIComponent(result.data.id)}`,
      );
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  async function toggle(): Promise<void> {
    try {
      await api.request({
        path: `talent/certifications/${encodeURIComponent(detail.id)}/active`,
        method: 'POST',
        json: { active: !detail.active },
      });
      onChanged();
      outlet?.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  async function revoke(): Promise<void> {
    if (!revoking) return;
    if (!reason.trim()) {
      setError(t('talent.errors.REVOKE_REASON_REQUIRED'));
      return;
    }
    try {
      await api.request({
        path: `talent/certificates/${encodeURIComponent(revoking.id)}/revoke`,
        method: 'POST',
        json: { reason },
      });
      toast.add({ type: 'success', title: t('talent.certifications.revoked') });
      setRevoking(null);
      onChanged();
      outlet?.reload();
    } catch (cause) {
      setError(errorMessage(cause, t));
    }
  }

  const mine = detail.mine;
  return (
    <>
      <PageHeader
        title={
          <span className='flex flex-wrap items-center gap-3'>
            {detail.title}
            {!detail.active ? (
              <Badge variant='outline'>{t('talent.common.disabled')}</Badge>
            ) : null}
          </span>
        }
        description={[
          detail.code,
          detail.validityMonths
            ? t('talent.certifications.validFor', {
                months: detail.validityMonths,
              })
            : t('talent.certifications.noExpiry'),
        ].join(' · ')}
        actions={
          detail.can.manage ? (
            <>
              <Button variant='outline' onClick={() => void toggle()}>
                <PowerIcon data-icon='inline-start' />
                {detail.active
                  ? t('talent.common.disable')
                  : t('talent.common.enable')}
              </Button>
              <Button onClick={() => setEditing(true)}>
                <PencilIcon data-icon='inline-start' />
                {t('talent.common.edit')}
              </Button>
            </>
          ) : null
        }
      />
      {detail.description ? (
        <p className='text-sm text-muted-foreground'>{detail.description}</p>
      ) : null}
      <div className='grid gap-4 lg:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle>{t('talent.certifications.requirements')}</CardTitle>
            <CardDescription>
              {mine
                ? t('talent.certifications.myProgress')
                : t('talent.certifications.requirementsDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className='space-y-2 text-sm'>
              {(
                mine?.requirements.courses ??
                detail.courses.map((c) => ({ ...c, done: false }))
              ).map((course) => (
                <li key={course.id} className='flex items-center gap-2'>
                  {mine ? (
                    course.done ? (
                      <CheckCircle2Icon className='size-4 text-primary' />
                    ) : (
                      <CircleIcon className='size-4 text-muted-foreground' />
                    )
                  ) : (
                    <BookOpenIcon className='size-4 text-muted-foreground' />
                  )}
                  <span className='flex-1'>
                    {t('talent.certifications.completeCourse', {
                      title: course.title,
                    })}
                  </span>
                  {mine && !course.done ? (
                    <Link
                      to={`/talent/learning/${encodeURIComponent(course.id)}`}
                      className={buttonVariants({
                        size: 'xs',
                        variant: 'outline',
                      })}
                    >
                      {t('talent.certifications.goLearn')}
                    </Link>
                  ) : null}
                </li>
              ))}
              {(
                mine?.requirements.exams ??
                detail.exams.map((e) => ({ ...e, done: false }))
              ).map((exam) => (
                <li key={exam.id} className='flex items-center gap-2'>
                  {mine ? (
                    exam.done ? (
                      <CheckCircle2Icon className='size-4 text-primary' />
                    ) : (
                      <CircleIcon className='size-4 text-muted-foreground' />
                    )
                  ) : (
                    <ClipboardCheckIcon className='size-4 text-muted-foreground' />
                  )}
                  <span className='flex-1'>
                    {t('talent.certifications.passExam', { title: exam.title })}
                  </span>
                  {mine && !exam.done ? (
                    <Button
                      size='xs'
                      variant='outline'
                      onClick={() => void startExam(exam.id)}
                    >
                      {t('talent.certifications.goExam')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            {detail.competencyTitle ? (
              <p className='mt-3 text-xs text-muted-foreground'>
                {t('talent.certifications.provesCompetency', {
                  title: detail.competencyTitle,
                  level: detail.competencyLevel ?? 1,
                })}
              </p>
            ) : null}
          </CardContent>
        </Card>
        {mine ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('talent.certifications.myCertificate')}</CardTitle>
            </CardHeader>
            <CardContent>
              {mine.certificate ? (
                <div className='space-y-3'>
                  <CertificateCard certificate={mine.certificate} />
                  {mine.certificate.status === 'valid' ||
                  mine.certificate.status === 'expiring' ? (
                    <DemoPageLinks pages={detail.grantedPages} />
                  ) : null}
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('talent.certifications.notYet')}
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
        {detail.grantedPermissionSets ? (
          <Card>
            <CardHeader>
              <CardTitle className='flex items-center gap-2'>
                <ShieldCheckIcon className='size-4' />
                {t('talent.certifications.grantedSets')}
              </CardTitle>
              <CardDescription>
                {t('talent.certifications.grantedSetsDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              {detail.grantedPermissionSets.length ? (
                <div className='flex flex-wrap gap-2'>
                  {detail.grantedPermissionSets.map((set) => (
                    <Badge key={set.key} variant='secondary'>
                      {set.title}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('talent.certifications.noGrantedSets')}
                </p>
              )}
              <Link
                to='/settings/authorization/permission-sets'
                className={buttonVariants({ size: 'sm', variant: 'outline' })}
              >
                <ExternalLinkIcon data-icon='inline-start' />
                {t('talent.certifications.manageGrants')}
              </Link>
              <DemoPageLinks pages={detail.grantedPages} />
            </CardContent>
          </Card>
        ) : null}
      </div>
      {detail.holders ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('talent.certifications.holderList')}</CardTitle>
          </CardHeader>
          <CardContent>
            {!detail.holders.length ? (
              <EmptyState title={t('talent.certifications.noHolders')} />
            ) : (
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t('talent.assignments.fields.employee')}
                      </TableHead>
                      <TableHead className='hidden md:table-cell'>
                        {t('talent.fields.department')}
                      </TableHead>
                      <TableHead>
                        {t('talent.certifications.fields.certificateNo')}
                      </TableHead>
                      <TableHead className='hidden sm:table-cell'>
                        {t('talent.certifications.fields.issuedAt')}
                      </TableHead>
                      <TableHead>
                        {t('talent.certifications.fields.expiresAt')}
                      </TableHead>
                      <TableHead>{t('talent.fields.status')}</TableHead>
                      <TableHead className='text-right'>
                        {t('talent.common.actions')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.holders.map((holder) => (
                      <TableRow key={holder.id}>
                        <TableCell className='font-medium'>
                          {holder.employeeName}
                        </TableCell>
                        <TableCell className='hidden md:table-cell'>
                          {lookups.departmentTitle(holder.departmentId)}
                        </TableCell>
                        <TableCell className='font-mono text-xs'>
                          {holder.certificateNo}
                        </TableCell>
                        <TableCell className='hidden sm:table-cell'>
                          {format(holder.issuedAt)}
                        </TableCell>
                        <TableCell>{format(holder.expiresAt)}</TableCell>
                        <TableCell>
                          <CertificateStatusBadge status={holder.status} />
                          {holder.revokedReason ? (
                            <span className='block text-xs text-muted-foreground'>
                              {holder.revokedReason}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className='text-right'>
                          <span className='inline-flex gap-1'>
                            <Button
                              size='icon-sm'
                              variant='ghost'
                              aria-label={t('talent.certifications.print')}
                              onClick={() => printCertificate(holder.id)}
                            >
                              <PrinterIcon />
                            </Button>
                            {detail.can.revoke &&
                            (holder.status === 'valid' ||
                              holder.status === 'expiring') ? (
                              <Button
                                size='sm'
                                variant='outline'
                                onClick={() => {
                                  setReason('');
                                  setError(undefined);
                                  setRevoking(holder);
                                }}
                              >
                                {t('talent.certifications.revoke')}
                              </Button>
                            ) : null}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
      <CertificationDialog
        open={editing}
        onOpenChange={setEditing}
        certification={detail}
        onSaved={() => {
          onChanged();
          outlet?.reload();
        }}
      />
      <Dialog
        open={Boolean(revoking)}
        onOpenChange={(open) => (!open ? setRevoking(null) : undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('talent.certifications.revokeTitle')}</DialogTitle>
            <DialogDescription>
              {t('talent.certifications.revokeDescription', {
                name: revoking?.employeeName ?? '',
                no: revoking?.certificateNo ?? '',
              })}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor='revoke-reason'>
              {t('talent.certifications.revokeReason')}
            </FieldLabel>
            <Textarea
              id='revoke-reason'
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRevoking(null)}>
              {t('actions.cancel')}
            </Button>
            <Button variant='destructive' onClick={() => void revoke()}>
              {t('talent.certifications.revoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Demonstration pages this certification's permission sets open; they have no menu entry of their own. */
function DemoPageLinks({
  pages,
}: {
  pages: readonly string[];
}): ReactElement | null {
  const { t } = useTranslation();
  const links = pages.flatMap((id) => (DEMO_PAGES[id] ? [DEMO_PAGES[id]] : []));
  if (!links.length) return null;
  return (
    <div className='flex flex-wrap gap-2'>
      {links.map((link) => (
        <Link
          key={link.path}
          to={link.path}
          className={buttonVariants({ size: 'sm' })}
        >
          <PlayIcon data-icon='inline-start' />
          {t('talent.certifications.openDemoPage', { title: t(link.title) })}
        </Link>
      ))}
    </div>
  );
}
