/**
 * The adoption half of the AI run record: a hash of each kind of draft as it
 * stands, and the outcome recorded when a person confirms or discards one.
 * An automation stores the hash of what it wrote; confirming a draft whose
 * hash still matches counts as "adopted", a changed one as "modified". Drafts
 * no automation produced have no run item, so recording is a no-op for them.
 *
 * It needs only the database, so every service that confirms or discards
 * drafts can call it without depending on the automation service.
 */
import { createHash } from 'node:crypto';

import type { DatabaseManager } from '@nocobase/db';

import { json } from './platform.js';
import { isRecord, str } from './shared.js';

export type DraftEntity =
  | 'course'
  | 'question'
  | 'competency'
  | 'positionRequirement'
  | 'practiceScenario'
  | 'learningPlan';

/** A stable hash of draft content: keys sorted, strings trimmed. */
export function contentHash(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (isRecord(input))
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, normalize(input[key])]),
      );
    return typeof input === 'string' ? input.trim() : input;
  };
  return createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex');
}

/** The hash of a draft as it stands now, or null when it no longer exists. */
export async function draftHash(
  database: DatabaseManager,
  entityType: DraftEntity,
  id: string,
): Promise<string | null> {
  const query = database.query();
  switch (entityType) {
    case 'course': {
      const course = await query
        .selectFrom('courses')
        .select(['title', 'description'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!course) return null;
      const lessons = await query
        .selectFrom('lessons')
        .select(['title', 'content', 'sourceExcerpt', 'estimatedMinutes'])
        .where('courseId', '=', id)
        .orderBy('sortOrder', 'asc')
        .execute();
      return contentHash({
        title: str(course.title),
        description: course.description == null ? '' : str(course.description),
        lessons: lessons.map((l) => ({
          title: str(l.title),
          content: l.content == null ? '' : str(l.content),
          sourceExcerpt: l.sourceExcerpt == null ? '' : str(l.sourceExcerpt),
          estimatedMinutes: Number(l.estimatedMinutes ?? 0),
        })),
      });
    }
    case 'question': {
      const question = await query
        .selectFrom('questions')
        .select(['type', 'stem', 'options', 'answer', 'explanation'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!question) return null;
      return contentHash({
        type: str(question.type),
        stem: str(question.stem),
        options: json(question.options, []),
        answer: json(question.answer, null),
        explanation:
          question.explanation == null ? '' : str(question.explanation),
      });
    }
    case 'competency': {
      const competency = await query
        .selectFrom('competencies')
        .select(['code', 'title', 'category', 'description', 'maxLevel'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!competency) return null;
      const levels = await query
        .selectFrom('competencyLevels')
        .select(['level', 'title', 'behaviors'])
        .where('competencyId', '=', id)
        .orderBy('level', 'asc')
        .execute();
      return contentHash({
        code: str(competency.code),
        title: str(competency.title),
        category: str(competency.category),
        description:
          competency.description == null ? '' : str(competency.description),
        maxLevel: Number(competency.maxLevel),
        levels: levels.map((l) => ({
          level: Number(l.level),
          title: str(l.title),
          behaviors: str(l.behaviors),
        })),
      });
    }
    case 'positionRequirement': {
      const requirement = await query
        .selectFrom('positionRequirements')
        .select(['competencyId', 'requiredLevel', 'mandatory'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!requirement) return null;
      return contentHash({
        competencyId: str(requirement.competencyId),
        requiredLevel: Number(requirement.requiredLevel),
        mandatory:
          requirement.mandatory === true || requirement.mandatory === 1,
      });
    }
    case 'practiceScenario': {
      const scenario = await query
        .selectFrom('practiceScenarios')
        .select(['title', 'persona', 'situation', 'openingLine', 'rubric'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!scenario) return null;
      return contentHash({
        title: str(scenario.title),
        persona: str(scenario.persona),
        situation: str(scenario.situation),
        openingLine: str(scenario.openingLine),
        rubric: json(scenario.rubric, []),
      });
    }
    case 'learningPlan': {
      const plan = await query
        .selectFrom('learningPlans')
        .select(['summary', 'items'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!plan) return null;
      return contentHash({
        summary: str(plan.summary),
        items: json(plan.items, []),
      });
    }
  }
}

/**
 * Records what a person did with a draft an automation produced. Call it for
 * a confirmation after the change is written, and for a discard before the
 * draft is deleted. A draft no automation produced, or one already decided,
 * is left alone.
 */
export async function recordDraftOutcome(
  database: DatabaseManager,
  entityType: DraftEntity,
  entityId: string,
  action: 'confirmed' | 'discarded',
  userId: string,
): Promise<void> {
  const item = await database
    .query()
    .selectFrom('aiTaskRunItems')
    .select(['id', 'snapshotHash', 'outcome'])
    .where('entityType', '=', entityType)
    .where('entityId', '=', entityId)
    .executeTakeFirst();
  if (!item || str(item.outcome) !== 'pending') return;
  let outcome: 'adopted' | 'modified' | 'discarded' = 'discarded';
  if (action === 'confirmed') {
    const current = await draftHash(database, entityType, entityId);
    outcome =
      item.snapshotHash && current && str(item.snapshotHash) !== current
        ? 'modified'
        : 'adopted';
  }
  const now = new Date();
  await database
    .query()
    .updateTable('aiTaskRunItems')
    .set({ outcome, outcomeByUserId: userId, outcomeAt: now, updatedAt: now })
    .where('id', '=', str(item.id))
    .execute();
}
