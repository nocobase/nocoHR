import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RefreshCwIcon, SparklesIcon, Undo2Icon } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';

import { talentToolRenderers } from '@/components/talent/ai-tool-renderers';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import {
  AIChatProvider,
  AIChatWindow,
  NocoBaseAIRootProvider,
} from '@/extensions/nocobase-ai';

import { CardShell, SaveFooter } from './other-cards.js';
import type { Settings, Snapshot } from './types.js';
import { useSection } from './use-section.js';

/** 变动影响清单 (V1-02): which changes get a checklist, and how often an overdue one reminds its owner. */
export function ChecklistsCard({
  initial,
}: {
  readonly initial: Snapshot<Settings['checklists']>;
}): ReactElement {
  const { t } = useTranslation();
  const section = useSection('checklists', initial);
  const value = section.snapshot.value;
  const [interval, setInterval] = useState(
    String(initial.value.reminderIntervalDays),
  );
  const invalid =
    !/^\d+$/u.test(interval.trim()) ||
    Number(interval) < 1 ||
    Number(interval) > 30;
  return (
    <CardShell
      section='checklists'
      error={section.error}
      footer={
        <SaveFooter
          section={section as ReturnType<typeof useSection>}
          dirty={!invalid && Number(interval) !== value.reminderIntervalDays}
          onSave={() =>
            void section.save({
              ...value,
              reminderIntervalDays: Number(interval),
            })
          }
          onReloaded={(next) =>
            setInterval(
              String((next as Settings['checklists']).reminderIntervalDays),
            )
          }
        />
      }
    >
      <>
        {(['onboard', 'change', 'offboard'] as const).map((key) => (
          <div key={key} className='flex items-start justify-between gap-4'>
            <Label htmlFor={`checklists-${key}`}>
              {t(`personnelSettings.checklists.${key}`)}
            </Label>
            <Switch
              id={`checklists-${key}`}
              checked={value[key]}
              disabled={section.busy}
              onCheckedChange={(checked) =>
                void section.save({ ...value, [key]: checked })
              }
            />
          </div>
        ))}
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor='checklists-interval'>
            {t('personnelSettings.checklists.reminderIntervalDays')} *
          </FieldLabel>
          <Input
            id='checklists-interval'
            inputMode='numeric'
            className='w-32'
            value={interval}
            disabled={section.busy}
            aria-invalid={invalid}
            onChange={(event) => setInterval(event.target.value)}
          />
          {invalid ? (
            <FieldError>{t('personnelSettings.checklists.invalid')}</FieldError>
          ) : null}
        </Field>
      </>
    </CardShell>
  );
}

const LIMIT_KEYS = [
  'underThreeMonths',
  'underOneYear',
  'underThreeYears',
  'threeYearsOrOpen',
] as const;

/** 用工合规检查 (V1-02): the four checks, the no-contract threshold and the probation limits by contract term. */
export function ComplianceCard({
  initial,
}: {
  readonly initial: Snapshot<Settings['compliance']>;
}): ReactElement {
  const { t } = useTranslation();
  const section = useSection('compliance', initial);
  const value = section.snapshot.value;
  const textOf = (v: Settings['compliance']) =>
    ({
      noContractDays: String(v.noContractDays),
      ...Object.fromEntries(
        LIMIT_KEYS.map((k) => [k, String(v.probationLimits[k])]),
      ),
    }) as Record<'noContractDays' | (typeof LIMIT_KEYS)[number], string>;
  const [draft, setDraft] = useState(() => textOf(initial.value));
  const saved = textOf(value);
  const invalid = {
    noContractDays:
      !/^\d+$/u.test(draft.noContractDays.trim()) ||
      Number(draft.noContractDays) < 1 ||
      Number(draft.noContractDays) > 120,
    ...Object.fromEntries(
      LIMIT_KEYS.map((k) => [
        k,
        !/^\d+$/u.test(draft[k].trim()) || Number(draft[k]) > 6,
      ]),
    ),
  } as Record<keyof typeof draft, boolean>;
  const dirty = (Object.keys(draft) as (keyof typeof draft)[]).some(
    (k) => draft[k].trim() !== saved[k],
  );
  return (
    <CardShell
      section='compliance'
      error={section.error}
      footer={
        <SaveFooter
          section={section as ReturnType<typeof useSection>}
          dirty={dirty && !Object.values(invalid).some(Boolean)}
          onSave={() =>
            void section.save({
              ...value,
              noContractDays: Number(draft.noContractDays),
              probationLimits: Object.fromEntries(
                LIMIT_KEYS.map((k) => [k, Number(draft[k])]),
              ) as Settings['compliance']['probationLimits'],
            })
          }
          onReloaded={(next) =>
            setDraft(textOf(next as Settings['compliance']))
          }
        />
      }
    >
      <>
        <div className='flex items-start justify-between gap-4'>
          <Label htmlFor='compliance-enabled'>
            {t('personnelSettings.compliance.enabled')}
          </Label>
          <Switch
            id='compliance-enabled'
            checked={value.enabled}
            disabled={section.busy}
            onCheckedChange={(checked) =>
              void section.save({ ...value, enabled: checked })
            }
          />
        </div>
        {(
          [
            'secondFixedTerm',
            'probationLimit',
            'noContract',
            'expiredContract',
          ] as const
        ).map((key) => (
          <div key={key} className='flex items-start justify-between gap-4'>
            <Label htmlFor={`compliance-${key}`} className='font-normal'>
              {t(`compliance.kinds.${key}`)}
            </Label>
            <Switch
              id={`compliance-${key}`}
              checked={value.checks[key]}
              disabled={section.busy || !value.enabled}
              onCheckedChange={(checked) =>
                void section.save({
                  ...value,
                  checks: { ...value.checks, [key]: checked },
                })
              }
            />
          </div>
        ))}
        <FieldGroup>
          {(['noContractDays', ...LIMIT_KEYS] as const).map((key) => (
            <Field key={key} data-invalid={invalid[key]}>
              <FieldLabel htmlFor={`compliance-${key}`}>
                {t(`personnelSettings.compliance.${key}`)} *
              </FieldLabel>
              <Input
                id={`compliance-${key}`}
                inputMode='numeric'
                className='w-32'
                value={draft[key]}
                disabled={section.busy}
                aria-invalid={invalid[key]}
                onChange={(event) =>
                  setDraft((d) => ({ ...d, [key]: event.target.value }))
                }
              />
            </Field>
          ))}
        </FieldGroup>
        <p className='text-sm text-muted-foreground'>
          {t('personnelSettings.compliance.legalNote')}
        </p>
      </>
    </CardShell>
  );
}

