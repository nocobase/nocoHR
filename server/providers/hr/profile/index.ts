/**
 * V3-11 画像、联动与内容维护: the services of this step, created together
 * because they share reads and hand work to each other (a matched quality
 * issue starts the analyst's training check; a completed task may complete a
 * training recommendation).
 */
import { authorizeAction, coversAllRecords, policyOf } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, str } from '../shared.js';
import { createAnalystWork } from './analyst.js';
import { createAuditService } from './audit.js';
import { createProfileReads, type ProfileDeps } from './context.js';
import { createDecisionService } from './decisions.js';
import { createProfileInsights } from './insights.js';
import { createSignalService } from './signals.js';

/** `hrFiles.purpose` of a stored customer audit pack. */
export const AUDIT_PACK_PURPOSE = 'auditPack';

export function createProfileServices(deps: ProfileDeps) {
  const reads = createProfileReads(deps.platform);
  const { database } = deps.platform;
  // The analyst is created last; the signal hook reaches it lazily.
  const holder: { analyst?: ReturnType<typeof createAnalystWork> } = {};
  const signals = createSignalService(deps, reads, {
    onQualityMatched: (ids) =>
      deps.background('talentAnalyst.trainingCheck', async () =>
        holder.analyst?.onQualitySignals(ids),
      ),
  });
  const decisions = createDecisionService(deps, reads);
  const insights = createProfileInsights(deps, reads, signals);
  const audit = createAuditService(deps, reads);
  const work = createAnalystWork({
    deps,
    reads,
    signals,
    decisions,
    insights,
    audit,
  });
  holder.analyst = work;

  return {
    reads,
    signals,
    decisions,
    insights,
    audit,
    analyst: work,

    /**
     * A course was completed: the completed assignments remember the course
     * version and source document they were completed against, and training
     * recommendations the person's tasks belong to are checked.
     */
    async onCourseCompleted(
      employeeId: string,
      courseId: string,
    ): Promise<void> {
      const course = await database
        .query()
        .selectFrom('courses')
        .select(['version', 'sourceDocumentId'])
        .where('id', '=', courseId)
        .executeTakeFirst();
      if (course)
        await database
          .query()
          .updateTable('assignments')
          .set({
            courseVersion: Number(course.version) || 1,
            courseSourceDocumentId:
              course.sourceDocumentId == null
                ? null
                : str(course.sourceDocumentId),
          })
          .where('employeeId', '=', employeeId)
          .where('courseId', '=', courseId)
          .where('status', '=', 'completed')
          .where('courseVersion', 'is', null)
          .execute();
      await decisions.checkCompletionFor(employeeId);
    },

    /** An exam or a practice was passed: recommendations of the person's tasks are checked. */
    async onTaskCompleted(employeeId: string): Promise<void> {
      await decisions.checkCompletionFor(employeeId);
    },

    /** An automation's current parameters (thresholds the administrator adjusts). */
    analystParams(key: string) {
      return deps.automation().paramsOf(key);
    },

    /** The owner of an automation: the fallback reviewer. */
    async ownerOf(key: string): Promise<string | null> {
      const row = await database
        .query()
        .selectFrom('aiAutomationSettings')
        .select(['ownerUserId'])
        .where('id', '=', key)
        .executeTakeFirst();
      return row?.ownerUserId ? str(row.ownerUserId) : null;
    },

    /** Employees the caller reaches through a composite action's employee policy. */
    async visibleEmployeeIds(
      ctx: ActorContext,
      resource: string,
      action: string,
    ): Promise<Set<string>> {
      const policies = await authorizeAction(ctx.authz, resource, action);
      const rows = (await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findMany({})) as Record<string, unknown>[];
      return new Set(rows.map((r) => str(r.id)));
    },

    /** Evidence cited by a suggestion must be the employee's own records. */
    async evidenceExists(
      employeeId: string,
      evidence: readonly { type: string; id: string }[],
    ): Promise<boolean> {
      const table: Record<string, string> = {
        signal: 'businessSignals',
        examAttempt: 'examAttempts',
        practiceSession: 'practiceSessions',
      };
      for (const item of evidence) {
        const collection = table[item.type];
        if (!collection) return false;
        const row = await database
          .query()
          .selectFrom(collection)
          .select(['id'])
          .where('id', '=', item.id)
          .where('employeeId', '=', employeeId)
          .executeTakeFirst();
        if (!row) return false;
      }
      return true;
    },

    /**
     * Keeps a generated audit pack for its download link, marked as an audit
     * pack and, when a person built it, as theirs (`hrFiles.purpose` /
     * `uploadedByUserId`). The id is a random UUID.
     */
    storeAuditPack(
      pack: {
        bytes: Uint8Array;
        fileName: string;
      },
      ownerUserId?: string,
    ): Promise<string> {
      return reads.storeFile(deps.drive(), {
        folder: 'audit-packs',
        name: pack.fileName,
        bytes: pack.bytes,
        mimeType: 'application/zip',
        purpose: AUDIT_PACK_PURPOSE,
        uploadedByUserId: ownerUserId,
      });
    },

    /**
     * A stored audit pack for `GET /api/talent/audit/packs/:fileId`: the
     * caller needs talent.audit exportAuditPack, and the pack must be one
     * they built themselves — a pack holds the people of the scope its
     * builder could read — unless their grant reaches every employee. Any
     * other file, or a pack of someone else, is not found.
     */
    async auditPackFor(ctx: ActorContext, fileId: string) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.audit',
        'exportAuditPack',
      );
      const row = await database
        .query()
        .selectFrom('hrFiles')
        .select(['id', 'filename', 'purpose', 'uploadedByUserId'])
        .where('id', '=', fileId)
        .executeTakeFirst();
      // Packs from before the purpose column carry only their file name, and no builder.
      const isPack =
        row &&
        (str(row.purpose) === AUDIT_PACK_PURPOSE ||
          (!row.purpose && str(row.filename).startsWith('audit-pack')));
      if (
        !row ||
        !isPack ||
        (str(row.uploadedByUserId) !== ctx.userId &&
          !coversAllRecords(policyOf(policies, 'employees')))
      )
        throw new HrError('NOT_FOUND', 404);
      const file = await reads.readFile(deps.drive(), fileId);
      if (!file) throw new HrError('NOT_FOUND', 404);
      return file;
    },

    /** 09:00 rules: expiring undecided drafts, and completing recommendations (catch-up). */
    async runDaily(): Promise<Record<string, number>> {
      const automation = deps.automation();
      const levels = await automation.paramsOf(
        'talentAnalyst.levelSuggestions',
      );
      const training = await automation.paramsOf('talentAnalyst.trainingCheck');
      const expired = await decisions.expire({
        suggestionDays: Number(levels.suggestionExpiryDays ?? 30) || 30,
        recommendationDays:
          Number(training.recommendationExpiryDays ?? 14) || 14,
      });
      const completed = await decisions.checkCompletion();
      return { ...expired, completed: completed.length };
    },
  };
}

export type ProfileServices = ReturnType<typeof createProfileServices>;
