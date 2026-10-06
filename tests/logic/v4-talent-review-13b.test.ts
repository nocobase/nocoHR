// @vitest-environment node

// Acceptance checks for V4 step 13B on the V4 demo data (启衡精密): practical assessments (the examiner's structuring
// with 未记录, the pass rule where a critical item decides, signatures and the witness, immutability and voiding, the
// assessor permission set, no self-assessment), certification with a practical requirement (no renewal without a
// valid practical, renewal on the old expiry plus validity once signed), the AI-drafted form; instructors and
// training evaluations (l1 on completion, l3 to the head after the configured days, expiry, the admin-set period,
// statistics, the quarterly report); knowledge distillation (integration push with dedupe, the FAQ draft with source
// links and the conflict left out, drafts not answering, the uncontrolled notice) and content translation (glossary,
// codes and numbers kept, English learners, outdated on change, the English exam paper). No model is configured.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  decode,
  startHarness,
  until,
  type Harness,
} from './talent-review-harness.ts';

let h: Harness;
const FORM = 'pa-demo-cnc-first-article';

beforeAll(async () => {
  h = await startHarness('v4-talent-review-13b');
}, 240_000);

afterAll(async () => {
  await h?.close();
});

const allPass = (keys: string[], except: string[] = []) =>
  keys.map((key) => ({ key, passed: !except.includes(key), note: '' }));
const KEYS = ['safety', 'stopTime', 'gauge', 'measure', 'judge', 'record', 'report', 'fiveS'];

async function conduct(results: ReturnType<typeof allPass>) {
  const qa = await h.userId('qa_audit');
  const started = await h.call('trainer01', 'POST', '/practicals/records', {
    assessmentId: FORM,
    employeeId: 'emp-qianjin',
    witnessUserId: qa,
    location: '机加工车间 3 号机',
  });
  expect(started.status).toBe(201);
  const id = started.json.data.id as string;
  expect((await h.call('trainer01', 'PATCH', `/practicals/records/${id}`, { results })).status).toBe(200);
  expect((await h.call('trainer01', 'POST', `/practicals/records/${id}/sign`)).status).toBe(200);
  return id;
}

