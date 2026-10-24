import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import { label } from '../hr/shared.js';

/** Retain the old grant identity without starting the retired plugin or workers. */
export function registerProcessAuthorization(authz: AppAuthorization) {
  const existing = authz.resourceTypes.get('settings').items?.get('workflow');
  if (existing) {
    if (!existing.actions.some((action) => action.name === 'manage'))
      throw new Error('PROCESS_AUTHORIZATION_CONTRACT_MISMATCH');
    return;
  }
  authz.ui.sections.add({
    name: 'automation',
    title: label('processes.authorization.section'),
    parent: 'administration',
    extend: true,
  });
  authz.settings.add({
    id: 'workflow',
    title: label('processes.authorization.title'),
    actions: [
      { name: 'manage', title: label('processes.authorization.manage') },
    ],
  });
  authz.ui.place(
    { type: 'settings', id: 'workflow' },
    { section: 'automation' },
  );
}
