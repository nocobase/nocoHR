import type { ApprovalStep } from './types.js';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The name of one approval level: an added level's own name, the department
 * head of the approval department, or HR. A merged level shows every name it
 * stands for, joined with " · ".
 */
export function stepTitle(
  step: Pick<ApprovalStep, 'kind' | 'name' | 'merged' | 'departmentId'>,
  t: Translate,
  departmentTitle: (id: string | null | undefined) => string,
): string {
  const one = (kind: ApprovalStep['kind'], name: string | null | undefined) =>
    kind === 'extra'
      ? (name ?? t('talent.chain.extraLevel'))
      : kind === 'hrAdmin'
        ? t('talent.actions.hrAdmin')
        : t('talent.actions.levelHeadOf', {
            department: departmentTitle(step.departmentId) || '—',
          });
  return [
    one(step.kind, step.name),
    ...(step.merged ?? []).map((m) => one(m.kind, m.name)),
  ].join(' · ');
}

/** The notes a level carries: passed by itself, merged, fell to HR, escalated past the employee. */
export function stepTags(step: ApprovalStep, t: Translate): string[] {
  const tags: string[] = [];
  if (step.status === 'auto') tags.push(t('talent.chain.auto'));
  if (step.merged?.length) tags.push(t('talent.chain.merged'));
  if (step.fallback === 'noApprover') tags.push(t('talent.chain.noApprover'));
  if (step.fallback === 'selfEscalated')
    tags.push(t('talent.chain.selfEscalated'));
  return tags;
}
