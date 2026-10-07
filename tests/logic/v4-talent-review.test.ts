// @vitest-environment node

// Acceptance checks for V4 step 13A (人才盘点与继任、能力模型版本) on the V4 demo data (启衡精密): the nine-box
// conversion and potential band, preparing (placements, the analyst's pre-placement without character words or
// review comments, the heads' notice, no repeated pre-placement), moves with reasons, the talent-review learning
// plan, visibility (the employee never sees their own placement; heads only in scope and only during the review),
// key positions and AI successor candidates, readiness and confirmation, the risk alert on offboarding (never to
// the incumbent, once per event), the quarterly check, and competency model versions (impact preview, the advisor's
// note, publication, the requirements on a date). There is no model: every AI job takes its rule-based fallback.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mentionsInternals } from '../../server/providers/hr/ai-text-guard.ts';
import {
  decode,
  publishAnnualCycle,
  shift,
  startHarness,
  today,
  until,
  type Harness,
} from './talent-review-harness.ts';
import { eventually } from '../helpers/eventually.ts';

let h: Harness;
const REVIEW = 'tr-demo-sz';

beforeAll(async () => {
  h = await startHarness('v4-talent-review');
  await publishAnnualCycle(h);
}, 240_000);

afterAll(async () => {
  await h?.close();
});

async function placementOf(employeeId: string) {
  const row = await (
    await h.db()
  )
    .query()
    .selectFrom('talentPlacements')
    .selectAll()
    .where('talentReviewId', '=', REVIEW)
    .where('employeeId', '=', employeeId)
    .executeTakeFirst();
  return row
    ? {
        ...row,
        aiSuggestion: decode(row.aiSuggestion),
        moves: decode(row.moves),
      }
    : undefined;
}

describe('V4-13 pure rules', () => {
  it('converts ratings, potential answers and boxes', async () => {
    const config =
      await import('../../server/providers/hr/talent-review/config.ts');
    const settings = config.TALENT_REVIEW_DEFAULTS;
    expect(settings.ratingBands).toMatchObject({
      S: 3,
      A: 3,
      B: 2,
      C: 1,
      D: 1,
    });
    const answers = (a: number, b: number, c: number) => ({
      learningAgility: { score: a },
      aspiration: { score: b },
      influence: { score: c },
    });
    expect(config.potentialBandOf(answers(3, 3, 2), settings)).toBe(3);
    expect(config.potentialBandOf(answers(2, 2, 1), settings)).toBe(2);
    expect(config.potentialBandOf(answers(1, 1, 2), settings)).toBe(1);
    expect(config.boxOf(3, 3)).toBe(9);
    expect(config.boxOf(1, 1)).toBe(1);
    expect(config.boxOf(3, null)).toBeNull();
    expect(config.bandsOfBox(8)).toEqual({
      performanceBand: 2,
      potentialBand: 3,
    });
  });
});

