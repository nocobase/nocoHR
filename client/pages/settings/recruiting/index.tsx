/**
 * V2-07 设置 / 招聘设置 (`talent.recruitingSettings`, hr.admin): every rule of
 * recruiting and onboarding the step leaves to the administrator — the
 * careers page, retention, reminders, extra requisition approval levels,
 * the workforce parameters, interviewer calendars, new-hire check-ins, the
 * recruiting assistant, candidate email and templates — and the ERP
 * integration key (shown once).
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement, type ReactNode } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useAction } from '@/components/talent/recruiting-lib';
import { PeoplePicker } from '@/components/talent/recruiting-shared';
import type {
  ApprovalRow,
  CapacityRow,
  RecruitingSettingsValue,
  TransferRow,
} from '@/components/talent/recruiting-types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
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

const TOPICS = [
  'housing',
  'shuttle',
  'mentoring',
  'schedule',
  'workload',
  'other',
] as const;
const TEMPLATES = [
  'bookingConfirmation',
  'interviewReminder',
  'invitation',
  'rejection',
  'offer',
  'preboarding',
  'aiInterviewInvitation',
] as const;

const numbers = (s: string) =>
  s
    .split(/[,，\s]+/u)
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n > 0);
const words = (s: string) =>
  s
    .split(/[,，\s]+/u)
    .map((x) => x.trim())
    .filter(Boolean);

type Keyed<T> = T & { uid: string };

interface FormValue extends Omit<
  RecruitingSettingsValue,
  'workforce' | 'approvals'
> {
  workforce: Omit<
    RecruitingSettingsValue['workforce'],
    'capacity' | 'transferLimits'
  > & {
    capacity: Keyed<CapacityRow>[];
    transferLimits: Keyed<TransferRow>[];
  };
  approvals: { requisitionExtra: Keyed<ApprovalRow>[] };
}

let rowSeed = 0;
/** A stable React key for a settings row being edited; stripped before saving. */
const keyed = <T extends object>(row: T): Keyed<T> => ({
  ...row,
  uid: `row-${(rowSeed += 1)}`,
});
const unkeyed = <T extends object>(rows: Keyed<T>[]): T[] =>
  rows.map((row) => {
    const { uid: _uid, ...rest } = row;
    return rest as unknown as T;
  });

function toForm(value: RecruitingSettingsValue): FormValue {
  const copy = structuredClone(value);
  return {
    ...copy,
    workforce: {
      ...copy.workforce,
      capacity: copy.workforce.capacity.map((r) => keyed(r)),
      transferLimits: copy.workforce.transferLimits.map((r) => keyed(r)),
    },
    approvals: {
      requisitionExtra: copy.approvals.requisitionExtra.map((r) => keyed(r)),
    },
  };
}

function fromForm(value: FormValue, section: keyof FormValue): unknown {
  if (section === 'workforce')
    return {
      ...value.workforce,
      capacity: unkeyed(value.workforce.capacity),
      transferLimits: unkeyed(value.workforce.transferLimits),
    };
  if (section === 'approvals')
    return { requisitionExtra: unkeyed(value.approvals.requisitionExtra) };
  return value[section];
}

export default function RecruitingSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const remote = useRemote<{
    value: RecruitingSettingsValue;
    revision: number;
  }>('talent/recruiting/settings');
  return (
    <PageContainer>
      <PageHeader
        title={t('recruiting.settings.title')}
        description={t('recruiting.settings.description')}
      />
      {remote.error ? (
        <LoadError error={remote.error} onRetry={remote.reload} />
      ) : !remote.data ? (
        <BlockSkeleton rows={8} />
      ) : (
        // Keyed by revision: a saved revision starts the form again from the stored settings.
        <SettingsForm
          key={remote.data.revision}
          initial={remote.data.value}
          revision={remote.data.revision}
          onSaved={remote.reload}
        />
      )}
    </PageContainer>
  );
}