describe('13B 实操考核', () => {
  let recordId = '';

  it('lists the records the caller may see with no filter at all (the 实操考核 page load)', async () => {
    const listed = await h.call('trainer01', 'GET', '/practicals/records');
    expect(listed.status).toBe(200);
    expect(Array.isArray(listed.json.data)).toBe(true);
  });

  it('the examiner maps the notes to the items; an item without a note is 未记录, never pass; unchanged notes are kept', async () => {
    const qa = await h.userId('qa_audit');
    const started = await h.call('trainer01', 'POST', '/practicals/records', {
      assessmentId: FORM,
      employeeId: 'emp-qianjin',
      witnessUserId: qa,
    });
    expect(started.status).toBe(201);
    recordId = started.json.data.id;
    await h.call('trainer01', 'PATCH', `/practicals/records/${recordId}`, {
      observationNotes:
        '安全防护到位，穿戴劳保用品，没有戴手套。\n首件测量时孔径漏测一项，位置度测量正确。\n首件结果记入首件检验记录表，班组长签字。',
    });
    const structured = await h.call('trainer01', 'POST', `/practicals/records/${recordId}/structure`);
    expect(structured.status).toBe(200);
    const items = structured.json.data.aiStructured.items as {
      key: string;
      suggestion: string;
      quotes: string[];
    }[];
    const byKey = new Map(items.map((i) => [i.key, i]));
    expect(byKey.get('safety')!.quotes.length).toBeGreaterThan(0);
    expect(byKey.get('measure')!.suggestion).toBe('fail');
    expect(byKey.get('fiveS')!.suggestion).toBe('notRecorded');
    for (const item of items) if (!item.quotes.length) expect(item.suggestion).toBe('notRecorded');
    const again = await h.call('trainer01', 'POST', `/practicals/records/${recordId}/structure`);
    expect(again.json.data.restructured).toBe(false);
    const runs = await (await h.db())
      .query()
      .selectFrom('aiTaskRuns')
      .select(['id'])
      .where('task', '=', 'examiner.structureObservation')
      .where('status', '=', 'succeeded')
      .execute();
    expect(runs).toHaveLength(1);
  });

  it('a failed critical item fails the record whatever the rate; the witness signs; a signed record is immutable, hr01 voids it', async () => {
    await h.call('trainer01', 'PATCH', `/practicals/records/${recordId}`, {
      results: allPass(KEYS, ['measure']),
    });
    const signed = await h.call('trainer01', 'POST', `/practicals/records/${recordId}/sign`);
    expect(signed.status).toBe(200);
    expect(signed.json.data.status).toBe('signed');
    expect(signed.json.data.passed).toBe(false);
    expect(
      (await h.call('trainer01', 'PATCH', `/practicals/records/${recordId}`, { observationNotes: 'x' })).status,
    ).toBe(409);
    // Only the named witness signs.
    expect((await h.call('mgr_njl', 'POST', `/practicals/records/${recordId}/witness`)).status).toBe(404);
    const witnessed = await h.call('qa_audit', 'POST', `/practicals/records/${recordId}/witness`);
    expect(witnessed.status).toBe(200);
    expect(witnessed.json.data.status).toBe('completed');
    expect((await h.call('trainer01', 'POST', `/practicals/records/${recordId}/void`, { reason: 'x' })).status).toBe(403);
    expect((await h.call('hr01', 'POST', `/practicals/records/${recordId}/void`, {})).status).toBe(400);
    const voided = await h.call('hr01', 'POST', `/practicals/records/${recordId}/void`, {
      reason: '考评时量具未在校准有效期内，重新考核',
    });
    expect(voided.json.data.status).toBe('voided');
  });

  it('without hr.practicalAssessor nobody conducts; trainer01 cannot assess himself; the set can be removed and restored', async () => {
    expect((await h.call('mgr_njl', 'POST', '/practicals/records', { assessmentId: FORM, employeeId: 'emp-qianjin' })).status).toBe(403);
    expect((await h.call('mgr_njl', 'GET', '/practicals/templates')).status).toBe(403);
    expect(
      (await h.call('trainer01', 'POST', '/practicals/records', {
        assessmentId: FORM,
        employeeId: 'emp-trainer01',
        witnessUserId: await h.userId('qa_audit'),
      })).status,
    ).toBe(403);
    const database = await h.db();
    const trainer = await h.userId('trainer01');
    const { authorizationToken } = await import('@nocobase/app-plugin-authorization/server');
    const authz = h.server.application.container.resolve(authorizationToken);
    const assignment = await database
      .query()
      .selectFrom('authorizationPermissionSetAssignments')
      .selectAll()
      .where('permissionSetKey', '=', 'hr.practicalAssessor')
      .where('subjectId', '=', trainer)
      .executeTakeFirst();
    expect(assignment).toBeTruthy();
    await database
      .query()
      .deleteFrom('authorizationPermissionSetAssignments')
      .where('id', '=', String(assignment!.id))
      .execute();
    await authz.permissionSets.notifyAssignmentsChanged({ type: 'user', id: trainer });
    const body = { assessmentId: FORM, employeeId: 'emp-qianjin', witnessUserId: await h.userId('qa_audit') };
    expect((await h.call('trainer01', 'POST', '/practicals/records', body)).status).toBe(403);
    await database.query().insertInto('authorizationPermissionSetAssignments').values(assignment!).execute();
    await authz.permissionSets.notifyAssignmentsChanged({ type: 'user', id: trainer });
    expect((await h.call('trainer01', 'POST', '/practicals/records', body)).status).toBe(201);
  });

  it('钱进’s recertification waits for a valid practical, then renews on the old expiry plus the validity', async () => {
    const linked = await h.call('hr01', 'PUT', '/practicals/certifications/cert-cnc', {
      assessmentIds: [FORM],
      practicalRequiredFor: 'recert',
      practicalValidMonths: 12,
    });
    expect(linked.status).toBe(200);
    const database = await h.db();
    const old = await database
      .query()
      .selectFrom('employeeCertificates')
      .selectAll()
      .where('employeeId', '=', 'emp-qianjin')
      .where('certificationId', '=', 'cert-cnc')
      .where('status', 'in', ['valid', 'expiring'])
      .executeTakeFirst();
    expect(old).toBeTruthy();
    const now = new Date(Date.now() + 1000);
    await database
      .query()
      .insertInto('examAttempts')
      .values({
        id: 'tr-test-recert-attempt',
        examId: 'exam-cnc-cert',
        employeeId: 'emp-qianjin',
        attemptNo: 90,
        paperSnapshot: [],
        answers: {},
        startedAt: now,
        deadlineAt: now,
        submittedAt: now,
        objectiveScore: 90,
        subjectiveScore: 0,
        score: 90,
        status: 'passed',
        gradedBy: null,
        itemResults: [],
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const { certificationServiceToken } = await import('../../server/providers/hr/tokens.ts');
    const certifications = h.server.application.container.resolve(certificationServiceToken);
    expect(await certifications.evaluate('emp-qianjin')).toEqual([]);
    // A passed record signed by both.
    const id = await conduct(allPass(KEYS));
    const witnessed = await h.call('qa_audit', 'POST', `/practicals/records/${id}/witness`);
    expect(witnessed.json.data.passed).toBe(true);
    const renewed = await until(
      () =>
        database
          .query()
          .selectFrom('employeeCertificates')
          .selectAll()
          .where('employeeId', '=', 'emp-qianjin')
          .where('certificationId', '=', 'cert-cnc')
          .where('status', '=', 'valid')
          .executeTakeFirst(),
      (row) => Boolean(row && row.id !== old!.id),
    );
    expect(renewed).toBeTruthy();
    const base = new Date(`${String(old!.expiresAt).slice(0, 10)}T00:00:00Z`);
    base.setUTCMonth(base.getUTCMonth() + 12);
    expect(String(renewed!.expiresAt).slice(0, 10)).toBe(base.toISOString().slice(0, 10));
    expect(JSON.stringify(decode(renewed!.evidence))).toContain(id);
  });

  it('the examiner’s form from WI-MC-0231 is a draft that cannot be used until confirmed', async () => {
    const drafted = await h.call('trainer01', 'POST', '/practicals/templates/draft', {
      documentId: 'doc-wi-mc-0231',
      competencyIds: ['comp-cnc'],
    });
    expect(drafted.status).toBe(201);
    expect(drafted.json.data.reviewStatus).toBe('draft');
    expect(drafted.json.data.source).toBe('ai');
    expect(drafted.json.data.checklist.length).toBeGreaterThan(0);
    const assessmentId = drafted.json.data.id;
    const body = { assessmentId, employeeId: 'emp-wanglei' };
    expect((await h.call('trainer01', 'POST', '/practicals/records', body)).status).toBe(409);
    expect((await h.call('trainer01', 'POST', `/practicals/templates/${assessmentId}/confirm`)).status).toBe(200);
    expect((await h.call('trainer01', 'POST', '/practicals/records', body)).status).toBe(201);
  });

  it('without a model the form follows the checklist words in the settings; the demo keeps its own (首件, 点检)', async () => {
    const settings = await h.call('hr01', 'GET', '/talent-reviews/settings');
    expect(settings.status).toBe(200);
    const value = settings.json.data.value;
    expect(value.practicalCriticalKeywords).toContain('首件');
    expect(value.practicalSectionKeywords).toContain('点检');
    expect(value.glossary.map((g: { zh: string }) => g.zh)).toContain('首件检验');
    const draft = async () => {
      const drafted = await h.call('trainer01', 'POST', '/practicals/templates/draft', {
        documentId: 'doc-wi-mc-0231',
        competencyIds: ['comp-cnc'],
      });
      expect(drafted.status).toBe(201);
      return drafted.json.data.checklist as { item: string; critical: boolean }[];
    };
    expect((await draft()).some((c) => c.critical && c.item.includes('首件'))).toBe(true);
    const words = value.practicalCriticalKeywords as string[];
    expect(
      (await h.call('hr01', 'PUT', '/talent-reviews/settings/review', { practicalCriticalKeywords: ['严禁吸烟'] })).status,
    ).toBe(200);
    try {
      expect((await draft()).some((c) => c.critical)).toBe(false);
    } finally {
      await h.call('hr01', 'PUT', '/talent-reviews/settings/review', { practicalCriticalKeywords: words });
    }
  });
});

describe('13B 讲师与培训评估', () => {
  it('刘洋 completing 《车间安全与 5S 基础》 gets the l1 questionnaire and answers it', async () => {
    const services = await h.services();
    const id = await services.onCourseCompleted('emp-liuyang', 'course-safety-basics');
    expect(id).toBeTruthy();
    const mine = await h.call('emp_njl_4', 'GET', '/training-evaluations/mine');
    expect(mine.json.data.map((e: { id: string }) => e.id)).toContain(id);
    expect((await h.call('emp_njl_4', 'POST', `/training-evaluations/${id}/submit`, { answers: { useful: 4 } })).status).toBe(400);
    const submitted = await h.call('emp_njl_4', 'POST', `/training-evaluations/${id}/submit`, {
      answers: { useful: 4, clear: 5, applicable: 3 },
    });
    expect(submitted.status).toBe(200);
    expect(submitted.json.data.score).toBe(4);
    expect((await h.call('emp_njl_1', 'GET', `/training-evaluations/${id}`)).status).toBe(404);
  });

  it('30 days after completion the head gets the l3 task; past due becomes expired; the admin-set period applies next', async () => {
    const database = await h.db();
    const services = await h.services();
    const past = (days: number) => new Date(Date.now() - days * 86_400_000);
    await database
      .query()
      .insertInto('assignments')
      .values({
        id: 'tr-test-assign-liuyang',
        employeeId: 'emp-liuyang',
        courseId: 'course-quality-record',
        examId: null,
        certificateId: null,
        assignedByUserId: null,
        dueDate: null,
        status: 'completed',
        progress: 100,
        source: 'manual',
        completedAt: past(31),
        cancelledAt: null,
        lastRemindedAt: null,
        createdAt: past(40),
        updatedAt: past(31),
      })
      .execute();
    await services.evaluations.runDaily();
    const l3 = await database
      .query()
      .selectFrom('trainingEvaluations')
      .selectAll()
      .where('level', '=', 'l3')
      .where('employeeId', '=', 'emp-liuyang')
      .where('targetId', '=', 'course-quality-record')
      .executeTakeFirst();
    expect(l3).toBeTruthy();
    expect(l3!.respondentUserId).toBe(await h.userId('mgr_njl'));
    const njl = await h.call('mgr_njl', 'GET', '/training-evaluations/mine');
    expect(njl.json.data.some((e: { id: string }) => e.id === l3!.id)).toBe(true);
    // Past due: expired.
    await database
      .query()
      .updateTable('trainingEvaluations')
      .set({ dueAt: past(1) })
      .where('id', '=', String(l3!.id))
      .execute();
    await services.evaluations.runDaily();
    const expired = await database
      .query()
      .selectFrom('trainingEvaluations')
      .select(['status'])
      .where('id', '=', String(l3!.id))
      .executeTakeFirst();
    expect(expired!.status).toBe('expired');
    // 45 days: a completion 40 days ago gets no l3 yet, 46 days ago does.
    expect((await h.call('mgr_njl', 'PUT', '/talent-reviews/settings/evaluation', { l3AfterDays: 45 })).status).toBe(403);
    const set = await h.call('hr01', 'PUT', '/talent-reviews/settings/evaluation', { l3AfterDays: 45 });
    expect(set.status).toBe(200);
    expect(set.json.data.value.l3AfterDays).toBe(45);
    for (const [id, days, course] of [
      ['tr-test-assign-wang-40', 40, 'course-quality-record'],
      ['tr-test-assign-wang-46', 46, 'course-cnc-intro'],
    ] as const)
      await database
        .query()
        .insertInto('assignments')
        .values({
          id,
          employeeId: 'emp-wanglei',
          courseId: course,
          examId: null,
          certificateId: null,
          assignedByUserId: null,
          dueDate: null,
          status: 'completed',
          progress: 100,
          source: 'manual',
          completedAt: past(days),
          cancelledAt: null,
          lastRemindedAt: null,
          createdAt: past(days + 5),
          updatedAt: past(days),
        })
        .execute();
    await services.evaluations.runDaily();
    const wang = await database
      .query()
      .selectFrom('trainingEvaluations')
      .select(['targetId'])
      .where('level', '=', 'l3')
      .where('employeeId', '=', 'emp-wanglei')
      .execute();
    const targets = wang.map((w) => String(w.targetId));
    expect(targets).toContain('course-cnc-intro');
    expect(targets).not.toContain('course-quality-record');
  });

  it('instructor statistics follow the sessions; the external session has no account and a profile', async () => {
    const list = await h.call('hr01', 'GET', '/instructors');
    expect(list.status).toBe(200);
    const vendor = list.json.data.instructors.find((i: { id: string }) => i.id === 'ip-demo-vendor');
    expect(vendor.stats.sessions).toBe(1);
    expect(vendor.stats.hours).toBe(3);
    const session = await (await h.db())
      .query()
      .selectFrom('trainingSessions')
      .select(['instructorUserId', 'instructorProfileId'])
      .where('id', '=', 'ts-demo-vendor')
      .executeTakeFirst();
    // The organizer stays in the required instructorUserId; the profile names the external instructor.
    expect(session!.instructorUserId).toBe(await h.userId('trainer01'));
    expect(session!.instructorProfileId).toBe('ip-demo-vendor');
    const zheng = list.json.data.instructors.find((i: { id: string }) => i.id === 'ip-demo-zheng');
    const trainer = await h.userId('trainer01');
    const own = await (await h.db())
      .query()
      .selectFrom('trainingSessions')
      .select(['startAt', 'endAt'])
      .where('instructorUserId', '=', trainer)
      .where('instructorProfileId', 'is', null)
      .where('status', '!=', 'cancelled')
      .execute();
    const hours =
      Math.round(
        own.reduce(
          (sum, s) => sum + (new Date(String(s.endAt)).getTime() - new Date(String(s.startAt)).getTime()) / 3_600_000,
          0,
        ) * 10,
      ) / 10;
    expect(zheng.stats.sessions).toBe(own.length);
    expect(zheng.stats.hours).toBe(hours);
    expect((await h.call('mgr_njl', 'GET', '/instructors')).status).toBe(403);
  });

  it('the quarterly training report reaches hr01 once', async () => {
    const first = await h.call('hr01', 'POST', '/talent-review-tasks/talentAnalyst.trainingEffectReport/run');
    expect(first.status).toBe(200);
    expect(first.json.data.status).toBe('succeeded');
    const quarter = first.json.data.output.quarter;
    expect(await h.inboxText(`trainingReport:${quarter}`)).toContain('满意度最低的课程');
    const again = await h.call('hr01', 'POST', '/talent-review-tasks/talentAnalyst.trainingEffectReport/run');
    expect(again.json.data.status).toBe('skipped');
  });
});

describe('13B 知识沉淀与多语言', () => {
  it('integration_ticket pushes with its API key; the same item updates; unresolved tickets are refused', async () => {
    const { authenticationToken } = await import('@nocobase/app-plugin-authentication');
    const { ApiKeyService } = await import('@nocobase/app-plugin-api-keys/server');
    const service = new ApiKeyService(h.server.application.container.resolve(authenticationToken), 'default');
    const key = await service.create({ userId: await h.userId('integration_ticket'), name: 'ticket-test' });
    const items = ['TK-2026-1101', 'TK-2026-1102', 'TK-2026-1103'].map((externalId) => ({
      sourceSystem: 'ticket',
      externalId,
      title: `CNC 报警 E17 后如何复位（${externalId}）`,
      content: 'E17 报警：按急停后复位，检查主轴编码器插头，重新上电后执行主轴回零，报警消除。',
      link: `https://tickets.qiheng.example/${externalId}`,
      resolved: true,
    }));
    const pushed = await h.call(null, 'POST', '/knowledge-candidates:ingest', {
      items: [
        ...items,
        {
          sourceSystem: 'forum',
          externalId: 'FM-2026-0088',
          title: 'E17 报警复位后要不要做首件',
          content: '经验分享：E17 报警复位后，设备停机 15 分钟内不用做首件检验，直接继续批量加工即可。',
          featured: true,
        },
        { sourceSystem: 'ticket', externalId: 'TK-OPEN', title: '未解决', content: '处理中', resolved: false },
      ],
    }, { 'x-api-key': key.secret });
    expect(pushed.status).toBe(200);
    expect(pushed.json.data).toMatchObject({ created: 0, updated: 4, rejected: ['TK-OPEN'] });
    // The account reaches nothing else.
    expect((await h.call(null, 'GET', '/knowledge-candidates', undefined, { 'x-api-key': key.secret })).status).toBe(403);
  });

  it('the weekly run drafts the E17 FAQ with ticket links, leaves the conflicting forum claim out, and it answers only once confirmed', async () => {
    const database = await h.db();
    // WI-MC-0231 V4.1 (the V3-11 walkthrough uploads it): a stop longer than 10 minutes needs a first-article inspection.
    const doc = await database.query().selectFrom('kbDocuments').select(['contentText']).where('id', '=', 'doc-wi-mc-0231').executeTakeFirst();
    await database
      .query()
      .updateTable('kbDocuments')
      .set({ contentText: String(doc!.contentText).replace('停机超过 15 分钟', '停机超过 10 分钟'), version: 'V4.1' })
      .where('id', '=', 'doc-wi-mc-0231')
      .execute();
    const ran = await h.call('hr01', 'POST', '/talent-review-tasks/knowledgeAssistant.knowledgeDistill/run');
    expect(ran.status).toBe(200);
    if (ran.json.data.status !== 'succeeded')
      console.error(
        await database.query().selectFrom('aiTaskRuns').select(['error']).where('id', '=', String(ran.json.data.runId)).executeTakeFirst(),
      );
    expect(ran.json.data.status).toBe('succeeded');
    const pending = await h.call('hr01', 'GET', '/knowledge-candidates/pending-documents');
    const faq = pending.json.data.find((d: { title: string }) => d.title.includes('E17'));
    expect(faq).toBeTruthy();
    expect(faq.contentText).toContain('https://tickets.qiheng.example/TK-2026-1101');
    expect(faq.contentText).not.toContain('15 分钟内不用做首件');
    expect(JSON.stringify(faq.notes.conflicts)).toContain('FM-2026-0088');
    expect(JSON.stringify(faq.notes.conflicts)).toContain('WI-MC-0231');
    // Not an answer while a draft.
    const { knowledgeServiceToken } = await import('../../server/providers/hr/tokens.ts');
    const { scopeForUser } = await import('../../server/providers/hr/authorize.ts');
    const { authorizationToken } = await import('@nocobase/app-plugin-authorization/server');
    const knowledge = h.server.application.container.resolve(knowledgeServiceToken);
    const wang = await h.userId('emp_njl_1');
    const actor = { userId: wang, authz: await scopeForUser(h.server.application.container.resolve(authorizationToken), wang) };
    const before = await knowledge.search(actor, 'E17 报警怎么复位');
    expect(before.some((p) => p.documentId === faq.id)).toBe(false);
    // Once more: nothing new to draft.
    const again = await h.call('hr01', 'POST', '/talent-review-tasks/knowledgeAssistant.knowledgeDistill/run');
    expect(again.json.data.status).toBe('skipped');
    expect((await h.call('hr01', 'POST', `/knowledge-candidates/pending-documents/${faq.id}/confirm`)).status).toBe(200);
    const after = await knowledge.search(actor, 'E17 报警怎么复位');
    const hit = after.find((p) => p.documentId === faq.id) as { notice?: string; citation: string } | undefined;
    expect(hit).toBeTruthy();
    expect(hit!.notice).toBe('非受控文件，仅供参考');
    expect(hit!.citation).toContain('非受控文件，仅供参考');
  });

  it('trainer01’s English version of 《CNC 岗位操作入门》 follows the glossary and keeps codes and numbers; English learners see it once confirmed', async () => {
    const requested = await h.call('trainer01', 'POST', '/translations/course/course-cnc-intro/request');
    expect(requested.status).toBe(200);
    const list = await h.call('trainer01', 'GET', '/translations');
    const item = list.json.data.items.find((i: { originalId: string }) => i.originalId === 'course-cnc-intro');
    expect(item.reviewStatus).toBe('draft');
    const detail = await h.call('trainer01', 'GET', `/translations/course/${item.id}`);
    const text = JSON.stringify(detail.json.data.translation);
    expect(text).toContain('first article inspection');
    // Numbers and units stay (the course quotes WI-MC-0231 V4.0's 15 minutes).
    expect(text).toContain('15');
    expect(text).not.toContain('首件检验');
    // Another owner's content is not reachable.
    expect((await h.call('mgr_njl', 'GET', '/translations')).status).toBe(403);
    expect((await h.call('trainer01', 'POST', `/translations/course/${item.id}/confirm`)).status).toBe(200);
    // The same original version is drafted only once.
    await h.call('trainer01', 'POST', '/translations/course/course-cnc-intro/request');
    const count = async () =>
      (
        await (await h.db())
          .query()
          .selectFrom('courses')
          .select(['id'])
          .where('translationOfId', '=', 'course-cnc-intro')
          .execute()
      ).length;
    expect(await count()).toBe(1);
    // The course list does not show the English version as a course.
    const courses = await h.call('trainer01', 'GET', '/courses');
    expect(JSON.stringify(courses.json)).not.toContain(item.id);
  });

  it('changing the original marks the English version 待更新 and drafts a new one once', async () => {
    const database = await h.db();
    const lesson = await database.query().selectFrom('lessons').select(['id', 'content']).where('courseId', '=', 'course-cnc-intro').orderBy('sortOrder').executeTakeFirst();
    await database
      .query()
      .updateTable('lessons')
      .set({ content: `${String(lesson!.content)}\n\n补充：首件检验记录须由班组长签字。` })
      .where('id', '=', String(lesson!.id))
      .execute();
    const services = await h.services();
    expect((await services.runHourly()).redrafted).toBe(1);
    expect((await services.runHourly()).redrafted).toBe(0);
    const rows = await database
      .query()
      .selectFrom('courses')
      .select(['reviewStatus', 'translationStatus'])
      .where('translationOfId', '=', 'course-cnc-intro')
      .execute();
    expect(rows.map((r) => `${String(r.reviewStatus)}:${String(r.translationStatus)}`).sort()).toEqual([
      'confirmed:outdated',
      'draft:upToDate',
    ]);
  });

  it('an English candidate gets the English question; it is the same question for drawing and grading', async () => {
    const database = await h.db();
    const services = await h.services();
    const question = await database
      .query()
      .selectFrom('questions')
      .innerJoin('questionCompetencies', 'questionCompetencies.questionId', 'questions.id')
      .select(['questions.id as id', 'questions.stem as stem'])
      .where('questionCompetencies.competencyId', '=', 'comp-cnc')
      .where('questions.type', '=', 'single')
      .where('questions.reviewStatus', '=', 'confirmed')
      .executeTakeFirst();
    const id = String(question!.id);
    await services.translations.draft(null, 'question', id);
    const translation = await database.query().selectFrom('questions').selectAll().where('translationOfId', '=', id).executeTakeFirst();
    const hr = await h.userId('hr01');
    const { scopeForUser } = await import('../../server/providers/hr/authorize.ts');
    const { authorizationToken } = await import('@nocobase/app-plugin-authorization/server');
    const actor = { userId: hr, authz: await scopeForUser(h.server.application.container.resolve(authorizationToken), hr) };
    await services.translations.confirm(actor, 'question', String(translation!.id));
    const texts = await services.translations.questionTexts([id], 'en-US');
    expect(texts.get(id)?.stem).toBe(String(translation!.stem));
    expect((await services.translations.questionTexts([id], 'zh-CN')).size).toBe(0);
    // The translation is never a candidate of its own in a random draw.
    const { examServiceToken } = await import('../../server/providers/hr/tokens.ts');
    const exams = h.server.application.container.resolve(examServiceToken);
    const availability = await exams.ruleAvailability(actor, [
      { competencyId: 'comp-cnc', questionType: 'single', difficulty: null, count: 1, scoreEach: 10 },
    ]);
    const originals = await database
      .query()
      .selectFrom('questions')
      .innerJoin('questionCompetencies', 'questionCompetencies.questionId', 'questions.id')
      .select(['questions.id as id'])
      .where('questionCompetencies.competencyId', '=', 'comp-cnc')
      .where('questions.type', '=', 'single')
      .where('questions.reviewStatus', '=', 'confirmed')
      .where('questions.active', '=', true)
      .execute();
    expect(availability[0]).toBe(originals.length);
    // The answer key is the original's (grading is the same).
    expect(decode(translation!.answer)).toEqual(
      decode((await database.query().selectFrom('questions').select(['answer']).where('id', '=', id).executeTakeFirst())!.answer),
    );
  });
});
