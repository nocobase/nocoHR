import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { documentConflictResource } from '../../../server/providers/hr/content-resources.js';
import {
  kbDocumentResource,
  OWNED_BY_ME_SCOPE,
} from '../../../server/providers/hr/learning-resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

/**
 * V1-04 权限配置: new versions and reviews (HR for every document, a
 * document's owner for their own), document conflicts (HR all, owners the
 * ones touching their documents), and the 自助 and AI 入口 pages. Existing
 * grants keep every action an administrator configured.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609290117_knowledge_service_permissions',
  transaction: true,
  async run({ query }) {
    const page = (id: string): Grant => ({
      resource: { type: 'page', id },
      actions: [{ action: 'access' }],
    });
    const links = (scope: string) => ({
      kbDocumentCompetencies: 'allRecords',
      kbDocumentDepartments: 'allRecords',
      kbDocumentPositions: 'allRecords',
      kbDocuments: scope,
    });
    const owner = (scope: string) => [
      kbDocumentResource.reference().grant({
        uploadVersion: links(scope),
        markReviewed: { kbDocuments: scope },
      }),
      documentConflictResource.reference().grant({
        view: { documentConflicts: scope },
        resolve: { documentConflicts: scope },
        ignore: { documentConflicts: scope },
      }),
    ];
    const additions = {
      'hr.admin': [
        page('talent.selfService'),
        page('talent.aiEntry'),
        ...owner('allRecords'),
      ],
      'hr.manager': [page('talent.selfService'), ...owner(OWNED_BY_ME_SCOPE)],
      'hr.instructor': owner(OWNED_BY_ME_SCOPE),
      'hr.employee': [page('talent.selfService')],
    } as unknown as Record<string, Grant[]>;
    for (const [key, grants] of Object.entries(additions)) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row) continue;
      let decoded = row.grants;
      for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
        decoded = JSON.parse(decoded);
      if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
      const existing = decoded as Grant[];
      let changed = false;
      for (const grant of grants) {
        const current = existing.find(
          (g) =>
            g.resource.type === grant.resource.type &&
            g.resource.id === grant.resource.id,
        );
        if (!current) {
          existing.push(grant);
          changed = true;
          continue;
        }
        for (const action of grant.actions) {
          if (current.actions.some((a) => a.action === action.action)) continue;
          current.actions.push(action);
          changed = true;
        }
      }
      if (!changed) continue;
      await query
        .updateTable('authorizationPermissionSets')
        .set({ grants: JSON.stringify(existing), updatedAt: new Date() })
        .where('id', '=', String(row.id))
        .execute();
    }
  },
});
export default seed;