function SettingsForm({
  initial,
  revision,
  onSaved,
}: {
  initial: RecruitingSettingsValue;
  revision: number;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { busy, run } = useAction();
  const [value, setValue] = useState<FormValue>(() => toForm(initial));
  const save = (...sections: (keyof FormValue)[]) => {
    const json = {
      revision,
      value: Object.fromEntries(sections.map((s) => [s, fromForm(value, s)])),
    };
    void run(
      'save',
      { path: 'talent/recruiting/settings', method: 'PUT', json },
      t('recruiting.settings.saved'),
    ).then((done) => {
      if (done) onSaved();
    });
  };
  const patch = <K extends keyof FormValue>(
    section: K,
    part: Partial<FormValue[K]>,
  ) => setValue((v) => ({ ...v, [section]: { ...v[section], ...part } }));
  const route = (topic: (typeof TOPICS)[number]) => {
    const target = value.checkIns.routing[topic] ?? 'hrOwner';
    return target.startsWith('user:') ? 'hrOwner' : target;
  };
  const setTemplate = (
    key: (typeof TEMPLATES)[number],
    part: { subject?: string; body?: string },
  ) =>
    setValue((v) => {
      const next = {
        subject: v.templates[key]?.subject ?? '',
        body: v.templates[key]?.body ?? '',
        ...part,
      };
      return {
        ...v,
        templates: {
          ...v.templates,
          [key]: next.subject || next.body ? next : null,
        },
      };
    });
  return (
    <div className='grid gap-4 xl:grid-cols-2'>
      <Section
        title={t('recruiting.settings.publicPage')}
        onSave={() => save('publicPage')}
        busy={busy !== null}
      >
        <label className='flex items-center gap-2 text-sm'>
          <Checkbox
            checked={value.publicPage.enabled}
            onCheckedChange={(checked) =>
              patch('publicPage', { enabled: Boolean(checked) })
            }
          />
          {t('recruiting.settings.publicEnabled')}
        </label>
        <NumberField
          id='rs-ip'
          label={t('recruiting.settings.ipLimit')}
          value={value.publicPage.ipLimitPerHour}
          onChange={(n) => patch('publicPage', { ipLimitPerHour: n })}
        />
        <NumberField
          id='rs-mb'
          label={t('recruiting.settings.maxResume')}
          value={value.publicPage.maxResumeMb}
          onChange={(n) => patch('publicPage', { maxResumeMb: n })}
        />
      </Section>
      <Section
        title={t('recruiting.settings.reminders')}
        onSave={() => save('reminders', 'retention')}
        busy={busy !== null}
      >
        <NumberField
          id='rs-ret'
          label={t('recruiting.settings.retentionMonths')}
          value={value.retention.months}
          onChange={(n) => patch('retention', { months: n })}
        />
        <NumberField
          id='rs-stale'
          label={t('recruiting.settings.stageStale')}
          value={value.reminders.stageStaleDays}
          onChange={(n) => patch('reminders', { stageStaleDays: n })}
        />
        <NumberField
          id='rs-respond'
          label={t('recruiting.settings.offerRespond')}
          value={value.reminders.offerRespondDays}
          onChange={(n) => patch('reminders', { offerRespondDays: n })}
        />
        <TextField
          id='rs-pre'
          label={t('recruiting.settings.preboardingDays')}
          value={value.reminders.preboardingDays.join(',')}
          onChange={(s) => patch('reminders', { preboardingDays: numbers(s) })}
        />
        <NumberField
          id='rs-esc'
          label={t('recruiting.settings.escalate')}
          value={value.reminders.escalateDaysBefore}
          min={0}
          onChange={(n) => patch('reminders', { escalateDaysBefore: n })}
        />
      </Section>
      <WorkforceSection
        value={value.workforce}
        onChange={(part) => patch('workforce', part)}
        busy={busy !== null}
        onSave={() => save('workforce')}
      />
      <Section
        title={t('recruiting.settings.approvals')}
        onSave={() => save('approvals')}
        busy={busy !== null}
      >
        <ApprovalLevels
          value={value.approvals.requisitionExtra}
          onChange={(list) => patch('approvals', { requisitionExtra: list })}
        />
      </Section>
      <Section
        title={t('recruiting.settings.checkIns')}
        onSave={() => save('checkIns')}
        busy={busy !== null}
      >
        <TextField
          id='rs-ci-days'
          label={t('recruiting.settings.checkInDays')}
          value={value.checkIns.days.join(',')}
          onChange={(s) => patch('checkIns', { days: numbers(s) })}
        />
        <NumberField
          id='rs-ci-no'
          label={t('recruiting.settings.noReplyDays')}
          value={value.checkIns.noReplyDays}
          onChange={(n) => patch('checkIns', { noReplyDays: n })}
        />
        <Field>
          <FieldLabel htmlFor='rs-ci-q'>
            {t('recruiting.settings.questions')}
          </FieldLabel>
          <Textarea
            id='rs-ci-q'
            value={value.checkIns.questions.join('\n')}
            onChange={(e) =>
              patch('checkIns', {
                questions: e.target.value
                  .split('\n')
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>
        <p className='text-sm font-medium'>
          {t('recruiting.settings.routing')}
        </p>
        {TOPICS.map((topic) => (
          <div
            key={topic}
            className='grid grid-cols-[6rem_1fr] items-center gap-2'
          >
            <span className='text-sm'>
              {t(`recruiting.labels.topic.${topic}`)}
            </span>
            <NativeSelect
              aria-label={t(`recruiting.labels.topic.${topic}`)}
              value={route(topic)}
              onChange={(e) =>
                patch('checkIns', {
                  routing: {
                    ...value.checkIns.routing,
                    [topic]: e.target.value,
                  },
                })
              }
            >
              <NativeSelectOption value='hrOwner'>
                {t('recruiting.settings.routeHrOwner')}
              </NativeSelectOption>
              <NativeSelectOption value='departmentHead'>
                {t('recruiting.settings.routeHead')}
              </NativeSelectOption>
              <NativeSelectOption value='scheduler'>
                {t('recruiting.settings.routeScheduler')}
              </NativeSelectOption>
            </NativeSelect>
          </div>
        ))}
      </Section>
      <Section
        title={t('recruiting.settings.assistant')}
        onSave={() => save('assistant', 'interviews')}
        busy={busy !== null}
      >
        <NumberField
          id='rs-bulk'
          label={t('recruiting.settings.bulkHeadcount')}
          value={value.assistant.bulkHeadcount}
          onChange={(n) => patch('assistant', { bulkHeadcount: n })}
        />
        <NumberField
          id='rs-pool'
          label={t('recruiting.settings.poolLimit')}
          value={value.assistant.poolLimit}
          onChange={(n) => patch('assistant', { poolLimit: n })}
        />
        <TextField
          id='rs-free'
          label={t('recruiting.settings.freeShifts')}
          value={value.interviews.freeShiftCodes.join(',')}
          onChange={(s) => patch('interviews', { freeShiftCodes: words(s) })}
        />
      </Section>
      <Section
        title={t('recruiting.settings.email')}
        description={t('recruiting.settings.emailChannelHint')}
        onSave={() => save('email')}
        busy={busy !== null}
      >
        <TextField
          id='rs-channel'
          label={t('recruiting.settings.emailChannel')}
          value={value.email.channel}
          onChange={(s) => patch('email', { channel: s })}
        />
        <TextField
          id='rs-redirect'
          label={t('recruiting.settings.redirect')}
          value={value.email.redirectTo ?? ''}
          onChange={(s) => patch('email', { redirectTo: s || null })}
        />
      </Section>
      <Section
        title={t('recruiting.settings.templates')}
        description={t('recruiting.settings.templatesHint')}
        onSave={() => save('templates')}
        busy={busy !== null}
      >
        {TEMPLATES.map((key) => (
          <div key={key} className='space-y-1'>
            <p className='text-sm font-medium'>
              {t(`recruiting.labels.message.${key}`)}
            </p>
            <Input
              aria-label={t('recruiting.postings.subject')}
              placeholder={t('recruiting.postings.subject')}
              value={value.templates[key]?.subject ?? ''}
              onChange={(e) => setTemplate(key, { subject: e.target.value })}
            />
            <Textarea
              aria-label={t('recruiting.postings.body')}
              placeholder={t('recruiting.postings.body')}
              value={value.templates[key]?.body ?? ''}
              onChange={(e) => setTemplate(key, { body: e.target.value })}
            />
          </div>
        ))}
      </Section>
      <IntegrationSection />
    </div>
  );
}

function Section({
  title,
  description,
  children,
  onSave,
  busy,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onSave: () => void;
  busy: boolean;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className='space-y-3'>
        {children}
        <Button size='sm' disabled={busy} onClick={onSave}>
          {t('recruiting.common.save')}
        </Button>
      </CardContent>
    </Card>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  min = 1,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
}): ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type='number'
        min={min}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (s: string) => void;
}): ReactElement {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

function WorkforceSection({
  value: w,
  onChange: set,
  busy,
  onSave,
}: {
  value: FormValue['workforce'];
  onChange: (part: Partial<FormValue['workforce']>) => void;
  busy: boolean;
  onSave: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const lookups = useLookups();
  const setCapacity = (uid: string, part: Partial<CapacityRow>) =>
    set({
      capacity: w.capacity.map((r) => (r.uid === uid ? { ...r, ...part } : r)),
    });
  const setTransfer = (uid: string, part: Partial<TransferRow>) =>
    set({
      transferLimits: w.transferLimits.map((r) =>
        r.uid === uid ? { ...r, ...part } : r,
      ),
    });
  return (
    <Section
      title={t('recruiting.settings.workforce')}
      onSave={onSave}
      busy={busy}
    >
      <p className='text-sm font-medium'>{t('recruiting.settings.capacity')}</p>
      {w.capacity.map((row) => (
        <div
          key={row.uid}
          className='grid gap-2 rounded-lg border p-2 sm:grid-cols-2'
        >
          <NativeSelect
            aria-label={t('recruiting.common.department')}
            value={row.departmentId}
            onChange={(e) =>
              setCapacity(row.uid, { departmentId: e.target.value })
            }
          >
            {lookups.departments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <NativeSelect
            aria-label={t('recruiting.common.position')}
            value={row.positionId}
            onChange={(e) =>
              setCapacity(row.uid, { positionId: e.target.value })
            }
          >
            {lookups.positions.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {(['outputPerShift', 'shiftsPerMonth', 'hoursPerShift'] as const).map(
            (key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`rs-${key}-${row.uid}`}>
                  {t(
                    `recruiting.workforce.${key === 'outputPerShift' ? 'perShift' : key}`,
                  )}
                </FieldLabel>
                <Input
                  id={`rs-${key}-${row.uid}`}
                  type='number'
                  min={0}
                  step='any'
                  value={row[key]}
                  onChange={(e) =>
                    setCapacity(row.uid, { [key]: Number(e.target.value) })
                  }
                />
              </Field>
            ),
          )}
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() =>
              set({ capacity: w.capacity.filter((r) => r.uid !== row.uid) })
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
          set({
            capacity: [
              ...w.capacity,
              keyed({
                departmentId: lookups.departments[0]?.id ?? '',
                positionId: lookups.positions[0]?.id ?? '',
                outputPerShift: 100,
                shiftsPerMonth: 22,
                hoursPerShift: 8,
              }),
            ],
          })
        }
      >
        {t('recruiting.settings.addCapacity')}
      </Button>
      <p className='text-sm font-medium'>{t('recruiting.settings.transfer')}</p>
      {w.transferLimits.map((row) => (
        <div
          key={row.uid}
          className='grid gap-2 rounded-lg border p-2 sm:grid-cols-2'
        >
          <NativeSelect
            aria-label={t('recruiting.common.department')}
            value={row.departmentId}
            onChange={(e) =>
              setTransfer(row.uid, { departmentId: e.target.value })
            }
          >
            {lookups.departments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            aria-label={t('recruiting.settings.maxHeadcount')}
            type='number'
            min={0}
            value={row.maxHeadcount}
            onChange={(e) =>
              setTransfer(row.uid, { maxHeadcount: Number(e.target.value) })
            }
          />
          <div className='sm:col-span-2'>
            <p className='text-xs text-muted-foreground'>
              {t('recruiting.settings.coordinator')}
            </p>
            <PeoplePicker
              single
              value={row.coordinatorUserId ? [row.coordinatorUserId] : []}
              onChange={(ids) =>
                setTransfer(row.uid, { coordinatorUserId: ids[0] ?? null })
              }
            />
          </div>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() =>
              set({
                transferLimits: w.transferLimits.filter(
                  (r) => r.uid !== row.uid,
                ),
              })
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
          set({
            transferLimits: [
              ...w.transferLimits,
              keyed({
                departmentId: lookups.departments[0]?.id ?? '',
                maxHeadcount: 1,
                coordinatorUserId: null,
              }),
            ],
          })
        }
      >
        {t('recruiting.settings.addTransfer')}
      </Button>
      <NumberField
        id='rs-cycle'
        label={t('recruiting.settings.recruitingCycle')}
        value={w.recruitingCycleDays}
        min={0}
        onChange={(n) => set({ recruitingCycleDays: n })}
      />
      <NumberField
        id='rs-onb'
        label={t('recruiting.settings.onboardingDays')}
        value={w.onboardingDays}
        min={0}
        onChange={(n) => set({ onboardingDays: n })}
      />
      <NumberField
        id='rs-absorb'
        label={t('recruiting.settings.absorb')}
        value={w.absorbOvertimeHours}
        min={0}
        onChange={(n) => set({ absorbOvertimeHours: n })}
      />
    </Section>
  );
}

function ApprovalLevels({
  value,
  onChange,
}: {
  value: Keyed<ApprovalRow>[];
  onChange: (list: Keyed<ApprovalRow>[]) => void;
}): ReactElement {
  const setRow = (uid: string, part: Partial<ApprovalRow>) =>
    onChange(value.map((r) => (r.uid === uid ? { ...r, ...part } : r)));
  const { t } = useTranslation();
  const lookups = useLookups();
  return (
    <div className='space-y-2'>
      {value.map((row) => (
        <div
          key={row.uid}
          className='grid gap-2 rounded-lg border p-2 sm:grid-cols-2'
        >
          <NativeSelect
            aria-label={t('recruiting.common.department')}
            value={row.departmentId}
            onChange={(e) => setRow(row.uid, { departmentId: e.target.value })}
          >
            {lookups.departments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Input
            aria-label={t('recruiting.settings.levelName')}
            placeholder={t('recruiting.settings.levelName')}
            value={row.name}
            onChange={(e) => setRow(row.uid, { name: e.target.value })}
          />
          <div className='sm:col-span-2'>
            <p className='text-xs text-muted-foreground'>
              {t('recruiting.settings.approver')}
            </p>
            <PeoplePicker
              single
              value={row.approverUserId ? [row.approverUserId] : []}
              onChange={(ids) =>
                setRow(row.uid, { approverUserId: ids[0] ?? '' })
              }
            />
          </div>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            onClick={() => onChange(value.filter((r) => r.uid !== row.uid))}
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
          onChange([
            ...value,
            keyed({
              departmentId: lookups.departments[0]?.id ?? '',
              name: '',
              approverUserId: '',
            }),
          ])
        }
      >
        {t('recruiting.settings.addLevel')}
      </Button>
    </div>
  );
}

function IntegrationSection(): ReactElement {
  const { t } = useTranslation();
  const integration = useRemote<{
    accounts: { id: string; name: string }[];
    keys: {
      id: string;
      name: string;
      createdAt: string | null;
      disabledAt: string | null;
    }[];
  }>('talent/recruiting/settings/integration');
  const { busy, run } = useAction();
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recruiting.settings.integration')}</CardTitle>
        <CardDescription>
          {t('recruiting.settings.integrationHint')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        {integration.data && !integration.data.accounts.length ? (
          <p className='text-muted-foreground'>
            {t('recruiting.settings.noAccount')}
          </p>
        ) : null}
        {(integration.data?.keys ?? []).map((k) => (
          <div key={k.id} className='flex items-center justify-between gap-2'>
            <span>
              {k.name} · {k.createdAt?.slice(0, 10)}
            </span>
            {k.disabledAt ? (
              <span className='text-muted-foreground'>
                {t('recruiting.settings.disabled')}
              </span>
            ) : (
              <Button
                size='sm'
                variant='outline'
                disabled={busy !== null}
                onClick={() => {
                  void (async () => {
                    if (
                      await run('disable', {
                        path: `talent/recruiting/settings/integration/keys/${encodeURIComponent(k.id)}/disable`,
                      })
                    )
                      integration.reload();
                  })();
                }}
              >
                {t('recruiting.settings.disableKey')}
              </Button>
            )}
          </div>
        ))}
        {secret ? (
          <p className='break-all rounded-md bg-muted p-2 font-mono text-xs'>
            {t('recruiting.settings.keyCreated')} {secret}
          </p>
        ) : null}
        <Button
          size='sm'
          disabled={busy !== null || !integration.data?.accounts.length}
          onClick={() => {
            void (async () => {
              const created = await run<{ secret: string }>('create', {
                path: 'talent/recruiting/settings/integration/keys',
                json: {},
              });
              if (created) {
                setSecret(created.secret);
                integration.reload();
              }
            })();
          }}
        >
          {t('recruiting.settings.createKey')}
        </Button>
      </CardContent>
    </Card>
  );
}
