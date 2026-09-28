import type { DatabaseConnection } from '@nocobase/db';
import { z } from 'zod';

import { HrError, newId } from './shared.js';

const key = z.string().trim().min(1).max(64);
const identitySchema = z.object({
  recipientUserId: key,
  type: key,
  refType: key,
  refId: z.string().trim().min(1).max(128),
});

function internalLink(value: string): boolean {
  // Producers provide app-internal routes, not deployment bases, absolute URLs,
  // encoded path separators or traversal. The original page still owns access.
  if (
    !value.startsWith('/talent/') ||
    /[\\\s]/u.test(value) ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
    return false;
  const pathname = value.split(/[?#]/u)[0];
  if (!pathname || pathname.includes('%')) return false;
  return !pathname.split('/').some((part) => part === '.' || part === '..');
}

const inputSchema = identitySchema
  .extend({
    title: z.string().trim().min(1).max(255),
    summary: z.string().trim().max(500).nullable().default(null),
    link: z.string().max(1000).refine(internalLink),
    sourceKind: z.enum(['approval', 'ai', 'rule']),
    aiEmployee: key.nullable().default(null),
    dueAt: z.date().nullable().default(null),
  })
  .strict()
  .refine((item) => item.sourceKind !== 'ai' || item.aiEmployee !== null);

export type WorkItemIdentity = z.infer<typeof identitySchema>;
export type WorkItemInput = z.input<typeof inputSchema>;

/**
 * Internal producer only, deliberately not exposed as an HTTP resource.
 * Call with the owning business transaction's connection, never a separately
 * resolved manager: a failed approval/import must not leave an orphan task.
 * Producers must pass selected, non-sensitive text, not a serialized record.
 * Recipient read/complete/dismiss endpoints require their own action policies.
 */
export function createWorkItemStore(connection: DatabaseConnection) {
  const repository = connection.repository('workItems');
  return {
    async put(input: WorkItemInput) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_WORK_ITEM');
      const { recipientUserId, type, refType, refId, ...content } = parsed.data;
      const identity = { recipientUserId, type, refType, refId };
      const stamp = new Date();
      // The unique business key converges retries. Status/doneAt are deliberately
      // absent from update: a replay must never reopen a handled reminder.
      const result = await repository.upsertOne({
        filter: identity,
        create: {
          id: newId(),
          ...identity,
          ...content,
          status: 'open',
          doneAt: null,
          createdAt: stamp,
          updatedAt: stamp,
        },
        update: { ...content, updatedAt: stamp },
      });
      return result.record;
    },
    /** Only the source business workflow calls this after its decision succeeds. */
    async closeApproval(input: WorkItemIdentity): Promise<void> {
      const parsed = identitySchema.strict().safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_WORK_ITEM');
      const stamp = new Date();
      await repository.updateMany({
        filter: { ...parsed.data, sourceKind: 'approval', status: 'open' },
        values: { status: 'done', doneAt: stamp, updatedAt: stamp },
      });
    },
  };
}
