/**
 * The permission side of the AI employees' proactive work: the collections
 * holding automation settings, run records and draft outcomes, and the grant
 * a composite's `configure` action carries. Configuring an automation (its
 * switch, owner, run time and parameters) and reading its run records is
 * `configure` on the AI employee's composite; only hr.admin holds it.
 */
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

import { label } from './shared.js';

const SETTING_FIELDS = [
  'id',
  'enabled',
  'ownerUserId',
  'hour',
  'weekday',
  'monthDay',
  'params',
  'updatedByUserId',
  'createdAt',
  'updatedAt',
] as const;
const RUN_FIELDS = [
  'id',
  'task',
  'employee',
  'trigger',
  'triggerRef',
  'dedupeKey',
  'ownerUserId',
  'status',
  'inputSummary',
  'output',
  'references',
  'fallback',
  'conversationSessionId',
  'error',
  'startedAt',
  'finishedAt',
  'createdAt',
  'updatedAt',
] as const;
const RUN_ITEM_FIELDS = [
  'id',
  'runId',
  'entityType',
  'entityId',
  'snapshotHash',
  'outcome',
  'outcomeByUserId',
  'outcomeAt',
  'createdAt',
  'updatedAt',
] as const;

export const automationSettingsWrite = defineDatabasePermission((p) =>
  p
    .collection('aiAutomationSettings')
    .title(label('collections.aiAutomationSettings'))
    .read([...SETTING_FIELDS])
    .create([...SETTING_FIELDS])
    .update([...SETTING_FIELDS]),
);
export const automationRunsRead = defineDatabasePermission((p) =>
  p
    .collection('aiTaskRuns')
    .title(label('collections.aiTaskRuns'))
    .read([...RUN_FIELDS]),
);
export const automationRunItemsRead = defineDatabasePermission((p) =>
  p
    .collection('aiTaskRunItems')
    .title(label('collections.aiTaskRunItems'))
    .read([...RUN_ITEM_FIELDS]),
);

export const AUTOMATION_COLLECTIONS: readonly {
  name: string;
  title: string;
}[] = [
  { name: 'aiAutomationSettings', title: 'collections.aiAutomationSettings' },
  { name: 'aiTaskRuns', title: 'collections.aiTaskRuns' },
  { name: 'aiTaskRunItems', title: 'collections.aiTaskRunItems' },
  { name: 'demoBatchSignoffs', title: 'collections.demoBatchSignoffs' },
];
