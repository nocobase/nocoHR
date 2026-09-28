import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';
import { authorizeAction, policyOf, tryAuthorizeAction } from './authorize.js';
import type { ActorContext } from './framework-service.js';
import { HrError, today, addDays, str } from './shared.js';
import { WORK_ITEM_FIELDS } from './workbench-resource.js';

const querySchema = z
  .object({
    group: z.enum(['today', 'week', 'later', 'completed']).default('today'),
    source: z.enum(['all', 'approval', 'ai', 'rule']).default('all'),
    page: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();

export function workItemGroup(
  status: string,
  dueAt: unknown,
  date: string,
  timeZone: string,
): 'today' | 'week' | 'later' | 'completed' {
  if (status !== 'open') return 'completed';
  if (!dueAt) return 'today';
  const due = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(str(dueAt)));
  if (due <= date) return 'today';
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return due <= addDays(date, (7 - weekday) % 7) ? 'week' : 'later';
}

export function createWorkbenchService(
  database: DatabaseManager,
  timeZone = 'Asia/Shanghai',
) {
  return {
    async list(ctx: ActorContext, input: unknown) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.workbench',
        'view',
      );
      const parsed = querySchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT');
      const { group, source, page } = parsed.data;
      const repo = database
        .repository('workItems')
        .withPolicy(policyOf(policies, 'workItems'));
      // Recipient equality is an invariant even if an administrator selects a wider grant.
      const rows = await repo.findMany({
        filter: {
          recipientUserId: ctx.userId,
          ...(source === 'all' ? {} : { sourceKind: source }),
        },
        select: (s) => s.fields(...WORK_ITEM_FIELDS),
      });
      const date = today(timeZone);
      const counts = { today: 0, week: 0, later: 0, completed: 0 };
      const selected = rows.filter((row) => {
        const bucket = workItemGroup(
          str(row.status),
          row.dueAt,
          date,
          timeZone,
        );
        counts[bucket] += 1;
        return bucket === group;
      });
      const timestamp = (v: unknown) => (v ? new Date(str(v)).getTime() : 0);
      selected.sort(
        (a, b) =>
          (group === 'completed'
            ? timestamp(b.doneAt) - timestamp(a.doneAt)
            : timestamp(a.dueAt) - timestamp(b.dueAt)) ||
          timestamp(a.createdAt) - timestamp(b.createdAt) ||
          str(a.id).localeCompare(str(b.id)),
      );
      const complete = await tryAuthorizeAction(
        ctx.authz,
        'talent.workbench',
        'complete',
      );
      const dismiss = await tryAuthorizeAction(
        ctx.authz,
        'talent.workbench',
        'dismiss',
      );
      const eligible = async (policy: typeof complete, id: unknown) =>
        Boolean(
          policy?.workItems &&
          (await database
            .repository('workItems')
            .withPolicy(policyOf(policy, 'workItems'))
            .exists({
              filter: {
                id: String(id),
                recipientUserId: ctx.userId,
                status: 'open',
              },
            })),
        );
      const items = await Promise.all(
        selected.slice((page - 1) * 25, page * 25).map(async (row) => ({
          ...row,
          canComplete:
            row.sourceKind !== 'approval' &&
            row.status === 'open' &&
            (await eligible(complete, row.id)),
          canDismiss:
            row.sourceKind !== 'approval' &&
            row.status === 'open' &&
            (await eligible(dismiss, row.id)),
        })),
      );
      return { items, total: selected.length, counts, timeZone, page };
    },
    async finish(
      ctx: ActorContext,
      id: string,
      action: 'complete' | 'dismiss',
    ) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.workbench',
        action,
      );
      return database.transaction(async (connection) => {
        const repo = connection
          .repository('workItems')
          .withPolicy(policyOf(policies, 'workItems'));
        const filter = { id, recipientUserId: ctx.userId };
        const row = await repo.findOne({ filter });
        if (!row) throw new HrError('NOT_FOUND', 404);
        if (row.sourceKind === 'approval')
          throw new HrError('WORK_ITEM_APPROVAL_ONLY', 409);
        const status = action === 'complete' ? 'done' : 'dismissed';
        if (row.status === status)
          return { ...row, canComplete: false, canDismiss: false };
        if (row.status !== 'open') throw new HrError('CONFLICT', 409);
        const stamp = new Date();
        const result = await repo.updateOne({
          filter: { ...filter, status: 'open' },
          values: { status, doneAt: stamp, updatedAt: stamp },
        });
        return { ...result.record, canComplete: false, canDismiss: false };
      });
    },
  };
}
