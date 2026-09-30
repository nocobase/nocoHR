import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';
import { label } from './shared.js';

export const WORK_ITEM_SCOPE = 'talent.recipient';
export const WORK_ITEM_FIELDS = [
  'id',
  'recipientUserId',
  'type',
  'title',
  'summary',
  'detail',
  'link',
  'sourceKind',
  'aiEmployee',
  'refType',
  'refId',
  'dueAt',
  'status',
  'doneAt',
  'createdAt',
  'updatedAt',
] as const;
const data = defineDatabasePermission((p) =>
  p
    .collection('workItems')
    .title(label('workbench.title'))
    .read([...WORK_ITEM_FIELDS]),
);
export const workbenchResource = defineCompositeResource(
  'talent.workbench',
  (r) =>
    r
      .title(label('workbench.title'))
      .action('view', (a) =>
        a.title(label('workbench.view')).grant('workItems', data),
      )
      .action('complete', (a) =>
        a
          .title(label('workbench.complete'))
          .grant('workItems', data.update(['status', 'doneAt', 'updatedAt'])),
      )
      .action('dismiss', (a) =>
        a
          .title(label('workbench.dismiss'))
          .grant('workItems', data.update(['status', 'doneAt', 'updatedAt'])),
      ),
);
