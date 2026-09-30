/**
 * V4-12 考核方案 (`/talent/review-schemes`, hr.admin): dimensions and weights
 * (合计 100), the rating scale, the enabled stages, the quality and safety
 * rules and the distribution guide; the bonus coefficients are shown read-only
 * (薪酬专员 maintains them in 薪酬设置 · 绩效系数). Administrator-added fields
 * (字段管理, table 考核方案) appear in the form and on each scheme.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import {
  CustomFieldInputs,
  CustomFieldValues,
} from '@/components/talent/custom-fields';
import type {
  CustomFieldDefinition,
  CustomValues,
} from '@/components/talent/custom-field-model';
import { useAction } from '@/components/talent/performance-hooks';
import { type RatingOption } from '@/components/talent/performance-shared';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const SECTION_KEYS = [
  'goals',
  'competencies',
  'qualitySafety',
  'peer',
] as const;

interface QualityRules {
  base: number;
  min: number;
  perIssue: { critical: number; major: number; minor: number };
  excludeCategories: string[];
  learningOnTime: { enabled: boolean; below: number; points: number };
  certificateExpired: { enabled: boolean; points: number };
  absentDays: { enabled: boolean; perDay: number };
}

export interface SchemeView {
  id: string;
  title: string;
  appliesTo: {
    positionIds: string[];
    jobFamilyIds: string[];
    grades: string[];
  };
  sections: { key: string; weight: number }[];
  ratingScale: RatingOption[];
  stages: {
    goalSetting: boolean;
    selfReview: boolean;
    peerReview: { enabled: boolean; count: number };
    managerReview: true;
    skipLevelReview: boolean;
    calibration: boolean;
  };
  qualitySafetyRules: QualityRules;
  distributionGuide: Record<string, { max?: number; min?: number }>;
  ratingCoefficients: Record<string, number> | null;
  scoring: {
    competencyBase: number;
    competencyCap: number;
    overrideReasonDelta: number;
    ratingReasonGap: number;
  };
  active: boolean;
  customFields: CustomValues;
}

export default function ReviewSchemesPage(): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<{
    schemes: SchemeView[];
    fields: CustomFieldDefinition[];
    can: { manage: boolean };
  }>('talent/performance/schemes');
  const [editing, setEditing] = useState<SchemeView | 'new' | null>(null);
  const lookups = useLookups();
  return (
    <PageContainer>
      <PageHeader
        title={t('performance.schemes.title')}
        description={t('performance.schemes.description')}
        actions={
          list.data?.can.manage ? (
            <Button onClick={() => setEditing('new')}>
              <PlusIcon />
              {t('performance.schemes.create')}
            </Button>
          ) : null
        }
      />
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={4} />
      ) : !list.data.schemes.length ? (
        <EmptyState title={t('performance.schemes.empty')} />
      ) : (
        <div className='grid gap-4 xl:grid-cols-2'>
          {list.data.schemes.map((scheme) => (
            <Card key={scheme.id}>
              <CardHeader>
                <CardTitle>{scheme.title}</CardTitle>
                <CardDescription>
                  {[
                    ...scheme.appliesTo.positionIds.map((id) =>
                      lookups.positionTitle(id),
                    ),
                    ...scheme.appliesTo.jobFamilyIds.map((id) =>
                      t('performance.schemes.family', { id }),
                    ),
                    ...scheme.appliesTo.grades.map((g) => g),
                  ].join(' · ')}
                </CardDescription>
                <CardAction className='flex gap-2'>
                  {scheme.active ? null : (
                    <Badge variant='outline'>
                      {t('performance.schemes.inactive')}
                    </Badge>
                  )}
                  {list.data!.can.manage ? (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => setEditing(scheme)}
                    >
                      {t('performance.common.edit')}
                    </Button>
                  ) : null}
                </CardAction>
              </CardHeader>
              <CardContent className='space-y-3 text-sm'>
                <div className='flex flex-wrap gap-2'>
                  {scheme.sections.map((section) => (
                    <Badge key={section.key} variant='secondary'>
                      {t(`performance.sections.${section.key}`)}{' '}
                      {section.weight}
                    </Badge>
                  ))}
                </div>
                <p className='text-muted-foreground'>
                  {scheme.ratingScale
                    .map((r) => `${r.code} ${r.score}`)
                    .join(' · ')}
                </p>
                <p className='text-muted-foreground'>
                  {[
                    scheme.stages.goalSetting &&
                      t('performance.stage.goalSetting'),
                    scheme.stages.selfReview &&
                      t('performance.stage.selfReview'),
                    scheme.stages.peerReview.enabled &&
                      t('performance.schemes.peerCount', {
                        count: scheme.stages.peerReview.count,
                      }),
                    t('performance.stage.managerReview'),
                    scheme.stages.skipLevelReview &&
                      t('performance.stage.skipLevelReview'),
                    scheme.stages.calibration &&
                      t('performance.stage.calibration'),
                  ]
                    .filter(Boolean)
                    .join(' → ')}
                </p>
                <p className='text-muted-foreground'>
                  {t('performance.schemes.rulesSummary', {
                    major: scheme.qualitySafetyRules.perIssue.major,
                    minor: scheme.qualitySafetyRules.perIssue.minor,
                    min: scheme.qualitySafetyRules.min,
                  })}
                </p>
                <p className='text-muted-foreground'>
                  {t('performance.schemes.guide')}：
                  {Object.entries(scheme.distributionGuide)
                    .map(
                      ([key, rule]) =>
                        `${key} ${rule.max !== undefined ? `≤${rule.max}%` : ''}${rule.min !== undefined ? `≥${rule.min}%` : ''}`,
                    )
                    .join('、') || '—'}
                </p>
                <div className='rounded-md bg-muted/60 p-2'>
                  <p className='text-xs text-muted-foreground'>
                    {t('performance.schemes.coefficientsReadOnly')}
                  </p>
                  <p className='tabular-nums'>
                    {scheme.ratingCoefficients
                      ? Object.entries(scheme.ratingCoefficients)
                          .map(([code, value]) => `${code} ${value}`)
                          .join(' · ')
                      : t('performance.schemes.noCoefficients')}
                  </p>
                </div>
                <CustomFieldValues
                  definitions={list.data!.fields}
                  values={scheme.customFields}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <SchemeDialog
        scheme={editing}
        fields={list.data?.fields ?? []}
        onClose={() => setEditing(null)}
        onDone={list.reload}
      />
    </PageContainer>
  );
}

const DEFAULT_RATINGS: RatingOption[] = [
  { code: 'S', score: 5, description: '' },
  { code: 'A', score: 4, description: '' },
  { code: 'B', score: 3, description: '' },
  { code: 'C', score: 2, description: '' },
  { code: 'D', score: 1, description: '' },
];
const DEFAULT_RULES: QualityRules = {
  base: 5,
  min: 1,
  perIssue: { critical: -3, major: -1.5, minor: -0.5 },
  excludeCategories: ['设备故障'],
  learningOnTime: { enabled: true, below: 90, points: -1 },
  certificateExpired: { enabled: true, points: -1 },
  absentDays: { enabled: false, perDay: -0.5 },
};

/** Rows of the rating editor keep a key of their own while codes are typed. */
function withKeys(
  list: readonly RatingOption[],
): (RatingOption & { rowKey: string })[] {
  return list.map((rating, position) => ({
    ...rating,
    rowKey: `rating-${position}`,
  }));
}

