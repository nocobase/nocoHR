/**
 * V3-10 registrations into other steps' extension points:
 *
 * - 变动影响清单 provider `certificate` (V1-02): a transfer or promotion lists
 *   the certifications the new position requires that the employee holds no
 *   valid certificate of, and the certificates the old position required
 *   that the new one no longer does. Items only inform: a certificate never
 *   changes state because of a job change.
 * - Job event handler `certificate.qualificationDecision`: a development
 *   target achieved through a 任职资格认证 (before any appointment) is linked
 *   to the transfer or promotion that finally moved the employee into the
 *   position (`decisionActionId`). Targets achieved by the move itself are
 *   the competency step's (V3-08) handler's.
 */
import type { DatabaseManager } from '@nocobase/db';

import type {
  ChecklistProvider,
  ProviderContext,
  ProviderItem,
} from './change-checklists.js';
import type { JobEventProcessor } from './job-events.js';
import { str } from './shared.js';

const HOLDING = ['valid', 'expiring'];

/** Certifications a position requires: those of its confirmed mandatory qualification requirements. */
export async function requiredCertificationsOf(
  database: DatabaseManager,
  positionId: string,
): Promise<{ id: string; title: string }[]> {
  const requirements = await database
    .query()
    .selectFrom('positionRequirements')
    .innerJoin(
      'competencies',
      'competencies.id',
      'positionRequirements.competencyId',
    )
    .select(['positionRequirements.competencyId as competencyId'])
    .where('positionRequirements.positionId', '=', positionId)
    .where('positionRequirements.mandatory', '=', true)
    .where('positionRequirements.reviewStatus', '=', 'confirmed')
    .where('competencies.category', '=', 'qualification')
    .execute();
  if (!requirements.length) return [];
  const rows = await database
    .query()
    .selectFrom('certifications')
    .select(['id', 'title'])
    .where('active', '=', true)
    .where(
      'competencyId',
      'in',
      requirements.map((r) => str(r.competencyId)),
    )
    .execute();
  return rows.map((r) => ({ id: str(r.id), title: str(r.title) }));
}

export function certificateChecklistProvider(
  database: DatabaseManager,
): ChecklistProvider {
  return {
    key: 'certificate',
    kinds: ['change'],
    async items(ctx: ProviderContext): Promise<ProviderItem[]> {
      const employee = ctx.employee;
      if (!employee) return [];
      const toPositionId =
        ctx.action?.toPositionId ?? ctx.event?.toPositionId ?? null;
      const fromPositionId =
        ctx.action?.fromPositionId ??
        ctx.event?.fromPositionId ??
        (ctx.effective ? null : employee.positionId);
      if (!toPositionId || toPositionId === fromPositionId) return [];
      const required = await requiredCertificationsOf(database, toPositionId);
      const before = fromPositionId
        ? await requiredCertificationsOf(database, fromPositionId)
        : [];
      if (!required.length && !before.length) return [];
      const held = new Set(
        (
          await database
            .query()
            .selectFrom('employeeCertificates')
            .select(['certificationId'])
            .where('employeeId', '=', employee.id)
            .where('status', 'in', HOLDING)
            .execute()
        ).map((r) => str(r.certificationId)),
      );
      const items: ProviderItem[] = [];
      for (const certification of required)
        if (!held.has(certification.id))
          items.push({
            key: `certificateMissing:${certification.id}`,
            code: 'certificateMissing',
            params: { title: certification.title },
            status: 'todo',
            link: `/talent/certifications/${encodeURIComponent(certification.id)}`,
          });
      const stillRequired = new Set(required.map((c) => c.id));
      for (const certification of before)
        if (!stillRequired.has(certification.id) && held.has(certification.id))
          items.push({
            key: `certificateNoLongerRequired:${certification.id}`,
            code: 'certificateNoLongerRequired',
            params: { title: certification.title },
            status: 'auto',
          });
      return items;
    },
  };
}

export function registerCertificateHooks(deps: {
  readonly database: DatabaseManager;
  readonly processor: JobEventProcessor;
  readonly checklists: { register(provider: ChecklistProvider): () => void };
}): (() => void)[] {
  const { database, processor, checklists } = deps;
  return [
    checklists.register(certificateChecklistProvider(database)),
    processor.register({
      key: 'certificate.qualificationDecision',
      async handle(event) {
        if (
          (event.eventType !== 'promote' && event.eventType !== 'transfer') ||
          !event.toPositionId ||
          !event.actionId
        )
          return;
        await database
          .query()
          .updateTable('developmentTargets')
          .set({ decisionActionId: event.actionId, updatedAt: new Date() })
          .where('employeeId', '=', event.employeeId)
          .where('targetPositionId', '=', event.toPositionId)
          .where('status', '=', 'achieved')
          .where('decisionActionId', 'is', null)
          .execute();
      },
    }),
  ];
}
