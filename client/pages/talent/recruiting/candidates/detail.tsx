/**
 * 候选人详情 (child page): the resume (for the recruiter), the parsed profile
 * (editable), the screening suggestion card, knockout answers ("门槛未满足"
 * only flags), the screening decision (a rejection names requirements), the
 * messages waiting for the recruiter to send, interviews, offers and the
 * stage history; scheduling an interview, drafting an offer, anonymizing.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { downloadFile } from '@/components/talent/download';
import { MailThread } from '@/components/talent/mail-thread';
import { MyCorrespondence } from '@/components/talent/my-correspondence';
import { formatDateTime, useAction } from '@/components/talent/recruiting-lib';
import {
  PeoplePicker,
  StatusBadge,
  SuggestionCard,
} from '@/components/talent/recruiting-shared';
import type {
  ApplicationDetail,
  ParsedProfile,
} from '@/components/talent/recruiting-types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

export default function CandidateDetail(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const { applicationId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const path = `talent/recruiting/candidates/${encodeURIComponent(applicationId)}`;
  const detail = useRemote<ApplicationDetail>(path);
  const { busy, run } = useAction();
  const [decision, setDecision] = useState<'advance' | 'hold' | 'reject'>(
    'advance',
  );
  const [keys, setKeys] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [anonymizing, setAnonymizing] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const data = detail.data;
  const refresh = () => {
    detail.reload();
    outlet?.reload?.();
  };
  const c = data?.candidate;
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={c?.name ?? t('recruiting.candidates.title')}
          description={
            data ? (
              <span className='flex flex-wrap items-center gap-2'>
                <StatusBadge kind='stage' value={data.stage} />
                {data.knockoutUnmet ? (
                  <Badge variant='destructive'>
                    {t('recruiting.candidates.knockoutUnmet')}
                  </Badge>
                ) : null}
                <span>
                  {data.posting?.title} · {data.requisition?.departmentTitle}
                </span>
                {data.submitCount > 1 ? (
                  <span>
                    {t('recruiting.candidates.submitCount', {
                      count: data.submitCount,
                    })}
                  </span>
                ) : null}
              </span>
            ) : undefined
          }
          actions={
            data ? (
              <div className='flex flex-wrap gap-2'>
                {data.can?.schedule ? (
                  <Button
                    variant='outline'
                    onClick={() => setScheduling((v) => !v)}
                  >
                    {t('recruiting.candidates.schedule')}
                  </Button>
                ) : null}
                {data.can?.offer &&
                ['screening', 'interview'].includes(data.stage) ? (
                  <Button
                    variant='outline'
                    nativeButton={false}
                    render={
                      <Link
                        to={`/talent/offers/new?applicationId=${applicationId}`}
                      />
                    }
                  >
                    {t('recruiting.candidates.offer')}
                  </Button>
                ) : null}
                {data.can?.anonymize ? (
                  <Button
                    variant='outline'
                    onClick={() => setAnonymizing(true)}
                  >
                    {t('recruiting.candidates.anonymize')}
                  </Button>
                ) : null}
              </div>
            ) : null
          }
        />
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : !data || !c ? (
          <BlockSkeleton rows={6} />
        ) : (
          <div className='space-y-4'>
            {/* V2-07 删除申请: the candidate asked through the receipt's link; anonymizing settles it. */}
            {c.deletionRequestedAt && !c.anonymizedAt ? (
              <Alert>
                <AlertDescription>
                  {t('recruiting.candidates.deletionRequested', {
                    at: formatDateTime(c.deletionRequestedAt),
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
            {/* 疑似重复: a careers-page submission never merges into an existing candidate. */}
            {data.possibleDuplicates?.length ? (
              <Alert>
                <AlertDescription>
                  {t('recruiting.candidates.possibleDuplicates', {
                    names: data.possibleDuplicates
                      .map((d) =>
                        d.createdAt
                          ? `${d.name} (${formatDateTime(d.createdAt)})`
                          : d.name,
                      )
                      .join(', '),
                  })}
                </AlertDescription>
              </Alert>
            ) : null}
            {scheduling ? (
              <ScheduleCard
                applicationId={applicationId}
                onDone={() => {
                  setScheduling(false);
                  refresh();
                }}
              />
            ) : null}
            <div className='grid gap-4 lg:grid-cols-2'>
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.candidates.contact')}</CardTitle>
                  <CardDescription>
                    {t('recruiting.candidates.consentAt', {
                      date: formatDateTime(c.consentAt),
                    })}{' '}
                    ·{' '}
                    {t('recruiting.candidates.retention', {
                      date: c.retentionUntil,
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-2 text-sm'>
                  {data.can?.contact ? (
                    <>
                      <p>
                        {c.phone ?? '—'} · {c.email ?? '—'}
                      </p>
                      {c.resumeAvailable ? (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            void downloadFile(
                              api,
                              `${path}/resume`,
                              `${c.name}-resume`,
                            )
                          }
                        >
                          {t('recruiting.candidates.resume')}
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <p className='text-muted-foreground'>
                      {t('recruiting.candidates.contactHidden')}
                    </p>
                  )}
                  <p className='text-muted-foreground'>
                    {t(`recruiting.labels.source.${c.sourceChannel}`, {
                      defaultValue: c.sourceChannel,
                    })}
                    {c.sourceName ? ` · ${c.sourceName}` : ''} ·{' '}
                    {t(`recruiting.labels.parse.${c.parseStatus}`, {
                      defaultValue: c.parseStatus,
                    })}
                  </p>
                  {c.anonymizedAt ? (
                    <Badge variant='outline'>
                      {t('recruiting.candidates.anonymized')}
                    </Badge>
                  ) : null}
                </CardContent>
              </Card>
              <ProfileCard
                profile={c.parsedProfile}
                editable={Boolean(data.can?.manage)}
                onSave={(profile) => {
                  void (async () => {
                    if (
                      await run(
                        'profile',
                        {
                          path: `${path}/profile`,
                          method: 'PUT',
                          json: profile,
                        },
                        t('recruiting.common.saved'),
                      )
                    )
                      refresh();
                  })();
                }}
              />
            </div>
            <SuggestionCard
              suggestion={data.screeningSuggestion}
              requirements={data.posting?.requirements ?? []}
            />
            {data.knockoutAnswers?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t('recruiting.candidates.knockoutAnswers')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className='space-y-1 text-sm'>
                    {data.knockoutAnswers.map((a) => (
                      <li
                        key={a.key}
                        className='flex flex-wrap items-center gap-2'
                      >
                        <span>
                          {data.posting.knockoutQuestions.find(
                            (q) => q.key === a.key,
                          )?.question ?? a.key}
                        </span>
                        <span className='font-medium'>
                          {a.answer === 'yes'
                            ? t('recruiting.common.yes')
                            : a.answer === 'no'
                              ? t('recruiting.common.no')
                              : a.answer}
                        </span>
                        {a.meetsExpected === false ? (
                          <Badge variant='destructive'>
                            {t('recruiting.candidates.knockoutUnmet')}
                          </Badge>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
            {data.customFieldDefinitions?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t('recruiting.candidates.customFields')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className='grid gap-2 text-sm sm:grid-cols-2'>
                    {data.customFieldDefinitions.map((d) => (
                      <div key={d.key}>
                        <dt className='text-muted-foreground'>
                          {d.label?.['zh-CN'] ?? d.key}
                        </dt>
                        <dd>{formatValue(c.customFields[d.key])}</dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            ) : null}
            {data.can?.decide ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.candidates.decision')}</CardTitle>
                  <CardDescription>
                    {t('recruiting.candidates.decisionHint')}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <NativeSelect
                    aria-label={t('recruiting.candidates.decision')}
                    value={decision}
                    onChange={(e) =>
                      setDecision(e.target.value as typeof decision)
                    }
                  >
                    {(['advance', 'hold', 'reject'] as const).map((d) => (
                      <NativeSelectOption key={d} value={d}>
                        {t(`recruiting.labels.decision.${d}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {decision === 'reject' ? (
                    <div className='space-y-2'>
                      <p className='text-sm font-medium'>
                        {t('recruiting.candidates.rejectKeys')}
                      </p>
                      {data.posting.requirements.map((r) => (
                        <label
                          key={r.key}
                          className='flex items-center gap-2 text-sm'
                        >
                          <Checkbox
                            checked={keys.includes(r.key)}
                            onCheckedChange={(checked) =>
                              setKeys((v) =>
                                checked
                                  ? [...v, r.key]
                                  : v.filter((x) => x !== r.key),
                              )
                            }
                          />
                          {r.text}
                        </label>
                      ))}
                      <Field>
                        <FieldLabel htmlFor='cd-note'>
                          {t('recruiting.candidates.rejectNote')}
                        </FieldLabel>
                        <Textarea
                          id='cd-note'
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                        />
                      </Field>
                    </div>
                  ) : null}
                  <Button
                    disabled={
                      busy !== null || (decision === 'reject' && !keys.length)
                    }
                    onClick={() => {
                      void (async () => {
                        if (
                          await run(
                            'decide',
                            {
                              path: `${path}/decide`,
                              json: {
                                decision,
                                rejectRequirementKeys:
                                  decision === 'reject' ? keys : null,
                                rejectNote: note || null,
                              },
                            },
                            t('recruiting.candidates.decided'),
                          )
                        )
                          refresh();
                      })();
                    }}
                  >
                    {t('recruiting.candidates.decide')}
                  </Button>
                </CardContent>
              </Card>
            ) : null}
            {data.can?.manage ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.candidates.messages')}</CardTitle>
                  <CardDescription>
                    {t('recruiting.candidates.messagesHint')}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-3'>
                  {data.messages
                    .filter((m) => m.status !== 'discarded')
                    .map((m) => (
                      <div
                        key={m.id}
                        className='space-y-1 rounded-lg border p-3 text-sm'
                      >
                        <p className='flex flex-wrap items-center gap-2'>
                          <span className='font-medium'>
                            {t(`recruiting.labels.message.${m.type}`)}
                          </span>
                          <Badge
                            variant={
                              m.status === 'sent' ? 'default' : 'outline'
                            }
                          >
                            {t(`recruiting.labels.messageStatus.${m.status}`)}
                          </Badge>
                          {m.delivery ? (
                            <span className='text-xs text-muted-foreground'>
                              {t(`recruiting.labels.delivery.${m.delivery}`)}
                            </span>
                          ) : null}
                        </p>
                        <p>{m.subject}</p>
                        <p className='whitespace-pre-wrap text-muted-foreground'>
                          {m.body}
                        </p>
                        {m.status === 'draft' ? (
                          <div className='flex gap-2'>
                            <Button
                              size='sm'
                              disabled={busy !== null}
                              onClick={() => {
                                void (async () => {
                                  if (
                                    await run(
                                      'send',
                                      { path: `${path}/messages/${m.id}/send` },
                                      t('recruiting.candidates.sent'),
                                    )
                                  )
                                    refresh();
                                })();
                              }}
                            >
                              {t('recruiting.candidates.send')}
                            </Button>
                            <Button
                              size='sm'
                              variant='ghost'
                              disabled={busy !== null}
                              onClick={() => {
                                void (async () => {
                                  if (
                                    await run('discard', {
                                      path: `${path}/messages/${m.id}/discard`,
                                    })
                                  )
                                    refresh();
                                })();
                              }}
                            >
                              {t('recruiting.candidates.discard')}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                </CardContent>
              </Card>
            ) : null}
            {/* V2-07 招聘邮箱: the mail sent to the candidate, their replies and the drafted answers. */}
            {data.can?.manage ? (
              <Card>
                <CardContent>
                  <MailThread
                    mailbox='recruiting'
                    refType='application'
                    refId={applicationId}
                    canSend
                  />
                </CardContent>
              </Card>
            ) : null}
            {/* 我的邮箱往来: the recruiter's own mailbox, connected through the Mail plugin. */}
            {data.can?.manage && c?.email ? (
              <Card>
                <CardContent>
                  <MyCorrespondence address={c.email} />
                </CardContent>
              </Card>
            ) : null}
            {data.interviews?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.interviews.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className='space-y-1 text-sm'>
                    {data.interviews.map((i) => (
                      <li
                        key={i.id}
                        className='flex flex-wrap items-center gap-2'
                      >
                        <Link
                          className='underline underline-offset-4'
                          to={`/talent/interviews/${i.id}`}
                        >
                          #{i.round} {t(`recruiting.labels.mode.${i.mode}`)} ·{' '}
                          {formatDateTime(i.scheduledAt)}
                        </Link>
                        <StatusBadge kind='interview' value={i.status} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
            {data.offers?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.offers.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {data.offers.map((o) => (
                    <p key={o.id} className='flex items-center gap-2 text-sm'>
                      <Link
                        className='underline underline-offset-4'
                        to={`/talent/offers/${o.id}`}
                      >
                        {o.startDate}
                      </Link>
                      <StatusBadge kind='offer' value={o.status} />
                    </p>
                  ))}
                </CardContent>
              </Card>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>{t('recruiting.candidates.history')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ol className='space-y-1 text-sm'>
                  {data.stageHistory.map((h) => (
                    <li key={`${h.at}:${h.to}`}>
                      {formatDateTime(h.at)} ·{' '}
                      {h.from
                        ? `${t(`recruiting.status.stage.${h.from}`)} → `
                        : ''}
                      {t(`recruiting.status.stage.${h.to}`)}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        )}
        <AlertDialog open={anonymizing} onOpenChange={setAnonymizing}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('recruiting.candidates.anonymizeTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('recruiting.candidates.anonymizeDescription')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {t('recruiting.common.cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  void (async () => {
                    if (!c) return;
                    if (
                      await run(
                        'anonymize',
                        {
                          path: `talent/recruiting/candidates/${encodeURIComponent(c.id)}/anonymize`,
                        },
                        t('recruiting.candidates.anonymized'),
                      )
                    ) {
                      setAnonymizing(false);
                      refresh();
                    }
                  })();
                }}
              >
                {t('recruiting.candidates.anonymize')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageContainer>
    </RouteChildPage>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value);
}

function ProfileCard({
  profile,
  editable,
  onSave,
}: {
  profile: ParsedProfile | null;
  editable: boolean;
  onSave: (profile: ParsedProfile) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [skills, setSkills] = useState('');
  const [certificates, setCertificates] = useState('');
  const [experiences, setExperiences] = useState('');
  const start = () => {
    setSkills((profile?.skills ?? []).join('、'));
    setCertificates((profile?.certificates ?? []).join('、'));
    setExperiences(
      (profile?.experiences ?? [])
        .map((e) => `${e.summary}${e.years ? `|${e.years}` : ''}`)
        .join('\n'),
    );
    setEditing(true);
  };
  const split = (s: string) =>
    s
      .split(/[、,，\n]/u)
      .map((x) => x.trim())
      .filter(Boolean);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recruiting.candidates.profile')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-2 text-sm'>
        {editing ? (
          <>
            <Field>
              <FieldLabel htmlFor='pf-exp'>
                {t('recruiting.candidates.experiences')}
              </FieldLabel>
              <Textarea
                id='pf-exp'
                value={experiences}
                onChange={(e) => setExperiences(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='pf-skills'>
                {t('recruiting.candidates.skills')}
              </FieldLabel>
              <Input
                id='pf-skills'
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='pf-certs'>
                {t('recruiting.candidates.certificates')}
              </FieldLabel>
              <Input
                id='pf-certs'
                value={certificates}
                onChange={(e) => setCertificates(e.target.value)}
              />
            </Field>
            <Button
              size='sm'
              onClick={() => {
                onSave({
                  education: (profile?.education ?? []).map((e) => ({
                    level: e.level,
                    school: e.school ?? null,
                    major: e.major ?? null,
                  })),
                  experiences: experiences
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean)
                    .map((l) => {
                      const [summary, years] = l.split('|');
                      return {
                        summary: summary.trim(),
                        years: years ? Number(years) : null,
                        keywords: [],
                      };
                    }),
                  skills: split(skills),
                  certificates: split(certificates),
                });
                setEditing(false);
              }}
            >
              {t('recruiting.common.save')}
            </Button>
          </>
        ) : profile ? (
          <>
            <p>
              <span className='text-muted-foreground'>
                {t('recruiting.candidates.education')}：
              </span>
              {profile.education
                .map(
                  (e) =>
                    [e.school, e.major].filter(Boolean).join(' ') || e.level,
                )
                .join('；') || '—'}
            </p>
            <div>
              <span className='text-muted-foreground'>
                {t('recruiting.candidates.experiences')}：
              </span>
              <ul className='list-disc pl-5'>
                {profile.experiences.map((e) => (
                  <li key={e.summary}>{e.summary}</li>
                ))}
              </ul>
            </div>
            <p>
              <span className='text-muted-foreground'>
                {t('recruiting.candidates.skills')}：
              </span>
              {profile.skills.join('、') || '—'}
            </p>
            <p>
              <span className='text-muted-foreground'>
                {t('recruiting.candidates.certificates')}：
              </span>
              {profile.certificates.join('、') || '—'}
            </p>
            {editable ? (
              <Button size='sm' variant='outline' onClick={start}>
                {t('recruiting.candidates.editProfile')}
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <p className='text-muted-foreground'>
              {t('recruiting.labels.parse.none')}
            </p>
            {editable ? (
              <Button size='sm' variant='outline' onClick={start}>
                {t('recruiting.candidates.editProfile')}
              </Button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ScheduleCard({
  applicationId,
  onDone,
}: {
  applicationId: string;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { busy, run } = useAction();
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState(60);
  const [mode, setMode] = useState<'onsite' | 'video' | 'phone'>('onsite');
  const [place, setPlace] = useState('');
  const [interviewers, setInterviewers] = useState<string[]>([]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recruiting.interviews.schedule')}</CardTitle>
      </CardHeader>
      <CardContent className='grid gap-3 sm:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='sc-when'>
            {t('recruiting.interviews.scheduledAt')}
          </FieldLabel>
          <Input
            id='sc-when'
            type='datetime-local'
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='sc-duration'>
            {t('recruiting.interviews.duration')}
          </FieldLabel>
          <Input
            id='sc-duration'
            type='number'
            min={10}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='sc-mode'>
            {t('recruiting.interviews.mode')}
          </FieldLabel>
          <NativeSelect
            id='sc-mode'
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            {(['onsite', 'video', 'phone'] as const).map((m) => (
              <NativeSelectOption key={m} value={m}>
                {t(`recruiting.labels.mode.${m}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='sc-place'>
            {t('recruiting.interviews.locationOrLink')}
          </FieldLabel>
          <Input
            id='sc-place'
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />
        </Field>
        <div className='sm:col-span-2'>
          <p className='text-sm font-medium'>
            {t('recruiting.interviews.interviewers')}
          </p>
          <PeoplePicker value={interviewers} onChange={setInterviewers} />
        </div>
        <div className='sm:col-span-2'>
          <Button
            disabled={busy !== null || !when || !interviewers.length}
            onClick={() => {
              void (async () => {
                if (
                  await run(
                    'schedule',
                    {
                      path: 'talent/recruiting/interviews',
                      json: {
                        applicationId,
                        mode,
                        scheduledAt: new Date(when).toISOString(),
                        durationMinutes: duration,
                        locationOrLink: place || null,
                        interviewerUserIds: interviewers,
                      },
                    },
                    t('recruiting.common.saved'),
                  )
                )
                  onDone();
              })();
            }}
          >
            {t('recruiting.interviews.schedule')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
