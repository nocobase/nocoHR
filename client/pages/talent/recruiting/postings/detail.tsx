/**
 * 职位详情 (child page): the description and requirements (each with its
 * origin; the checklist's items stay as written), knockout questions, and —
 * once confirmed — publishing, external channels, interview slots, the
 * self-booking template and the optional AI initial interview.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import {
  REQUIREMENT_TYPES,
  useAction,
  type Requirement,
} from '@/components/talent/recruiting-lib';
import {
  PeoplePicker,
  RequirementList,
  StatusBadge,
} from '@/components/talent/recruiting-shared';
import type {
  Channel,
  KnockoutQuestion,
  Posting,
  Slot,
} from '@/components/talent/recruiting-types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
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

type Question = KnockoutQuestion;

let rowSeed = 0;
/** A stable React key for a row being edited (slots and channels have no id of their own). */
const withUid = <T extends object>(item: T): T & { uid: string } => ({
  ...item,
  uid: `row-${(rowSeed += 1)}`,
});

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PostingDetail(): ReactElement {
  const { t } = useTranslation();
  const { postingId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const path = `talent/recruiting/postings/${encodeURIComponent(postingId)}`;
  const detail = useRemote<Posting>(path);
  const { busy, run } = useAction();
  const data = detail.data;
  const refresh = () => {
    detail.reload();
    outlet?.reload?.();
  };
  const manage = Boolean(data?.can?.manage);
  // Editors start from the saved posting and remount when it changes, instead of copying it in an effect.
  const revision = data ? JSON.stringify(data) : '';
  const act = async (
    key: string,
    sub: string,
    json?: unknown,
    method = 'POST',
    success = t('recruiting.common.saved'),
  ) => {
    if (await run(key, { path: `${path}${sub}`, method, json }, success))
      refresh();
  };
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={data?.title ?? t('recruiting.postings.title')}
          description={
            data ? (
              <span className='flex flex-wrap items-center gap-2'>
                <StatusBadge kind='posting' value={data.status} />
                <StatusBadge kind='review' value={data.reviewStatus} />
                <span>
                  {data.requisition?.departmentTitle} · {data.location}
                </span>
              </span>
            ) : undefined
          }
          actions={
            manage ? (
              <div className='flex flex-wrap gap-2'>
                {data?.reviewStatus === 'draft' ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        'confirm',
                        '/confirm',
                        undefined,
                        'POST',
                        t('recruiting.postings.confirmed'),
                      )
                    }
                  >
                    {t('recruiting.postings.confirm')}
                  </Button>
                ) : null}
                {data?.can?.publish ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      void act(
                        'publish',
                        '/publish',
                        undefined,
                        'POST',
                        t('recruiting.postings.published'),
                      )
                    }
                  >
                    {t('recruiting.postings.publish')}
                  </Button>
                ) : null}
                {data?.status === 'published' ? (
                  <Button
                    variant='outline'
                    disabled={busy !== null}
                    onClick={() => void act('close', '/close')}
                  >
                    {t('recruiting.postings.close')}
                  </Button>
                ) : null}
              </div>
            ) : null
          }
        />
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : !data ? (
          <BlockSkeleton rows={6} />
        ) : (
          <div className='space-y-4'>
            {data.publicSlug && data.status === 'published' ? (
              <p className='text-sm'>
                {t('recruiting.postings.publicLink')}:{' '}
                <Link
                  className='underline underline-offset-4'
                  to={`/jobs/${data.publicSlug}`}
                  target='_blank'
                  rel='noreferrer'
                >
                  /jobs/{data.publicSlug}
                </Link>
              </p>
            ) : null}
            {manage ? (
              <ContentEditor
                key={revision}
                data={data}
                busy={busy !== null}
                onSave={(json) =>
                  void act(
                    'save',
                    '',
                    json,
                    'PUT',
                    t('recruiting.postings.savedDraft'),
                  )
                }
                onImport={() => void act('import', '/import-competencies')}
              />
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.postings.requirements')}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <p className='whitespace-pre-wrap text-sm'>
                    {data.description}
                  </p>
                  <RequirementList requirements={data.requirements} />
                </CardContent>
              </Card>
            )}
            {manage ? (
              <Operations
                key={revision}
                data={data}
                busy={busy !== null}
                onSave={(json) => void act('ops', '', json, 'PATCH')}
              />
            ) : null}
            {manage ? (
              <Booking
                key={revision}
                data={data}
                busy={busy !== null}
                onSave={(json) => void act('booking', '/booking', json)}
              />
            ) : null}
            {manage ? (
              <AiInterview data={data} busy={busy !== null} act={act} />
            ) : null}
          </div>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

function ContentEditor({
  data,
  busy,
  onSave,
  onImport,
}: {
  data: Posting;
  busy: boolean;
  onSave: (json: unknown) => void;
  onImport: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [title, setTitle] = useState(data.title);
  const [description, setDescription] = useState(data.description);
  const [location, setLocation] = useState(data.location);
  const [requirements, setRequirements] = useState<Requirement[]>(
    data.requirements,
  );
  const [questions, setQuestions] = useState<Question[]>(
    data.knockoutQuestions,
  );
  const setReq = (i: number, patch: Partial<Requirement>) =>
    setRequirements((list) =>
      list.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    );
  const setQ = (i: number, patch: Partial<Question>) =>
    setQuestions((list) =>
      list.map((q, j) => (j === i ? { ...q, ...patch } : q)),
    );
  const mustKeys = requirements.filter((r) => r.mustHave);
  const nextKey = (prefix: string, keys: string[]) => {
    let n = keys.length + 1;
    while (keys.includes(`${prefix}${n}`)) n += 1;
    return `${prefix}${n}`;
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recruiting.postings.requirements')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid gap-3 sm:grid-cols-2'>
          <Field>
            <FieldLabel htmlFor='po-title'>
              {t('recruiting.navigation.postings')}
            </FieldLabel>
            <Input
              id='po-title'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='po-location'>
              {t('recruiting.postings.location')}
            </FieldLabel>
            <Input
              id='po-location'
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor='po-description'>
            {t('recruiting.common.note')}
          </FieldLabel>
          <Textarea
            id='po-description'
            rows={6}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <div className='space-y-2'>
          {requirements.map((r, i) => (
            <div key={r.key} className='flex flex-wrap items-center gap-2'>
              <span className='font-mono text-xs text-muted-foreground'>
                {r.key}
              </span>
              <NativeSelect
                aria-label={t('recruiting.common.source')}
                value={r.type}
                disabled={r.origin === 'checklist'}
                onChange={(e) => setReq(i, { type: e.target.value })}
              >
                {REQUIREMENT_TYPES.map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {t(`recruiting.labels.requirementType.${type}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Input
                className='min-w-48 flex-1'
                aria-label={t('recruiting.postings.requirementText')}
                value={r.text}
                readOnly={r.origin === 'checklist'}
                onChange={(e) => setReq(i, { text: e.target.value })}
              />
              <label className='flex items-center gap-1 text-sm'>
                <Checkbox
                  checked={r.mustHave}
                  disabled={r.origin === 'checklist'}
                  onCheckedChange={(checked) =>
                    setReq(i, { mustHave: Boolean(checked) })
                  }
                />
                {t('recruiting.common.mustHave')}
              </label>
              <Badge variant='secondary'>
                {t(`recruiting.labels.origin.${r.origin}`)}
              </Badge>
              {r.origin !== 'checklist' ? (
                <Button
                  type='button'
                  size='sm'
                  variant='ghost'
                  onClick={() =>
                    setRequirements((list) => list.filter((_, j) => j !== i))
                  }
                >
                  {t('recruiting.common.remove')}
                </Button>
              ) : null}
            </div>
          ))}
          <div className='flex flex-wrap gap-2'>
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() =>
                setRequirements((list) => [
                  ...list,
                  {
                    key: nextKey(
                      'm',
                      list.map((r) => r.key),
                    ),
                    type: 'skill',
                    text: '',
                    mustHave: false,
                    origin: 'manual',
                  },
                ])
              }
            >
              {t('recruiting.common.add')}
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={busy}
              onClick={onImport}
            >
              {t('recruiting.postings.importCompetencies')}
            </Button>
          </div>
        </div>
        <div className='space-y-2'>
          <p className='text-sm font-medium'>
            {t('recruiting.postings.knockout')}
          </p>
          <p className='text-sm text-muted-foreground'>
            {t('recruiting.postings.knockoutHint')}
          </p>
          {questions.map((q, i) => (
            <div
              key={q.key}
              className='grid gap-2 rounded-lg border p-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]'
            >
              <Input
                aria-label={t('recruiting.postings.knockout')}
                value={q.question}
                onChange={(e) => setQ(i, { question: e.target.value })}
              />
              <NativeSelect
                aria-label={t('recruiting.labels.answerType.yesNo')}
                value={q.answerType}
                onChange={(e) =>
                  setQ(i, {
                    answerType: e.target.value as Question['answerType'],
                  })
                }
              >
                {(['yesNo', 'choice', 'shortText'] as const).map((type) => (
                  <NativeSelectOption key={type} value={type}>
                    {t(`recruiting.labels.answerType.${type}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
                aria-label={t('recruiting.postings.requirementText')}
                value={q.requirementKey}
                onChange={(e) => setQ(i, { requirementKey: e.target.value })}
              >
                {mustKeys.map((r) => (
                  <NativeSelectOption key={r.key} value={r.key}>
                    {r.text}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {q.answerType === 'shortText' ? (
                <span />
              ) : (
                <Input
                  aria-label={t('recruiting.postings.expected')}
                  placeholder={t('recruiting.postings.expected')}
                  value={
                    q.answerType === 'choice'
                      ? `${(q.options ?? []).join(',')}${q.expected ? ` → ${q.expected}` : ''}`
                      : (q.expected ?? '')
                  }
                  onChange={(e) => {
                    if (q.answerType === 'choice') {
                      const [opts, expected] = e.target.value
                        .split('→')
                        .map((x) => x.trim());
                      setQ(i, {
                        options: opts
                          .split(/[,，]/u)
                          .map((x) => x.trim())
                          .filter(Boolean),
                        expected: expected || null,
                      });
                    } else setQ(i, { expected: e.target.value || null });
                  }}
                />
              )}
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={() =>
                  setQuestions((list) => list.filter((_, j) => j !== i))
                }
              >
                {t('recruiting.common.remove')}
              </Button>
            </div>
          ))}
          {questions.length < 5 && mustKeys.length ? (
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() =>
                setQuestions((list) => [
                  ...list,
                  {
                    key: nextKey(
                      'q',
                      list.map((q) => q.key),
                    ),
                    question: '',
                    answerType: 'yesNo',
                    requirementKey: mustKeys[0].key,
                    expected: 'yes',
                  },
                ])
              }
            >
              {t('recruiting.common.add')}
            </Button>
          ) : null}
        </div>
        <Button
          disabled={busy}
          onClick={() =>
            onSave({
              title,
              description,
              location,
              requirements,
              knockoutQuestions: questions.map((q) => ({
                ...q,
                options: q.options ?? null,
                expected: q.expected ?? null,
              })),
            })
          }
        >
          {t('recruiting.common.save')}
        </Button>
      </CardContent>
    </Card>
  );
}

function Operations({
  data,
  busy,
  onSave,
}: {
  data: Posting;
  busy: boolean;
  onSave: (json: unknown) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [channels, setChannels] = useState(() =>
    data.channels.map((c: Channel) => withUid(c)),
  );
  const [slots, setSlots] = useState(() =>
    data.interviewSlots.map((s: Slot) => withUid(s)),
  );
  const setSlot = (uid: string, patch: Partial<Slot>) =>
    setSlots((list) =>
      list.map((s) => (s.uid === uid ? { ...s, ...patch } : s)),
    );
  const setChannel = (uid: string, patch: Partial<Channel>) =>
    setChannels((list) =>
      list.map((c) => (c.uid === uid ? { ...c, ...patch } : c)),
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recruiting.postings.slots')}</CardTitle>
        <CardDescription>{t('recruiting.postings.slotsHint')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {slots.map((s) => (
          <div
            key={s.uid}
            className='grid gap-2 rounded-lg border p-2 sm:grid-cols-2 lg:grid-cols-4'
          >
            <Field>
              <FieldLabel>{t('recruiting.postings.slotStart')}</FieldLabel>
              <Input
                type='datetime-local'
                value={s.start ? toLocalInput(s.start) : ''}
                onChange={(e) =>
                  setSlot(s.uid, {
                    start: new Date(e.target.value).toISOString(),
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel>{t('recruiting.postings.slotEnd')}</FieldLabel>
              <Input
                type='datetime-local'
                value={s.end ? toLocalInput(s.end) : ''}
                onChange={(e) =>
                  setSlot(s.uid, {
                    end: new Date(e.target.value).toISOString(),
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel>{t('recruiting.postings.capacity')}</FieldLabel>
              <Input
                type='number'
                min={1}
                value={s.capacity}
                onChange={(e) =>
                  setSlot(s.uid, { capacity: Number(e.target.value) })
                }
              />
              {s.booked !== undefined ? (
                <span className='text-xs text-muted-foreground'>
                  {t('recruiting.postings.booked', {
                    booked: s.booked,
                    capacity: s.capacity,
                  })}
                </span>
              ) : null}
            </Field>
            <Field>
              <FieldLabel>{t('recruiting.postings.location')}</FieldLabel>
              <Input
                value={s.location ?? ''}
                onChange={(e) => setSlot(s.uid, { location: e.target.value })}
              />
            </Field>
            <div className='sm:col-span-2 lg:col-span-4'>
              <p className='text-sm font-medium'>
                {t('recruiting.postings.interviewers')}
              </p>
              <PeoplePicker
                value={s.interviewerUserIds}
                onChange={(ids) => setSlot(s.uid, { interviewerUserIds: ids })}
              />
            </div>
          </div>
        ))}
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() =>
            setSlots((list) => [
              ...list,
              withUid<Slot>({
                start: '',
                end: '',
                capacity: 1,
                location: data.location,
                interviewerUserIds: [],
              }),
            ])
          }
        >
          {t('recruiting.common.add')}
        </Button>
        <div className='space-y-2'>
          <p className='text-sm font-medium'>
            {t('recruiting.postings.channels')}
          </p>
          {channels.map((c) => (
            <div key={c.uid} className='flex flex-wrap gap-2'>
              <Input
                className='w-40'
                aria-label={t('recruiting.postings.channelName')}
                value={c.name}
                onChange={(e) => setChannel(c.uid, { name: e.target.value })}
              />
              <Input
                className='min-w-48 flex-1'
                aria-label={t('recruiting.postings.channelLink')}
                value={c.link ?? ''}
                onChange={(e) => setChannel(c.uid, { link: e.target.value })}
              />
              <Button
                type='button'
                size='sm'
                variant='ghost'
                onClick={() =>
                  setChannels((list) => list.filter((x) => x.uid !== c.uid))
                }
              >
                {t('recruiting.common.remove')}
              </Button>
            </div>
          ))}
          <Button
            type='button'
            size='sm'
            variant='outline'
            onClick={() =>
              setChannels((list) => [
                ...list,
                withUid<Channel>({
                  name: '',
                  link: '',
                  postedAt: new Date().toISOString().slice(0, 10),
                }),
              ])
            }
          >
            {t('recruiting.common.add')}
          </Button>
        </div>
        <Button
          disabled={busy}
          onClick={() =>
            onSave({
              channels: channels
                .filter((c) => c.name)
                .map((c) => ({
                  name: c.name,
                  link: c.link || null,
                  postedAt: c.postedAt || null,
                })),
              interviewSlots: slots
                .filter((s) => s.start && s.end)
                .map((s) => ({
                  start: s.start,
                  end: s.end,
                  capacity: s.capacity,
                  location: s.location || null,
                  interviewerUserIds: s.interviewerUserIds,
                })),
            })
          }
        >
          {t('recruiting.common.save')}
        </Button>
      </CardContent>
    </Card>
  );
}

function Booking({
  data,
  busy,
  onSave,
}: {
  data: Posting;
  busy: boolean;
  onSave: (json: unknown) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [subject, setSubject] = useState(data.bookingTemplate?.subject ?? '');
  const [body, setBody] = useState(data.bookingTemplate?.body ?? '');
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {t('recruiting.postings.booking')}
          {data.selfBookingEnabled ? (
            <Badge>{t('recruiting.postings.bookingEnabled')}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {t('recruiting.postings.bookingHint')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <Field>
          <FieldLabel htmlFor='po-subject'>
            {t('recruiting.postings.subject')}
          </FieldLabel>
          <Input
            id='po-subject'
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='po-body'>
            {t('recruiting.postings.body')}
          </FieldLabel>
          <Textarea
            id='po-body'
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </Field>
        <div className='flex gap-2'>
          <Button
            disabled={busy || !subject || !body}
            onClick={() =>
              onSave({ enabled: true, template: { subject, body } })
            }
          >
            {t('recruiting.postings.bookingEnabled')}
          </Button>
          {data.selfBookingEnabled ? (
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => onSave({ enabled: false })}
            >
              {t('recruiting.postings.disableAi')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function AiInterview({
  data,
  busy,
  act,
}: {
  data: Posting;
  busy: boolean;
  act: (
    key: string,
    sub: string,
    json?: unknown,
    method?: string,
  ) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const plan = data.aiInterviewPlan;
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {t('recruiting.postings.aiInterview')}
          {plan ? (
            <StatusBadge
              kind='review'
              value={plan.status === 'confirmed' ? 'confirmed' : 'draft'}
            />
          ) : null}
        </CardTitle>
        <CardDescription>
          {t('recruiting.postings.aiInterviewHint')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {plan?.questions?.length ? (
          <ol className='list-decimal space-y-1 pl-5 text-sm'>
            {plan.questions.map((q) => (
              <li key={q.question}>
                {q.question}{' '}
                <span className='text-muted-foreground'>· {q.lookFor}</span>
              </li>
            ))}
          </ol>
        ) : null}
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => void act('aiDraft', '/ai-interview/draft')}
          >
            {t('recruiting.postings.draftAiPlan')}
          </Button>
          {plan && !data.aiInterviewEnabled ? (
            <Button
              disabled={busy}
              onClick={() =>
                void act('aiEnable', '/ai-interview/enable', {
                  enabled: true,
                  confirmPlan: true,
                })
              }
            >
              {t('recruiting.postings.confirmAiPlan')}
            </Button>
          ) : null}
          {data.aiInterviewEnabled ? (
            <Button
              variant='outline'
              disabled={busy}
              onClick={() =>
                void act('aiDisable', '/ai-interview/enable', {
                  enabled: false,
                })
              }
            >
              {t('recruiting.postings.disableAi')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
