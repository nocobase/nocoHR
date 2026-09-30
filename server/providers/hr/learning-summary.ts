/**
 * V3-09 扩展第二步: the learning part of the HR assistant's 转正准备 summary —
 * the probationer's tasks (total, completed, overdue) and the onboarding
 * path's progress with its unfinished steps. It is read with the recipient's
 * own permissions (talent.assignment view and its scope): a recipient who may
 * not view the employee's learning gets nothing, and the summary says nothing
 * about learning.
 */
import { policyOf, tryAuthorizeAction } from './authorize.js';
import type { ActorContext } from './framework-service.js';
import type { Platform } from './platform.js';
import { str } from './shared.js';

export interface ProbationLearning {
  readonly total: number;
  readonly completed: number;
  readonly overdue: number;
  readonly paths: readonly {
    readonly title: string;
    readonly progress: number;
    readonly remainingSteps: readonly string[];
  }[];
}

export async function probationLearning(
  platform: Platform,
  ctx: ActorContext,
  employeeId: string,
): Promise<ProbationLearning | undefined> {
  const policies = await tryAuthorizeAction(
    ctx.authz,
    'talent.assignment',
    'view',
  );
  if (!policies) return undefined;
  const rows = (await platform.database
    .repository('assignments')
    .withPolicy(policyOf(policies, 'assignments'))
    .findMany({ filter: { employeeId } })) as Record<string, unknown>[];
  const live = rows.filter((r) => str(r.status) !== 'cancelled');
  // A path counts once, as the path; its steps are listed under it.
  const top = live.filter((r) => !r.parentAssignmentId && !r.optional);
  const query = platform.database.query();
  const titleOf = async (row: Record<string, unknown>) => {
    const [table, id] = row.courseId
      ? ['courses', row.courseId]
      : row.examId
        ? ['exams', row.examId]
        : row.practiceScenarioId
          ? ['practiceScenarios', row.practiceScenarioId]
          : ['learningPaths', row.learningPathId];
    return str(
      (
        await query
          .selectFrom(table)
          .select(['title'])
          .where('id', '=', str(id))
          .executeTakeFirst()
      )?.title ?? '',
    );
  };
  const paths: ProbationLearning['paths'][number][] = [];
  for (const parent of top.filter((r) => r.learningPathId)) {
    const remaining: string[] = [];
    for (const step of live.filter(
      (r) =>
        str(r.parentAssignmentId) === str(parent.id) &&
        str(r.status) !== 'completed' &&
        !r.optional,
    ))
      remaining.push(await titleOf(step));
    paths.push({
      title: await titleOf(parent),
      progress: Number(parent.progress) || 0,
      remainingSteps: remaining,
    });
  }
  return {
    total: top.length,
    completed: top.filter((r) => str(r.status) === 'completed').length,
    overdue: top.filter((r) => str(r.status) === 'overdue').length,
    paths,
  };
}

/** One sentence for the template summary used without a model. */
export function probationLearningText(learning: ProbationLearning): string {
  const paths = learning.paths
    .map(
      (p) =>
        `《${p.title}》进度 ${p.progress}%${p.remainingSteps.length ? `，未完成：${p.remainingSteps.join('、')}` : ''}`,
    )
    .join('；');
  return `学习：任务 ${learning.total} 条，已完成 ${learning.completed} 条，逾期 ${learning.overdue} 条${paths ? `；上岗路径${paths}` : ''}。`;
}