interface DraftItem {
  index: number;
  input: {
    type: 'chainRule' | 'customField' | 'setting';
    [key: string]: unknown;
  };
  preview: {
    departmentTitle?: string;
    steps?: {
      level: number;
      kind: string;
      name: string | null;
      approverNames: string[];
      merged: unknown[];
    }[];
    field?: { label: { 'zh-CN': string }; type: string; placements: string[] };
    changed?: { key: string; before: unknown; after: unknown }[];
  };
  warnings: string[];
  status: 'draft' | 'applied' | 'discarded' | 'reverted';
}
interface SettingsChange {
  id: string;
  utterance: string;
  status: string;
  items: DraftItem[];
  createdByName: string | null;
  createdAt: string;
}

/**
 * 一句话改配置 (V1-02): the drafts the HR assistant made from an
 * administrator's sentence. Nothing takes effect until a draft is applied
 * here; an applied change can be reverted as a whole.
 */
export function DraftsCard({
  onApplied,
}: {
  readonly onApplied: () => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const remote = useRemote<SettingsChange[]>('talent/settings-drafts');
  const [chatOpen, setChatOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const format = new Intl.DateTimeFormat(i18n?.language ?? 'zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  async function act(path: string, key: string, applied: boolean) {
    setBusy(key);
    try {
      await api.request({ path, method: 'POST', json: {} });
      remote.reload();
      if (applied) onApplied();
      toast.add({ type: 'success', title: t('personnelSettings.drafts.done') });
    } catch (error) {
      toast.add({ type: 'error', title: errorMessage(error, t) });
    } finally {
      setBusy(null);
    }
  }

  const describe = (item: DraftItem): string => {
    if (item.input.type === 'chainRule')
      return t('personnelSettings.drafts.chainRule', {
        department: item.preview.departmentTitle ?? '',
        name: typeof item.input.name === 'string' ? item.input.name : '',
        steps: (item.preview.steps ?? [])
          .map(
            (s) =>
              `${s.name ?? t(`personnelSettings.drafts.kinds.${s.kind}`)}（${s.approverNames.join('、') || t('personnelSettings.drafts.anyHr')}）`,
          )
          .join(' → '),
      });
    if (item.input.type === 'customField')
      return t('personnelSettings.drafts.customField', {
        label: item.preview.field?.label['zh-CN'] ?? '',
        type: t(`customFields.types.${item.preview.field?.type ?? 'text'}`),
        placements: (item.preview.field?.placements ?? [])
          .map((p) => t(`customFields.placements.${p}`))
          .join('、'),
      });
    return t('personnelSettings.drafts.setting', {
      section: t(`personnelSettings.${String(item.input.section)}.title`),
      changes: (item.preview.changed ?? [])
        .map(
          (c) =>
            `${c.key}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`,
        )
        .join('；'),
    });
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('personnelSettings.drafts.title')}</CardTitle>
          <CardDescription>
            {t('personnelSettings.drafts.description')}
          </CardDescription>
          <CardAction className='flex gap-2'>
            <Button
              variant='ghost'
              size='icon'
              aria-label={t('personnelSettings.drafts.refresh')}
              onClick={remote.reload}
            >
              <RefreshCwIcon />
            </Button>
            <Button onClick={() => setChatOpen(true)}>
              <SparklesIcon data-icon='inline-start' />
              {t('personnelSettings.drafts.ask')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className='space-y-4'>
          {remote.error ? (
            <LoadError error={remote.error} onRetry={remote.reload} />
          ) : !remote.data ? (
            <BlockSkeleton rows={2} />
          ) : !remote.data.length ? (
            <p className='text-sm text-muted-foreground'>
              {t('personnelSettings.drafts.empty')}
            </p>
          ) : (
            remote.data.slice(0, 10).map((change) => (
              <div key={change.id} className='space-y-2 rounded-lg border p-3'>
                <div className='flex flex-wrap items-start justify-between gap-2'>
                  <p className='text-sm font-medium'>“{change.utterance}”</p>
                  <span className='text-xs text-muted-foreground'>
                    {change.createdByName ?? ''} ·{' '}
                    {format.format(new Date(change.createdAt))}
                  </span>
                </div>
                <ul className='space-y-2'>
                  {change.items.map((item) => (
                    <li
                      key={item.index}
                      className='flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between'
                    >
                      <div className='space-y-1'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <Badge variant='outline'>
                            {t(
                              `personnelSettings.drafts.types.${item.input.type}`,
                            )}
                          </Badge>
                          <Badge
                            variant={
                              item.status === 'applied'
                                ? 'secondary'
                                : 'outline'
                            }
                          >
                            {t(
                              `personnelSettings.drafts.status.${item.status}`,
                            )}
                          </Badge>
                        </div>
                        <p className='text-sm'>{describe(item)}</p>
                        {item.warnings.map((w) => (
                          <p key={w} className='text-sm text-muted-foreground'>
                            {t(`personnelSettings.drafts.warnings.${w}`)}
                          </p>
                        ))}
                      </div>
                      {item.status === 'draft' ? (
                        <div className='flex shrink-0 gap-2'>
                          <Button
                            size='sm'
                            disabled={busy !== null}
                            onClick={() =>
                              void act(
                                `talent/settings-drafts/${change.id}/items/${item.index}/apply`,
                                `${change.id}:${item.index}`,
                                true,
                              )
                            }
                          >
                            {t('personnelSettings.drafts.apply')}
                          </Button>
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={busy !== null}
                            onClick={() =>
                              void act(
                                `talent/settings-drafts/${change.id}/items/${item.index}/discard`,
                                `${change.id}:${item.index}`,
                                false,
                              )
                            }
                          >
                            {t('personnelSettings.drafts.discard')}
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {change.items.some((i) => i.status === 'applied') ? (
                  <div className='flex justify-end'>
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={busy !== null}
                      onClick={() =>
                        void act(
                          `talent/settings-drafts/${change.id}/revert`,
                          change.id,
                          true,
                        )
                      }
                    >
                      <Undo2Icon data-icon='inline-start' />
                      {t('personnelSettings.drafts.revert')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <Sheet
        open={chatOpen}
        onOpenChange={(open) => {
          setChatOpen(open);
          if (!open) remote.reload();
        }}
      >
        <SheetContent className='w-full sm:max-w-xl'>
          <SheetHeader>
            <SheetTitle>{t('personnelSettings.drafts.chatTitle')}</SheetTitle>
            <SheetDescription>
              {t('personnelSettings.drafts.chatDescription')}
            </SheetDescription>
          </SheetHeader>
          <div className='flex min-h-0 flex-1 flex-col px-4 pb-4'>
            <NocoBaseAIRootProvider toolRenderers={talentToolRenderers}>
              <DraftChat />
            </NocoBaseAIRootProvider>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function DraftChat(): ReactElement {
  const { t } = useTranslation();
  const examples = useMemo(
    () =>
      ['chain', 'field'].map((key) => ({
        title: t(`personnelSettings.drafts.examples.${key}`),
        message: { user: t(`personnelSettings.drafts.examples.${key}`) },
        autoSend: false,
      })),
    [t],
  );
  return (
    <AIChatProvider
      id='settings-draft-assistant'
      defaultEmployee='hrAssistant'
      employeeTasks={{ hrAssistant: examples }}
      employeeGreetings={{
        hrAssistant: t('personnelSettings.drafts.greeting'),
      }}
    >
      <div className='flex h-[70svh] min-h-80 flex-col'>
        <AIChatWindow
          showEmployeeSelector={false}
          placeholder={t('personnelSettings.drafts.placeholder')}
        />
      </div>
    </AIChatProvider>
  );
}