function SchemeDialog({
  scheme,
  fields,
  onClose,
  onDone,
}: {
  scheme: SchemeView | 'new' | null;
  fields: CustomFieldDefinition[];
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const lookups = useLookups();
  const action = useAction();
  const current = scheme && scheme !== 'new' ? scheme : null;
  const [seen, setSeen] = useState<SchemeView | 'new' | null>(null);
  const [title, setTitle] = useState('');
  const [positions, setPositions] = useState<string[]>([]);
  const [families, setFamilies] = useState('');
  const [grades, setGrades] = useState('');
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [ratings, setRatings] = useState<(RatingOption & { rowKey: string })[]>(
    () => withKeys(DEFAULT_RATINGS),
  );
  const [stages, setStages] = useState<SchemeView['stages']>({
    goalSetting: true,
    selfReview: true,
    peerReview: { enabled: false, count: 3 },
    managerReview: true,
    skipLevelReview: false,
    calibration: true,
  });
  const [rules, setRules] = useState<QualityRules>(DEFAULT_RULES);
  const [guide, setGuide] = useState({ S: '10', A: '25', CD: '5' });
  const [active, setActive] = useState(true);
  const [custom, setCustom] = useState<CustomValues>({});
  if (scheme !== seen) {
    setSeen(scheme);
    setTitle(current?.title ?? '');
    setPositions(current?.appliesTo.positionIds ?? []);
    setFamilies((current?.appliesTo.jobFamilyIds ?? []).join(', '));
    setGrades((current?.appliesTo.grades ?? []).join(', '));
    setWeights(
      Object.fromEntries(
        (
          current?.sections ?? [
            { key: 'goals', weight: 30 },
            { key: 'competencies', weight: 40 },
            { key: 'qualitySafety', weight: 30 },
          ]
        ).map((s) => [s.key, String(s.weight)]),
      ),
    );
    setRatings(withKeys(current?.ratingScale ?? DEFAULT_RATINGS));
    if (current) setStages(current.stages);
    setRules(current?.qualitySafetyRules ?? DEFAULT_RULES);
    setGuide({
      S: String(current?.distributionGuide.S?.max ?? ''),
      A: String(current?.distributionGuide.A?.max ?? ''),
      CD: String(current?.distributionGuide['C+D']?.min ?? ''),
    });
    setActive(current?.active ?? true);
    setCustom(current?.customFields ?? {});
  }
  const total = SECTION_KEYS.reduce(
    (sum, key) => sum + (Number(weights[key]) || 0),
    0,
  );
  const list = (text: string) => text.split(/[,，\s]+/u).filter(Boolean);
  async function save(): Promise<void> {
    const guideValue: Record<string, { max?: number; min?: number }> = {};
    if (guide.S) guideValue.S = { max: Number(guide.S) };
    if (guide.A) guideValue.A = { max: Number(guide.A) };
    if (guide.CD) guideValue['C+D'] = { min: Number(guide.CD) };
    const json = {
      title,
      appliesTo: {
        positionIds: positions,
        jobFamilyIds: list(families),
        grades: list(grades),
      },
      sections: SECTION_KEYS.filter((key) => Number(weights[key]) > 0).map(
        (key) => ({ key, weight: Number(weights[key]) }),
      ),
      ratingScale: ratings.map(({ rowKey: _rowKey, ...r }) => ({
        ...r,
        score: Number(r.score),
      })),
      stages,
      qualitySafetyRules: rules,
      distributionGuide: guideValue,
      scoring: current?.scoring,
      active,
      customFields: custom,
    };
    const done = current
      ? await action.run(
          {
            method: 'PUT',
            path: `talent/performance/schemes/${encodeURIComponent(current.id)}`,
            json,
          },
          t('performance.schemes.saved'),
        )
      : await action.run(
          { method: 'POST', path: 'talent/performance/schemes', json },
          t('performance.schemes.saved'),
        );
    if (done) {
      onDone();
      onClose();
    }
  }
  const numberInput = (
    id: string,
    value: number,
    onChange: (value: number) => void,
    step = 0.5,
  ) => (
    <Input
      id={id}
      type='number'
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
  return (
    <Dialog
      open={Boolean(scheme)}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>
            {t(
              current
                ? 'performance.schemes.edit'
                : 'performance.schemes.create',
            )}
          </DialogTitle>
          <DialogDescription>
            {t('performance.schemes.dialogHint')}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <Field>
            <FieldLabel htmlFor='scheme-title'>
              {t('performance.schemes.schemeTitle')}
            </FieldLabel>
            <Input
              id='scheme-title'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <fieldset className='space-y-2'>
            <legend className='text-sm font-medium'>
              {t('performance.schemes.appliesTo')}
            </legend>
            <div className='grid gap-1 sm:grid-cols-2'>
              {lookups.positions.map((position) => (
                <label
                  key={position.id}
                  className='flex items-center gap-2 text-sm'
                >
                  <Checkbox
                    checked={positions.includes(position.id)}
                    onCheckedChange={(checked) =>
                      setPositions((ids) =>
                        checked
                          ? [...ids, position.id]
                          : ids.filter((id) => id !== position.id),
                      )
                    }
                  />
                  {position.title}
                </label>
              ))}
            </div>
            <div className='grid gap-2 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='scheme-families'>
                  {t('performance.schemes.jobFamilies')}
                </FieldLabel>
                <Input
                  id='scheme-families'
                  value={families}
                  onChange={(e) => setFamilies(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='scheme-grades'>
                  {t('performance.schemes.grades')}
                </FieldLabel>
                <Input
                  id='scheme-grades'
                  value={grades}
                  onChange={(e) => setGrades(e.target.value)}
                />
              </Field>
            </div>
          </fieldset>
          <fieldset className='space-y-2'>
            <legend className='text-sm font-medium'>
              {t('performance.schemes.weights', { total })}
            </legend>
            <div className='grid gap-2 sm:grid-cols-4'>
              {SECTION_KEYS.map((key) => (
                <Field key={key}>
                  <FieldLabel htmlFor={`weight-${key}`}>
                    {t(`performance.sections.${key}`)}
                  </FieldLabel>
                  <Input
                    id={`weight-${key}`}
                    type='number'
                    min={0}
                    max={100}
                    value={weights[key] ?? ''}
                    onChange={(e) =>
                      setWeights({ ...weights, [key]: e.target.value })
                    }
                  />
                </Field>
              ))}
            </div>
            {total !== 100 ? (
              <p className='text-sm text-destructive'>
                {t('performance.schemes.weightsMust')}
              </p>
            ) : null}
          </fieldset>
          <fieldset className='space-y-2'>
            <legend className='text-sm font-medium'>
              {t('performance.schemes.ratings')}
            </legend>
            {ratings.map((rating, index) => (
              <div
                key={rating.rowKey}
                className='grid gap-2 sm:grid-cols-[5rem_5rem_1fr]'
              >
                <Input
                  aria-label={t('performance.schemes.ratingCode')}
                  value={rating.code}
                  onChange={(e) =>
                    setRatings(
                      ratings.map((r, i) =>
                        i === index
                          ? { ...r, code: e.target.value.toUpperCase() }
                          : r,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={t('performance.schemes.ratingScore')}
                  type='number'
                  value={rating.score}
                  onChange={(e) =>
                    setRatings(
                      ratings.map((r, i) =>
                        i === index
                          ? { ...r, score: Number(e.target.value) }
                          : r,
                      ),
                    )
                  }
                />
                <Input
                  aria-label={t('performance.schemes.ratingDescription')}
                  value={rating.description}
                  onChange={(e) =>
                    setRatings(
                      ratings.map((r, i) =>
                        i === index ? { ...r, description: e.target.value } : r,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </fieldset>
          <fieldset className='space-y-2'>
            <legend className='text-sm font-medium'>
              {t('performance.schemes.stages')}
            </legend>
            <div className='grid gap-2 text-sm sm:grid-cols-3'>
              {(
                [
                  'goalSetting',
                  'selfReview',
                  'skipLevelReview',
                  'calibration',
                ] as const
              ).map((key) => (
                <label key={key} className='flex items-center gap-2'>
                  <Checkbox
                    checked={stages[key]}
                    onCheckedChange={(checked) =>
                      setStages({ ...stages, [key]: Boolean(checked) })
                    }
                  />
                  {t(`performance.stage.${key}`)}
                </label>
              ))}
              <label className='flex items-center gap-2'>
                <Checkbox
                  checked={stages.peerReview.enabled}
                  onCheckedChange={(checked) =>
                    setStages({
                      ...stages,
                      peerReview: {
                        ...stages.peerReview,
                        enabled: Boolean(checked),
                      },
                    })
                  }
                />
                {t('performance.stage.peerReview')}
              </label>
              <Field>
                <FieldLabel htmlFor='peer-count'>
                  {t('performance.schemes.peerCountLabel')}
                </FieldLabel>
                <Input
                  id='peer-count'
                  type='number'
                  min={2}
                  max={5}
                  value={stages.peerReview.count}
                  onChange={(e) =>
                    setStages({
                      ...stages,
                      peerReview: {
                        ...stages.peerReview,
                        count: Number(e.target.value),
                      },
                    })
                  }
                />
              </Field>
            </div>
          </fieldset>
          <fieldset className='space-y-2'>
            <legend className='text-sm font-medium'>
              {t('performance.schemes.qualityRules')}
            </legend>
            <div className='grid gap-2 sm:grid-cols-5'>
              <Field>
                <FieldLabel htmlFor='rule-base'>
                  {t('performance.schemes.ruleBase')}
                </FieldLabel>
                {numberInput('rule-base', rules.base, (base) =>
                  setRules({ ...rules, base }),
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor='rule-min'>
                  {t('performance.schemes.ruleMin')}
                </FieldLabel>
                {numberInput('rule-min', rules.min, (min) =>
                  setRules({ ...rules, min }),
                )}
              </Field>
              {(['critical', 'major', 'minor'] as const).map((severity) => (
                <Field key={severity}>
                  <FieldLabel htmlFor={`rule-${severity}`}>
                    {t(`performance.schemes.perIssue.${severity}`)}
                  </FieldLabel>
                  {numberInput(
                    `rule-${severity}`,
                    rules.perIssue[severity],
                    (value) =>
                      setRules({
                        ...rules,
                        perIssue: { ...rules.perIssue, [severity]: value },
                      }),
                  )}
                </Field>
              ))}
            </div>
            <Field>
              <FieldLabel htmlFor='rule-exclude'>
                {t('performance.schemes.excludeCategories')}
              </FieldLabel>
              <Input
                id='rule-exclude'
                value={rules.excludeCategories.join(', ')}
                onChange={(e) =>
                  setRules({
                    ...rules,
                    excludeCategories: list(e.target.value),
                  })
                }
              />
              <FieldDescription>
                {t('performance.schemes.excludeHint')}
              </FieldDescription>
            </Field>
            <div className='grid gap-2 text-sm sm:grid-cols-3'>
              <label className='flex items-center gap-2'>
                <Checkbox
                  checked={rules.learningOnTime.enabled}
                  onCheckedChange={(checked) =>
                    setRules({
                      ...rules,
                      learningOnTime: {
                        ...rules.learningOnTime,
                        enabled: Boolean(checked),
                      },
                    })
                  }
                />
                {t('performance.schemes.learningRule', rules.learningOnTime)}
              </label>
              <label className='flex items-center gap-2'>
                <Checkbox
                  checked={rules.certificateExpired.enabled}
                  onCheckedChange={(checked) =>
                    setRules({
                      ...rules,
                      certificateExpired: {
                        ...rules.certificateExpired,
                        enabled: Boolean(checked),
                      },
                    })
                  }
                />
                {t(
                  'performance.schemes.certificateRule',
                  rules.certificateExpired,
                )}
              </label>
              <label className='flex items-center gap-2'>
                <Checkbox
                  checked={rules.absentDays.enabled}
                  onCheckedChange={(checked) =>
                    setRules({
                      ...rules,
                      absentDays: {
                        ...rules.absentDays,
                        enabled: Boolean(checked),
                      },
                    })
                  }
                />
                {t('performance.schemes.absentRule', rules.absentDays)}
              </label>
            </div>
          </fieldset>
          <fieldset className='space-y-2'>
            <legend className='text-sm font-medium'>
              {t('performance.schemes.guide')}
            </legend>
            <div className='grid gap-2 sm:grid-cols-3'>
              <Field>
                <FieldLabel htmlFor='guide-s'>
                  {t('performance.schemes.guideS')}
                </FieldLabel>
                <Input
                  id='guide-s'
                  type='number'
                  value={guide.S}
                  onChange={(e) => setGuide({ ...guide, S: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='guide-a'>
                  {t('performance.schemes.guideA')}
                </FieldLabel>
                <Input
                  id='guide-a'
                  type='number'
                  value={guide.A}
                  onChange={(e) => setGuide({ ...guide, A: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='guide-cd'>
                  {t('performance.schemes.guideCD')}
                </FieldLabel>
                <Input
                  id='guide-cd'
                  type='number'
                  value={guide.CD}
                  onChange={(e) => setGuide({ ...guide, CD: e.target.value })}
                />
              </Field>
            </div>
          </fieldset>
          <CustomFieldInputs
            definitions={fields}
            values={custom}
            onChange={setCustom}
            idPrefix='scheme-cf'
          />
          <label className='flex items-center gap-2 text-sm'>
            <Checkbox
              checked={active}
              onCheckedChange={(checked) => setActive(Boolean(checked))}
            />
            {t('performance.schemes.active')}
          </label>
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('performance.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || total !== 100 || !title.trim()}
            onClick={() => void save()}
          >
            {t('performance.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