describe('13A 人才盘点', () => {
  it('draft → preparing: placements with converted bands, the pre-placement and the heads’ notice', async () => {
    const hr = await h.call(
      'hr01',
      'POST',
      `/talent-reviews/${REVIEW}/advance`,
    );
    expect(hr.status).toBe(200);
    expect(hr.json.data.review.status).toBe('preparing');
    expect((await placementOf('emp-wanglei'))!.performanceBand).toBe(3);
    expect((await placementOf('emp-qianjin'))!.performanceBand).toBe(2);
    expect((await placementOf('emp-limin'))!.performanceBand).toBe(2);
    const wang = await until(
      () => placementOf('emp-wanglei'),
      (p) => Boolean(p?.aiSuggestion),
    );
    expect(wang!.aiSuggestion.performanceBand).toBe(3);
    expect(wang!.aiSuggestion.source).toBe('rule');
    const text = JSON.stringify(wang!.aiSuggestion);
    expect(text).toContain('最终等级 A');
    expect(text).not.toMatch(/性格|评语原文/u);
    // The bands and the box are not the analyst's to set.
    expect(wang!.box).toBeNull();
    const njl = await h.userId('mgr_njl');
    expect(
      await h.inboxText(`talentReview:${REVIEW}:potential:${njl}`),
    ).toContain('潜力评估');
    // A repeated trigger adds nothing.
    const services = await h.services();
    const again = await services.context
      .automation()
      .run(
        'talentAnalyst.prePlacement',
        'event',
        { dedupeKey: REVIEW },
        async () => ({}),
      );
    expect(again.status).toBe('duplicate');
    expect(
      (await h.call('hr01', 'POST', `/talent-reviews/${REVIEW}/advance`)).json
        .data.review.status,
    ).toBe('inSession');
    // Back to preparing is not possible; the potential can still be written during the session.
  });

  it('heads assess the potential of their scope only; the employee sees no placement', async () => {
    const wang = (await placementOf('emp-wanglei'))!;
    const chen = (await placementOf('emp-mgr-njl'))!;
    const answers = {
      learningAgility: { score: 3, example: '两周内掌握新夹具换型' },
      aspiration: { score: 3, example: '主动带教新员工刘洋' },
      influence: { score: 2, example: '班组改善提案被采纳一次' },
    };
    const ok = await h.call(
      'mgr_njl',
      'POST',
      `/talent-placements/${wang.id}/potential`,
      { answers },
    );
    expect(ok.status).toBe(200);
    expect(ok.json.data.potentialBand).toBe(3);
    // 陈静 cannot reach her own placement; 周宏 (her head) can.
    expect(
      (
        await h.call(
          'mgr_njl',
          'POST',
          `/talent-placements/${chen.id}/potential`,
          { answers },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await h.call(
          'mgr_east',
          'POST',
          `/talent-placements/${chen.id}/potential`,
          { answers },
        )
      ).status,
    ).toBe(200);
    // An incomplete answer is refused.
    expect(
      (
        await h.call(
          'mgr_njl',
          'POST',
          `/talent-placements/${wang.id}/potential`,
          {
            answers: { learningAgility: { score: 3, example: 'x' } },
          },
        )
      ).status,
    ).toBe(400);
    const detail = await h.call('mgr_njl', 'GET', `/talent-reviews/${REVIEW}`);
    expect(detail.status).toBe(200);
    const names = detail.json.data.placements.map(
      (p: { employeeName: string }) => p.employeeName,
    );
    expect(names).toContain('王磊');
    expect(names).not.toContain('陈静');
    // 王磊 himself: no talent-review action at all.
    expect(
      (await h.call('emp_njl_1', 'GET', `/talent-reviews/${REVIEW}`)).status,
    ).toBe(403);
    expect((await h.call('emp_njl_1', 'GET', '/talent-reviews')).status).toBe(
      403,
    );
  });

  it('a move needs a reason and keeps the analyst’s suggestion; confirmation drafts the learning plan for the head', async () => {
    const before = (await placementOf('emp-wanglei'))!;
    expect(
      (
        await h.call('hr01', 'POST', `/talent-placements/${before.id}/move`, {
          box: 8,
        })
      ).status,
    ).toBe(400);
    const moved = await h.call(
      'hr01',
      'POST',
      `/talent-placements/${before.id}/move`,
      {
        box: 8,
        reason: '盘点会讨论：质量问题 QI-2026-0412 尚需改进，绩效维度调为中',
      },
    );
    expect(moved.status).toBe(200);
    expect(moved.json.data.box).toBe(8);
    expect(moved.json.data.moves).toHaveLength(1);
    const after = (await placementOf('emp-wanglei'))!;
    expect(after.aiSuggestion).toEqual(before.aiSuggestion);
    // Heads cannot place.
    expect(
      (
        await h.call(
          'mgr_njl',
          'POST',
          `/talent-placements/${before.id}/move`,
          { box: 9, reason: 'x' },
        )
      ).status,
    ).toBe(403);
    expect(
      (await h.call('hr01', 'POST', `/talent-placements/${before.id}/confirm`))
        .status,
    ).toBe(409);
    await h.call('hr01', 'PUT', `/talent-placements/${before.id}/actions`, {
      actions: [
        { type: 'promotionPrep', note: '作为车间主任的后备，参加班组管理培训' },
        { type: 'stretch', note: '牵头首件检验改善项目' },
      ],
    });
    const confirmed = await h.call(
      'hr01',
      'POST',
      `/talent-placements/${before.id}/confirm`,
    );
    expect(confirmed.status).toBe(200);
    const plan = await until(
      async () => (await placementOf('emp-wanglei'))!.learningPlanId,
      (id) => Boolean(id),
    );
    expect(plan).toBeTruthy();
    const row = await (
      await h.db()
    )
      .query()
      .selectFrom('learningPlans')
      .selectAll()
      .where('id', '=', String(plan))
      .executeTakeFirst();
    expect(row!.status).toBe('draft');
    expect(row!.reviewerUserId).toBe(await h.userId('mgr_njl'));
    const ref = JSON.stringify(decode(row!.triggerRef));
    expect(row!.trigger === 'talentReview' || ref.includes(before.id)).toBe(
      true,
    );
  });

  it('after the review concludes, heads see nothing more', async () => {
    const chen = (await placementOf('emp-mgr-njl'))!;
    expect(
      (await h.call('mgr_east', 'GET', `/talent-reviews/${REVIEW}`)).status,
    ).toBe(200);
    expect(
      (await h.call('hr01', 'POST', `/talent-reviews/${REVIEW}/advance`)).json
        .data.review.status,
    ).toBe('concluded');
    expect(
      (await h.call('mgr_east', 'GET', `/talent-reviews/${REVIEW}`)).status,
    ).toBe(404);
    expect(
      (
        await h.call(
          'mgr_east',
          'POST',
          `/talent-placements/${chen.id}/potential`,
          {},
        )
      ).status,
    ).toBe(404);
    expect(
      (await h.call('hr01', 'GET', `/talent-reviews/${REVIEW}`)).status,
    ).toBe(200);
  });
});

describe('13A 关键岗位与继任', () => {
  let planId = '';

  it('marking 车间主任 as key drafts the plan with three AI candidates (not 陈静, no readiness)', async () => {
    const marked = await h.call(
      'hr01',
      'PUT',
      '/succession/positions/pos-workshop-lead/key',
      {
        isKey: true,
        keyReason: '车间生产与质量的第一责任人',
      },
    );
    expect(marked.status).toBe(200);
    const plan = await until(
      async () => {
        const row = await (
          await h.db()
        )
          .query()
          .selectFrom('successionPlans')
          .selectAll()
          .where('positionId', '=', 'pos-workshop-lead')
          .where('departmentId', '=', 'sz-mc')
          .executeTakeFirst();
        return row ? { ...row, candidates: decode(row.candidates) } : undefined;
      },
      (row) => Boolean(row && row.candidates.length),
    );
    planId = String(plan!.id);
    expect(plan!.incumbentEmployeeId).toBe('emp-mgr-njl');
    expect(plan!.candidates).toHaveLength(3);
    for (const c of plan!.candidates) {
      expect(c.source).toBe('ai');
      expect(c.readiness).toBeNull();
      expect(c.employeeId).not.toBe('emp-mgr-njl');
      expect(typeof c.note).toBe('string');
    }
    const njl = await h.userId('mgr_njl');
    const east = await h.userId('mgr_east');
    const notices = await eventually(async () =>
      (await h.db())
        .query()
        .selectFrom('notificationInAppItems')
        .selectAll()
        .where('title', 'like', '%继任候选推荐%')
        .execute(),
    );
    const text = JSON.stringify(notices);
    expect(text).toContain(east);
    expect(text).not.toContain(njl);
    // Confirming needs a readiness for every candidate.
    expect(
      (await h.call('hr01', 'POST', `/succession/${planId}/confirm`)).status,
    ).toBe(409);
    const detail = await h.call('hr01', 'GET', `/succession/${planId}`);
    expect(detail.json.data.candidates[0].currentGaps).toBeDefined();
    const set = await h.call(
      'hr01',
      'PUT',
      `/succession/${planId}/candidates`,
      {
        candidates: plan!.candidates.map(
          (c: { employeeId: string }, i: number) => ({
            employeeId: c.employeeId,
            readiness: i === 0 ? 'oneToTwoYears' : 'threePlusYears',
          }),
        ),
      },
    );
    expect(set.status).toBe(200);
    const confirmed = await h.call(
      'hr01',
      'POST',
      `/succession/${planId}/confirm`,
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.data.status).toBe('confirmed');
  });

  it('only the incumbent’s superior reads the plan; the incumbent does not', async () => {
    expect(
      (await h.call('mgr_east', 'GET', `/succession/${planId}`)).status,
    ).toBe(200);
    expect(
      (await h.call('mgr_njl', 'GET', `/succession/${planId}`)).status,
    ).toBe(404);
    const list = await h.call('mgr_njl', 'GET', '/succession');
    expect(list.json.data.plans.map((p: { id: string }) => p.id)).not.toContain(
      planId,
    );
    expect(
      (
        await h.call('mgr_east', 'PUT', `/succession/${planId}/candidates`, {
          candidates: [],
        })
      ).status,
    ).toBe(403);
  });

  it('a candidate leaving marks them left and alerts hr01 and the superior once per event', async () => {
    const plan = await (await h.services()).succession.planRow(planId);
    const leaving = plan.candidates[0]!.employeeId;
    const database = await h.db();
    const eventId = `tr-test-offboard-${Date.now()}`;
    const now = new Date();
    await database
      .query()
      .insertInto('jobEvents')
      .values({
        id: eventId,
        employeeId: leaving,
        eventType: 'offboard',
        fromDepartmentId: 'sz-mc',
        toDepartmentId: null,
        fromPositionId: 'pos-cnc-operator',
        toPositionId: null,
        effectiveDate: today(),
        source: 'manual',
        actionId: null,
        note: '测试离职',
        syncRunId: null,
        processedAt: null,
        processError: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const { jobEventProcessorToken } =
      await import('../../server/providers/hr/tokens.ts');
    await h.server.application.container
      .resolve(jobEventProcessorToken)
      .process([eventId]);
    const count = async () =>
      (
        await database
          .query()
          .selectFrom('notificationInAppItems')
          .select(['id'])
          .where('title', 'like', '%继任风险提醒%')
          .execute()
      ).length;
    // One message per recipient (hr01 and the superior), delivered on the notification queue.
    const first = await until(count, (n) => n >= 2);
    expect(first).toBeGreaterThan(0);
    const updated = await (await h.services()).succession.planRow(planId);
    expect(updated.candidates.find((c) => c.employeeId === leaving)!.left).toBe(
      true,
    );
    const notices = JSON.stringify(
      await database
        .query()
        .selectFrom('notificationInAppItems')
        .selectAll()
        .where('title', 'like', '%继任风险提醒%')
        .execute(),
    );
    expect(notices).toContain(await h.userId('hr01'));
    expect(notices).toContain(await h.userId('mgr_east'));
    expect(notices).not.toContain(await h.userId('mgr_njl'));
    // The same event again: nothing new.
    await (
      await h.services()
    ).onJobEvent({
      id: eventId,
      employeeId: leaving,
      eventType: 'offboard',
      fromDepartmentId: 'sz-mc',
      toDepartmentId: null,
      fromPositionId: 'pos-cnc-operator',
      toPositionId: null,
      effectiveDate: today(),
      source: 'manual',
      actionId: null,
      note: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await count()).toBe(first);
  });

  it('the quarterly check alerts plans without readyNow / oneToTwoYears candidates', async () => {
    const database = await h.db();
    const plan = await (await h.services()).succession.planRow(planId);
    await database
      .query()
      .updateTable('successionPlans')
      .set({
        candidates: plan.candidates.map((c) => ({
          ...c,
          readiness: 'threePlusYears',
        })),
      })
      .where('id', '=', planId)
      .execute();
    const before = (
      await database
        .query()
        .selectFrom('hrReminderLog')
        .select(['id'])
        .where(
          'reminderKey',
          'like',
          `succession:risk:${planId}:noReadySuccessor:%`,
        )
        .execute()
    ).length;
    const ran = await h.call(
      'hr01',
      'POST',
      '/talent-review-tasks/talentAnalyst.successionRisk/run',
    );
    expect(ran.status).toBe(200);
    const after = (
      await database
        .query()
        .selectFrom('hrReminderLog')
        .select(['id'])
        .where(
          'reminderKey',
          'like',
          `succession:risk:${planId}:noReadySuccessor:%`,
        )
        .execute()
    ).length;
    expect(after).toBe(before + 1);
    // Within 7 days the same reason is not sent again.
    await h.call(
      'hr01',
      'POST',
      '/talent-review-tasks/talentAnalyst.successionRisk/run',
    );
    expect(
      (
        await database
          .query()
          .selectFrom('hrReminderLog')
          .select(['id'])
          .where(
            'reminderKey',
            'like',
            `succession:risk:${planId}:noReadySuccessor:%`,
          )
          .execute()
      ).length,
    ).toBe(after);
  });

  it('the notes name no fields or status codes (车间主任)', async () => {
    const detail = await h.call('hr01', 'GET', `/succession/${planId}`);
    expect(detail.json.data.requirementsSet).toBe(true);
    for (const c of detail.json.data.candidates as { note: string }[])
      expect(mentionsInternals(c.note)).toBe(false);
  });

  let salesPlanId = '';
  it('a position without requirements: nobody “meets” them and the notes say so', async () => {
    const marked = await h.call(
      'hr01',
      'PUT',
      '/succession/positions/pos-sales-director/key',
      { isKey: true },
    );
    expect(marked.status).toBe(200);
    const plan = await until(
      async () => {
        const row = await (
          await h.db()
        )
          .query()
          .selectFrom('successionPlans')
          .selectAll()
          .where('positionId', '=', 'pos-sales-director')
          .executeTakeFirst();
        return row ? { ...row, candidates: decode(row.candidates) } : undefined;
      },
      (row) => Boolean(row && row.candidates.length),
    );
    salesPlanId = String(plan!.id);
    for (const c of plan!.candidates as { note: string }[]) {
      expect(c.note).toContain('该岗位尚未设置要求，无法比较差距');
      expect(c.note).not.toContain('已达到');
      expect(mentionsInternals(c.note)).toBe(false);
    }
    const detail = await h.call('hr01', 'GET', `/succession/${salesPlanId}`);
    expect(detail.json.data.requirementsSet).toBe(false);
    expect(detail.json.data.requirements).toEqual([]);
    const matches = await (
      await h.services()
    ).succession.match(
      plan!.positionId as string,
      plan!.departmentId as string,
    );
    expect(matches.every((m) => !m.requirementsSet)).toBe(true);
  });

  it('a stored note that names fields or status codes is shown as the rule-based note', async () => {
    const database = await h.db();
    const plan = await (await h.services()).succession.planRow(salesPlanId);
    await database
      .query()
      .updateTable('successionPlans')
      .set({
        candidates: plan.candidates.map((c) => ({
          ...c,
          note: '差距：gaps 为空，未记录。已有发展记录：学习计划（状态 approved/已批准）、学习计划（draft）',
        })),
      })
      .where('id', '=', salesPlanId)
      .execute();
    const detail = await h.call('hr01', 'GET', `/succession/${salesPlanId}`);
    for (const c of detail.json.data.candidates as { note: string }[]) {
      expect(c.note).toContain('该岗位尚未设置要求，无法比较差距');
      expect(c.note).not.toMatch(/gaps|draft|approved/u);
    }
  });
});

describe('13A 能力模型版本', () => {
  it('the draft raising 质量记录规范 to 3 previews new gaps and gets the advisor’s note; current gaps unchanged', async () => {
    const list = await h.call(
      'hr01',
      'GET',
      '/model-versions/positions/pos-cnc-operator',
    );
    expect(list.status).toBe(200);
    const { current, draft } = list.json.data;
    expect(current.versionNo).toBe(1);
    expect(draft).toBeTruthy();
    const quality = draft.snapshot.find(
      (s: { competencyId: string }) => s.competencyId === 'comp-quality-record',
    );
    expect(quality.requiredLevel).toBe(3);
    expect(draft.impactPreview.newGaps.count).toBeGreaterThan(0);
    expect(draft.impactPreview.changed[0]).toMatchObject({
      competencyId: 'comp-quality-record',
      from: 2,
      to: 3,
    });
    // Saving the draft asks the framework advisor for a change note (once per content).
    const saved = await h.call(
      'hr01',
      'PUT',
      '/model-versions/positions/pos-cnc-operator/draft',
      {
        snapshot: draft.snapshot.map((s: Record<string, unknown>) => ({
          competencyId: s.competencyId,
          requiredLevel: s.requiredLevel,
          mandatory: s.mandatory,
        })),
      },
    );
    expect(saved.status).toBe(200);
    const noted = await until(
      async () =>
        (
          await h.call(
            'hr01',
            'GET',
            '/model-versions/positions/pos-cnc-operator',
          )
        ).json.data.draft,
      (d) => Boolean(d?.changeNote),
    );
    expect(noted.changeNote).toContain('质量记录规范');
    const current2 = await (
      await h.db()
    )
      .query()
      .selectFrom('positionRequirements')
      .select(['requiredLevel'])
      .where('positionId', '=', 'pos-cnc-operator')
      .where('competencyId', '=', 'comp-quality-record')
      .executeTakeFirst();
    expect(Number(current2!.requiredLevel)).toBe(2);
    // Heads cannot publish.
    expect(
      (
        await h.call(
          'mgr_njl',
          'POST',
          `/model-versions/${noted.id}/publish`,
          {},
        )
      ).status,
    ).toBe(403);
  });

  it('publication replaces the requirements, archives version 1; a date before answers the old version', async () => {
    const draft = (
      await h.call('hr01', 'GET', '/model-versions/positions/pos-cnc-operator')
    ).json.data.draft;
    const published = await h.call(
      'hr01',
      'POST',
      `/model-versions/${draft.id}/publish`,
      {},
    );
    expect(published.status).toBe(200);
    expect(published.json.data.status).toBe('published');
    const row = await (
      await h.db()
    )
      .query()
      .selectFrom('positionRequirements')
      .select(['requiredLevel', 'reviewStatus'])
      .where('positionId', '=', 'pos-cnc-operator')
      .where('competencyId', '=', 'comp-quality-record')
      .executeTakeFirst();
    expect(Number(row!.requiredLevel)).toBe(3);
    expect(row!.reviewStatus).toBe('confirmed');
    const list = (
      await h.call('hr01', 'GET', '/model-versions/positions/pos-cnc-operator')
    ).json.data;
    expect(list.current.versionNo).toBe(draft.versionNo);
    expect(
      list.history.map((v: { versionNo: number }) => v.versionNo),
    ).toContain(1);
    const level = (data: Record<string, any>) =>
      data.version.snapshot.find(
        (s: { competencyId: string }) =>
          s.competencyId === 'comp-quality-record',
      ).requiredLevel;
    const yesterday = await h.call(
      'hr01',
      'GET',
      `/model-versions/positions/pos-cnc-operator/at?date=${shift(today(), -1)}`,
    );
    expect(level(yesterday.json.data)).toBe(2);
    const now = await h.call(
      'hr01',
      'GET',
      `/model-versions/positions/pos-cnc-operator/at?date=${today()}`,
    );
    expect(level(now.json.data)).toBe(3);
    // The audit export's question: 王磊's requirements on a date.
    const services = await h.services();
    const at = await services.versions.employeeRequirementsAt(
      'emp-wanglei',
      shift(today(), -1),
    );
    expect(at.positionId).toBe('pos-cnc-operator');
  });
});
