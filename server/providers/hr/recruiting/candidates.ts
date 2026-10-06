/**
 * 候选人与投递 (V2-07): intake (the careers page and the recruiter's import
 * share one path), deduplication, the recruiter's screening decision, the
 * talent pool, candidate messages and anonymization.
 *
 * - One person is one candidate: a new application whose mobile or email
 *   matches a candidate who is not anonymized is merged into them. A second
 *   submission to the same posting only counts (`submitCount`): it is not
 *   screened again.
 * - The assistant's suggestion never changes the stage; the recruiter
 *   advances, holds or rejects, and a rejection must name the posting's
 *   requirements it rests on.
 * - Contact data and the resume are read only with `talent.candidate`
 *   `viewContact` and only by the requisition's recruiter. Hiring managers
 *   and interviewers see the profile without them.
 * - Anonymization removes contact data, the resume file, the parsed profile,
 *   added fields, messages and AI interview records; stages and channels stay
 *   for the statistics.
 */
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import {
  PROTECTED_CHARACTERISTIC,
  type CustomFieldPlacement,
} from '../custom-fields.js';
import type { ActorContext } from '../framework-service.js';
import { addDays, HrError, newId, str } from '../shared.js';
import {
  addMonthsToDate,
  day,
  iso,
  json,
  maskPhone,
  newToken,
  normalizeEmail,
  normalizePhone,
  num,
  STAGES,
  type CandidateMessage,
  type KnockoutQuestion,
  type Requirement,
  type ScreeningSuggestion,
  type Stage,
  yesNoValue,
} from './common.js';
import type { RecruitingContext } from './context.js';
import type { PostingService, PostingView } from './postings.js';
import type { RequisitionService, RequisitionView } from './requisitions.js';
import { COMPOSITE } from './resources.js';
import {
  extractResumeText,
  readIdentity,
  type ParsedProfile,
} from './resume-text.js';

export const RESUME_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  txt: 'text/plain',
};

export interface UploadedFile {
  name: string;
  bytes: Uint8Array;
  mimeType: string;
}

const decisionSchema = z
  .object({
    decision: z.enum(['advance', 'hold', 'reject']),
    rejectRequirementKeys: z.array(z.string().min(1).max(40)).max(40).nullish(),
    rejectNote: z.string().trim().max(1000).nullish(),
  })
  .strict();

const profileSchema = z
  .object({
    education: z
      .array(
        z
          .object({
            level: z.enum([
              'middleSchool',
              'highSchool',
              'vocational',
              'associate',
              'bachelor',
              'master',
              'doctor',
              'unknown',
            ]),
            school: z.string().trim().max(60).nullish(),
            major: z.string().trim().max(60).nullish(),
          })
          .strict(),
      )
      .max(5),
    experiences: z
      .array(
        z
          .object({
            summary: z.string().trim().min(1).max(200),
            years: z.number().min(0).max(60).nullish(),
            keywords: z.array(z.string().trim().max(30)).max(10).default([]),
          })
          .strict(),
      )
      .max(10),
    skills: z.array(z.string().trim().min(1).max(40)).max(30),
    certificates: z.array(z.string().trim().min(1).max(60)).max(10),
  })
  .strict();

export function presentApplication(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    candidateId: str(row.candidateId),
    postingId: str(row.postingId),
    stage: str(row.stage) as Stage,
    sourceChannel: str(row.sourceChannel),
    screeningSuggestion: json<ScreeningSuggestion | null>(
      row.screeningSuggestion,
      null,
    ),
    screenedAt: iso(row.screenedAt),
    knockoutAnswers: json<
      { key: string; answer: string; meetsExpected: boolean | null }[]
    >(row.knockoutAnswers, []),
    screeningDecision: row.screeningDecision
      ? (str(row.screeningDecision) as 'advance' | 'hold' | 'reject')
      : null,
    decidedBy: row.decidedBy ? str(row.decidedBy) : null,
    decidedAt: iso(row.decidedAt),
    rejectRequirementKeys: json<string[]>(row.rejectRequirementKeys, []),
    rejectNote: row.rejectNote ? str(row.rejectNote) : null,
    stageHistory: json<
      {
        from: string | null;
        to: string;
        by: string;
        at: string;
        note?: string;
      }[]
    >(row.stageHistory, []),
    stageSince: iso(row.stageSince),
    messages: json<CandidateMessage[]>(row.messages, []),
    submitCount: num(row.submitCount, 1),
    lastSubmittedAt: iso(row.lastSubmittedAt),
    aiInterviewDeclined:
      row.aiInterviewDeclined === true || row.aiInterviewDeclined === 1,
    createdAt: iso(row.createdAt),
  };
}
export type ApplicationView = ReturnType<typeof presentApplication>;

export function presentCandidate(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    name: str(row.name),
    phone: row.phone ? str(row.phone) : null,
    email: row.email ? str(row.email) : null,
    resumeFileId: row.resumeFileId ? str(row.resumeFileId) : null,
    parsedProfile: json<ParsedProfile | null>(row.parsedProfile, null),
    parseConfidence: json<Record<string, number> | null>(
      row.parseConfidence,
      null,
    ),
    parseStatus: str(row.parseStatus ?? 'none'),
    sourceChannel: str(row.sourceChannel),
    consentAt: iso(row.consentAt),
    consentBy: str(row.consentBy),
    retentionUntil: day(row.retentionUntil),
    lastActivityAt: iso(row.lastActivityAt),
    anonymizedAt: iso(row.anonymizedAt),
    /** V2-07 删除申请: when the candidate asked to be deleted through the receipt's link. */
    deletionRequestedAt: iso(row.deletionRequestedAt),
    customFields: json<Record<string, unknown>>(row.customFields, {}),
  };
}
export type CandidateView = ReturnType<typeof presentCandidate>;

/** Whether an answer meets the question's expectation; a free-text answer is never judged. */
export function judgeAnswer(
  question: KnockoutQuestion,
  answer: string,
): boolean | null {
  if (question.answerType === 'shortText' || !question.expected) return null;
  if (question.answerType === 'yesNo') {
    const expected = yesNoValue(question.expected);
    return expected ? yesNoValue(answer) === expected : null;
  }
  return answer.trim() === question.expected.trim();
}

export function createCandidateService(
  ctx: RecruitingContext,
  deps: {
    requisitions: RequisitionService;
    postings: PostingService;
    /** A new application: the assistant parses and screens it once (background). */
    onNewApplication: (applicationId: string, resumeChanged: boolean) => void;
  },
) {
  const { database, platform } = ctx;

  async function applicationRow(id: string): Promise<ApplicationView> {
    const found = await database
      .query()
      .selectFrom('applications')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!found) throw new HrError('APPLICATION_NOT_FOUND', 404);
    return presentApplication(found);
  }

  async function candidateRow(id: string): Promise<CandidateView> {
    const found = await database
      .query()
      .selectFrom('candidates')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!found) throw new HrError('CANDIDATE_NOT_FOUND', 404);
    return presentCandidate(found);
  }

  /** How the actor relates to an application; everything a view may show follows from it. */
  async function access(actor: ActorContext, application: ApplicationView) {
    const posting = await deps.postings.get(application.postingId);
    const requisition = await deps.requisitions.get(posting.requisitionId);
    const recruiter =
      requisition.recruiterUserId === actor.userId &&
      (await ctx.can(actor, COMPOSITE.candidate, 'manage'));
    const managed = await platform.organization.managedDepartments(
      actor.userId,
    );
    const manager =
      (requisition.hiringManagerUserId === actor.userId ||
        managed.includes(requisition.departmentId)) &&
      (await ctx.can(actor, COMPOSITE.candidate, 'view'));
    const interviews = await database
      .query()
      .selectFrom('interviews')
      .select(['interviewerUserIds'])
      .where('applicationId', '=', application.id)
      .execute();
    const interviewer = interviews.some((i) =>
      json<string[]>(i.interviewerUserIds, []).includes(actor.userId),
    );
    const contact =
      recruiter && (await ctx.can(actor, COMPOSITE.candidate, 'viewContact'));
    return { posting, requisition, recruiter, manager, interviewer, contact };
  }

  async function customFieldDefinitions() {
    try {
      return await ctx.customFields().list('candidates');
    } catch {
      return [];
    }
  }

  function customValues(
    definitions: Awaited<ReturnType<typeof customFieldDefinitions>>,
    stored: Record<string, unknown>,
    options: {
      sensitive: boolean;
      aiOnly?: boolean;
      placement?: CustomFieldPlacement;
    },
  ) {
    const out: Record<string, unknown> = {};
    const shown = ctx.customFields().visible(definitions, {
      sensitive: options.sensitive,
      aiOnly: options.aiOnly,
      placement: options.placement,
      // The detail page shows stored values of retired fields too.
      includeInactive: !options.placement && !options.aiOnly,
    });
    for (const d of shown) {
      // Defence in depth: the settings refuse an AI-readable protected field, and screening never reads one.
      if (
        options.aiOnly &&
        PROTECTED_CHARACTERISTIC.test(
          `${d.key} ${d.label['zh-CN']} ${d.label['en-US'] ?? ''}`,
        )
      )
        continue;
      if (stored[d.key] != null) out[d.key] = stored[d.key];
    }
    return out;
  }

  async function stamp(
    id: string,
    from: Stage,
    to: Stage,
    by: string,
    note?: string,
  ) {
    const current = await applicationRow(id);
    const now = new Date();
    await database
      .query()
      .updateTable('applications')
      .set({
        stage: to,
        stageSince: now,
        stageHistory: [
          ...current.stageHistory,
          { from, to, by, at: now.toISOString(), ...(note ? { note } : {}) },
        ],
        updatedAt: now,
      })
      .where('id', '=', id)
      .execute();
    await database
      .query()
      .updateTable('candidates')
      .set({ lastActivityAt: now, updatedAt: now })
      .where('id', '=', current.candidateId)
      .execute();
  }

  async function view(actor: ActorContext, application: ApplicationView) {
    const a = await access(actor, application);
    const candidate = await candidateRow(application.candidateId);
    const definitions = await customFieldDefinitions();
    const interviews = await database
      .query()
      .selectFrom('interviews')
      .select([
        'id',
        'round',
        'mode',
        'scheduledAt',
        'status',
        'interviewerUserIds',
        'aiSummary',
        'aiReport',
      ])
      .where('applicationId', '=', application.id)
      .orderBy('round', 'asc')
      .execute();
    const offers = await database
      .query()
      .selectFrom('offers')
      .select(['id', 'status', 'startDate'])
      .where('applicationId', '=', application.id)
      .execute();
    return {
      ...application,
      // Messages are the recruiter's; a hiring manager sees the stage, not the correspondence.
      messages: a.recruiter ? application.messages : [],
      candidate: {
        id: candidate.id,
        name: candidate.name,
        phone: a.contact ? candidate.phone : null,
        phoneMasked: a.contact ? null : maskPhone(candidate.phone),
        email: a.contact ? candidate.email : null,
        hasResume: Boolean(candidate.resumeFileId),
        resumeAvailable: a.contact && Boolean(candidate.resumeFileId),
        parsedProfile: candidate.parsedProfile,
        parseConfidence: candidate.parseConfidence,
        parseStatus: candidate.parseStatus,
        sourceChannel: candidate.sourceChannel,
        consentAt: candidate.consentAt,
        retentionUntil: candidate.retentionUntil,
        anonymizedAt: candidate.anonymizedAt,
        // The recruiter acts on a deletion request; a hiring manager is not told.
        deletionRequestedAt: a.recruiter ? candidate.deletionRequestedAt : null,
        customFields: customValues(definitions, candidate.customFields, {
          sensitive: a.recruiter,
        }),
      },
      customFieldDefinitions: definitions
        .filter((d) => d.active && (a.recruiter || !d.sensitive))
        .map((d) => ({
          key: d.key,
          label: d.label,
          type: d.type,
          options: d.options,
          aiReadable: d.aiReadable,
        })),
      posting: {
        id: a.posting.id,
        title: a.posting.title,
        requirements: a.posting.requirements,
        knockoutQuestions: a.posting.knockoutQuestions,
      },
      requisition: {
        id: a.requisition.id,
        departmentTitle: await ctx.departmentTitle(a.requisition.departmentId),
        positionId: a.requisition.positionId,
        departmentId: a.requisition.departmentId,
        hiringManagerUserId: a.requisition.hiringManagerUserId,
      },
      knockoutUnmet: application.knockoutAnswers.some(
        (k) => k.meetsExpected === false,
      ),
      interviews: interviews.map((i) => ({
        id: str(i.id),
        round: num(i.round),
        mode: str(i.mode),
        scheduledAt: iso(i.scheduledAt),
        status: str(i.status),
        interviewerUserIds: json<string[]>(i.interviewerUserIds, []),
        hasSummary: Boolean(json(i.aiSummary, null)),
        aiReport: a.recruiter ? json(i.aiReport, null) : null,
      })),
      offers: offers.map((o) => ({
        id: str(o.id),
        status: str(o.status),
        startDate: day(o.startDate),
      })),
      can: {
        manage: a.recruiter,
        decide:
          a.recruiter &&
          ['applied', 'screening'].includes(application.stage) &&
          (await ctx.can(actor, COMPOSITE.candidate, 'decide')),
        contact: a.contact,
        anonymize:
          a.recruiter &&
          !candidate.anonymizedAt &&
          (await ctx.can(actor, COMPOSITE.candidate, 'anonymize')),
        schedule:
          a.recruiter &&
          (await ctx.can(actor, COMPOSITE.interview, 'schedule')),
        offer: a.recruiter && (await ctx.can(actor, COMPOSITE.offer, 'manage')),
      },
    };
  }

  async function validateResume(file: UploadedFile, publicPage: boolean) {
    const settings = await ctx.settings();
    if (file.bytes.byteLength > settings.publicPage.maxResumeMb * 1024 * 1024)
      throw new HrError('RESUME_TOO_LARGE', 400);
    const ext = file.name.toLowerCase().split('.').pop() ?? '';
    const allowed = publicPage
      ? ['pdf', 'docx', 'doc']
      : ['pdf', 'docx', 'doc', 'txt'];
    if (!allowed.includes(ext)) throw new HrError('RESUME_TYPE_INVALID', 400);
    // The declared type must agree with the extension (a renamed executable is refused by its bytes too).
    const head = file.bytes.slice(0, 4);
    const isPdf = head[0] === 0x25 && head[1] === 0x50;
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    const isOle = head[0] === 0xd0 && head[1] === 0xcf;
    if (ext === 'pdf' && !isPdf) throw new HrError('RESUME_TYPE_INVALID', 400);
    if (ext === 'docx' && !isZip) throw new HrError('RESUME_TYPE_INVALID', 400);
    if (ext === 'doc' && !isOle) throw new HrError('RESUME_TYPE_INVALID', 400);
    return RESUME_MIME[ext];
  }

  const service = {
    applicationRow,
    candidateRow,
    access,
    stamp,
    customFieldDefinitions,
    customValues,
    validateResume,

    /**
     * One application from the careers page or an import. Deduplicates by
     * mobile or email; answers whether the application is new (only a new
     * one is screened).
     */
    async intake(input: {
      posting: PostingView;
      name: string;
      phone: string | null;
      email: string | null;
      file: UploadedFile | null;
      sourceChannel: string;
      consentBy: 'page' | 'recruiter' | 'email';
      knockoutAnswers: { key: string; answer: string }[];
      customFields: Record<string, unknown>;
      by: string;
    }) {
      const settings = await ctx.settings();
      const phone = normalizePhone(input.phone);
      const email = normalizeEmail(input.email);
      if (!phone && !email)
        throw new HrError('CANDIDATE_CONTACT_REQUIRED', 400);
      const now = new Date();
      const retentionUntil = addMonthsToDate(
        platform.currentDate(),
        settings.retention.months,
      );
      const matches = await database
        .query()
        .selectFrom('candidates')
        .selectAll()
        .where('anonymizedAt', 'is', null)
        .where((eb) =>
          eb.or([
            ...(phone ? [eb('phone', '=', phone)] : []),
            ...(email ? [eb('email', '=', email)] : []),
          ]),
        )
        .execute();
      const existing = matches[0] ? presentCandidate(matches[0]) : undefined;
      let resumeFileId: string | null = null;
      if (input.file)
        resumeFileId = await ctx.storeFile({
          name: input.file.name,
          bytes: input.file.bytes,
          mimeType: input.file.mimeType,
          folder: 'resumes',
        });
      let candidateId: string;
      if (existing) {
        candidateId = existing.id;
        if (resumeFileId && existing.resumeFileId)
          await ctx.removeFile(existing.resumeFileId);
        await database
          .query()
          .updateTable('candidates')
          .set({
            phone: existing.phone ?? phone,
            email: existing.email ?? email,
            ...(resumeFileId ? { resumeFileId, parseStatus: 'pending' } : {}),
            consentAt: now,
            consentBy: input.consentBy,
            retentionUntil,
            lastActivityAt: now,
            customFields: { ...existing.customFields, ...input.customFields },
            updatedAt: now,
          })
          .where('id', '=', candidateId)
          .execute();
      } else {
        candidateId = newId();
        await database
          .query()
          .insertInto('candidates')
          .values({
            id: candidateId,
            name: input.name.trim().slice(0, 200),
            phone,
            email,
            resumeFileId,
            parsedProfile: null,
            parseConfidence: null,
            parseStatus: resumeFileId ? 'pending' : 'none',
            sourceChannel: input.sourceChannel,
            consentAt: now,
            consentBy: input.consentBy,
            retentionUntil,
            lastActivityAt: now,
            anonymizedAt: null,
            anonymizedBy: null,
            customFields: input.customFields,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      }
      const answers = input.knockoutAnswers
        .map((a) => {
          const question = input.posting.knockoutQuestions.find(
            (q) => q.key === a.key,
          );
          return question
            ? {
                key: a.key,
                answer: a.answer.trim().slice(0, 200),
                meetsExpected: judgeAnswer(question, a.answer),
              }
            : null;
        })
        .filter((a): a is NonNullable<typeof a> => a !== null);
      const prior = await database
        .query()
        .selectFrom('applications')
        .select(['id', 'submitCount'])
        .where('candidateId', '=', candidateId)
        .where('postingId', '=', input.posting.id)
        .executeTakeFirst();
      if (prior) {
        // 重复投递合并: counted, not screened again.
        await database
          .query()
          .updateTable('applications')
          .set({
            submitCount: num(prior.submitCount, 1) + 1,
            lastSubmittedAt: now,
            ...(answers.length ? { knockoutAnswers: answers } : {}),
            updatedAt: now,
          })
          .where('id', '=', str(prior.id))
          .execute();
        return {
          candidateId,
          applicationId: str(prior.id),
          created: false,
          merged: true,
        };
      }
      const applicationId = newId();
      await database
        .query()
        .insertInto('applications')
        .values({
          id: applicationId,
          candidateId,
          postingId: input.posting.id,
          stage: 'applied',
          sourceChannel: input.sourceChannel,
          screeningSuggestion: null,
          screenedAt: null,
          knockoutAnswers: answers,
          screeningDecision: null,
          decidedBy: null,
          decidedAt: null,
          rejectRequirementKeys: null,
          rejectNote: null,
          stageHistory: [
            { from: null, to: 'applied', by: input.by, at: now.toISOString() },
          ],
          stageSince: now,
          messages: [],
          submitCount: 1,
          lastSubmittedAt: now,
          bookingTokenHash: null,
          aiInterviewDeclined: false,
          aiInterviewTokenHash: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      deps.onNewApplication(applicationId, Boolean(resumeFileId) || !existing);
      return {
        candidateId,
        applicationId,
        created: true,
        merged: Boolean(existing),
      };
    },

    /** 手工导入: resume files for a posting; the recruiter confirms consent was obtained. */
    async importResumes(
      actor: ActorContext,
      input: {
        postingId: string;
        sourceChannel: string;
        consentConfirmed: boolean;
        files: UploadedFile[];
      },
    ) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'manage');
      if (!input.consentConfirmed)
        throw new HrError('CANDIDATE_CONSENT_REQUIRED', 400);
      if (!input.files.length) throw new HrError('IMPORT_FILE_REQUIRED', 400);
      if (input.files.length > 200) throw new HrError('IMPORT_TOO_MANY', 400);
      const posting = await deps.postings.get(input.postingId);
      const requisition = await deps.requisitions.get(posting.requisitionId);
      if (requisition.recruiterUserId !== actor.userId)
        throw new HrError('POSTING_NOT_FOUND', 404);
      const results: {
        file: string;
        status: 'created' | 'merged' | 'duplicate' | 'failed';
        code?: string;
        applicationId?: string;
      }[] = [];
      for (const file of input.files) {
        try {
          const mimeType = await validateResume(file, false);
          const text = await extractResumeText(file.bytes, file.name, mimeType);
          const identity = text
            ? readIdentity(text)
            : { name: null, phone: null, email: null };
          const outcome = await service.intake({
            posting,
            name:
              identity.name ??
              file.name
                .replace(/\.[^.]+$/u, '')
                .replace(/简历|[_-]/gu, ' ')
                .trim(),
            phone: identity.phone,
            email: identity.email,
            file: { ...file, mimeType },
            sourceChannel: input.sourceChannel || 'import',
            consentBy: 'recruiter',
            knockoutAnswers: [],
            customFields: {},
            by: actor.userId,
          });
          results.push({
            file: file.name,
            status: outcome.created
              ? outcome.merged
                ? 'merged'
                : 'created'
              : 'duplicate',
            applicationId: outcome.applicationId,
          });
        } catch (error) {
          results.push({
            file: file.name,
            status: 'failed',
            code: error instanceof HrError ? error.code : 'IMPORT_FAILED',
          });
        }
      }
      ctx.audit({
        event: 'recruiting.import',
        postingId: posting.id,
        by: actor.userId,
        count: input.files.length,
      });
      return { results };
    },

    /** 候选人: the applications of the requisitions the actor recruits for or manages. */
    async list(actor: ActorContext, query: Record<string, string | undefined>) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'view');
      let q = database
        .query()
        .selectFrom('applications')
        .innerJoin('candidates', 'candidates.id', 'applications.candidateId')
        .innerJoin('jobPostings', 'jobPostings.id', 'applications.postingId')
        .innerJoin(
          'jobRequisitions',
          'jobRequisitions.id',
          'jobPostings.requisitionId',
        )
        .select([
          'applications.id as id',
          'applications.stage as stage',
          'applications.screeningSuggestion as screeningSuggestion',
          'applications.knockoutAnswers as knockoutAnswers',
          'applications.screeningDecision as screeningDecision',
          'applications.sourceChannel as sourceChannel',
          'applications.stageSince as stageSince',
          'applications.submitCount as submitCount',
          'applications.createdAt as createdAt',
          'candidates.id as candidateId',
          'candidates.name as name',
          'candidates.anonymizedAt as anonymizedAt',
          'jobPostings.id as postingId',
          'jobPostings.title as postingTitle',
          'jobRequisitions.id as requisitionId',
          'jobRequisitions.recruiterUserId as recruiterUserId',
          'jobRequisitions.hiringManagerUserId as hiringManagerUserId',
          'jobRequisitions.departmentId as departmentId',
        ]);
      if (query.postingId) q = q.where('jobPostings.id', '=', query.postingId);
      if (query.stage) q = q.where('applications.stage', '=', query.stage);
      const rows = await q.orderBy('applications.createdAt', 'desc').execute();
      const managed = new Set(
        await platform.organization.managedDepartments(actor.userId),
      );
      const recruiter = await ctx.can(actor, COMPOSITE.candidate, 'manage');
      const search = (query.search ?? '').trim();
      const items = rows
        .filter(
          (r) =>
            (recruiter && str(r.recruiterUserId) === actor.userId) ||
            str(r.hiringManagerUserId) === actor.userId ||
            managed.has(str(r.departmentId)),
        )
        .filter((r) => !search || str(r.name).includes(search))
        .map((r) => {
          const suggestion = json<ScreeningSuggestion | null>(
            r.screeningSuggestion,
            null,
          );
          return {
            id: str(r.id),
            candidateId: str(r.candidateId),
            name: str(r.name),
            anonymized: Boolean(r.anonymizedAt),
            stage: str(r.stage),
            matchLevel: suggestion?.matchLevel ?? null,
            knockoutUnmet: json<{ meetsExpected: boolean | null }[]>(
              r.knockoutAnswers,
              [],
            ).some((k) => k.meetsExpected === false),
            screeningDecision: r.screeningDecision
              ? str(r.screeningDecision)
              : null,
            sourceChannel: str(r.sourceChannel),
            submitCount: num(r.submitCount, 1),
            stageSince: iso(r.stageSince),
            createdAt: iso(r.createdAt),
            postingId: str(r.postingId),
            postingTitle: str(r.postingTitle),
          };
        });
      return {
        items,
        stages: STAGES,
        can: {
          import: recruiter,
          pool: recruiter,
        },
      };
    },

    async detail(actor: ActorContext, applicationId: string) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'view');
      const application = await applicationRow(applicationId);
      const a = await access(actor, application);
      if (!a.recruiter && !a.manager)
        throw new HrError('APPLICATION_NOT_FOUND', 404);
      return view(actor, application);
    },

    /** The original resume, for the requisition's recruiter only. */
    async resume(actor: ActorContext, applicationId: string) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'viewContact');
      const application = await applicationRow(applicationId);
      const a = await access(actor, application);
      if (!a.contact) throw new HrError('APPLICATION_NOT_FOUND', 404);
      const candidate = await candidateRow(application.candidateId);
      if (!candidate.resumeFileId) throw new HrError('RESUME_NOT_FOUND', 404);
      const file = await ctx.readFile(candidate.resumeFileId);
      if (!file) throw new HrError('RESUME_NOT_FOUND', 404);
      ctx.audit({
        event: 'recruiting.resumeRead',
        applicationId,
        by: actor.userId,
      });
      return file;
    },

    /** 解析结果（可修改）: the recruiter corrects the parsed profile. */
    async updateProfile(
      actor: ActorContext,
      applicationId: string,
      input: unknown,
    ) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'manage');
      const application = await applicationRow(applicationId);
      if (!(await access(actor, application)).recruiter)
        throw new HrError('APPLICATION_NOT_FOUND', 404);
      const parsed = profileSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      await database
        .query()
        .updateTable('candidates')
        .set({
          parsedProfile: parsed.data,
          parseStatus: 'parsed',
          updatedAt: new Date(),
        })
        .where('id', '=', application.candidateId)
        .execute();
      return service.detail(actor, applicationId);
    },

    /** Values of administrator-added fields, from the candidate detail. */
    async updateCustomFields(
      actor: ActorContext,
      applicationId: string,
      input: unknown,
    ) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'manage');
      const application = await applicationRow(applicationId);
      if (!(await access(actor, application)).recruiter)
        throw new HrError('APPLICATION_NOT_FOUND', 404);
      const candidate = await candidateRow(application.candidateId);
      const definitions = await customFieldDefinitions();
      const values = ctx
        .customFields()
        .prepare(definitions, input, candidate.customFields);
      await database
        .query()
        .updateTable('candidates')
        .set({ customFields: values, updatedAt: new Date() })
        .where('id', '=', candidate.id)
        .execute();
      return service.detail(actor, applicationId);
    },

    /** 推进 / 待定 / 淘汰, by the requisition's recruiter; a rejection names the requirements it rests on. */
    async decide(actor: ActorContext, applicationId: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'decide');
      const parsed = decisionSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const application = await applicationRow(applicationId);
      const a = await access(actor, application);
      if (!a.recruiter) throw new HrError('APPLICATION_NOT_FOUND', 404);
      if (!['applied', 'screening'].includes(application.stage))
        throw new HrError('APPLICATION_STAGE_INVALID', 409);
      const { decision } = parsed.data;
      const keys = parsed.data.rejectRequirementKeys ?? [];
      if (decision === 'reject') {
        if (!keys.length)
          throw new HrError('APPLICATION_REJECT_KEYS_REQUIRED', 400);
        const known = new Set(a.posting.requirements.map((r) => r.key));
        if (keys.some((k) => !known.has(k)))
          throw new HrError('APPLICATION_REJECT_KEYS_INVALID', 400);
      }
      const now = new Date();
      await database
        .query()
        .updateTable('applications')
        .set({
          screeningDecision: decision,
          decidedBy: actor.userId,
          decidedAt: now,
          rejectRequirementKeys: decision === 'reject' ? keys : null,
          rejectNote:
            decision === 'reject' ? (parsed.data.rejectNote ?? null) : null,
          updatedAt: now,
        })
        .where('id', '=', applicationId)
        .execute();
      if (decision === 'reject')
        await stamp(applicationId, application.stage, 'rejected', actor.userId);
      else if (decision === 'advance' && application.stage === 'applied')
        await stamp(applicationId, 'applied', 'screening', actor.userId);
      // 初筛建议一致率: the suggestion's run item is closed by the decision.
      const suggestion = application.screeningSuggestion;
      if (suggestion)
        await database
          .query()
          .updateTable('aiTaskRunItems')
          .set({
            outcome: agrees(suggestion.matchLevel, decision)
              ? 'adopted'
              : 'discarded',
            outcomeByUserId: actor.userId,
            outcomeAt: now,
            updatedAt: now,
          })
          .where('entityType', '=', 'screeningSuggestion')
          .where('entityId', '=', applicationId)
          .where('outcome', '=', 'pending')
          .execute()
          .catch(() => undefined);
      return service.detail(actor, applicationId);
    },

    /** Moves an application along by hand (withdrawn, back to screening). */
    async setStage(actor: ActorContext, applicationId: string, stage: string) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'manage');
      const application = await applicationRow(applicationId);
      if (!(await access(actor, application)).recruiter)
        throw new HrError('APPLICATION_NOT_FOUND', 404);
      if (!['withdrawn', 'screening', 'applied'].includes(stage))
        throw new HrError('APPLICATION_STAGE_INVALID', 400);
      if (['hired', 'offer'].includes(application.stage))
        throw new HrError('APPLICATION_STAGE_INVALID', 409);
      await stamp(
        applicationId,
        application.stage,
        stage as Stage,
        actor.userId,
      );
      return service.detail(actor, applicationId);
    },

    /** 人才库: every consented, non-anonymized candidate, read-only, without contact data. */
    async pool(actor: ActorContext, query: Record<string, string | undefined>) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'manage');
      const today = platform.currentDate();
      const rows = await database
        .query()
        .selectFrom('candidates')
        .select([
          'id',
          'name',
          'parsedProfile',
          'sourceChannel',
          'retentionUntil',
          'lastActivityAt',
        ])
        .where('anonymizedAt', 'is', null)
        .where('retentionUntil', '>=', today)
        .orderBy('lastActivityAt', 'desc')
        .limit(500)
        .execute();
      const search = (query.search ?? '').trim();
      return {
        items: rows
          .map((r) => ({
            id: str(r.id),
            name: str(r.name),
            profile: json<ParsedProfile | null>(r.parsedProfile, null),
            sourceChannel: str(r.sourceChannel),
            retentionUntil: day(r.retentionUntil),
            lastActivityAt: iso(r.lastActivityAt),
          }))
          .filter(
            (r) =>
              !search ||
              r.name.includes(search) ||
              JSON.stringify(r.profile ?? {}).includes(search),
          ),
      };
    },

    /** Adds a pool candidate to a posting the recruiter runs, as a new application (consent is still valid). */
    async addFromPool(
      actor: ActorContext,
      candidateId: string,
      postingId: string,
    ) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'manage');
      const posting = await deps.postings.get(postingId);
      const requisition = await deps.requisitions.get(posting.requisitionId);
      if (requisition.recruiterUserId !== actor.userId)
        throw new HrError('POSTING_NOT_FOUND', 404);
      const candidate = await candidateRow(candidateId);
      if (
        candidate.anonymizedAt ||
        (candidate.retentionUntil ?? '') < platform.currentDate()
      )
        throw new HrError('CANDIDATE_CONSENT_EXPIRED', 409);
      const outcome = await service.intake({
        posting,
        name: candidate.name,
        phone: candidate.phone,
        email: candidate.email,
        file: null,
        sourceChannel: 'pool',
        consentBy: 'recruiter',
        knockoutAnswers: [],
        customFields: {},
        by: actor.userId,
      });
      return { applicationId: outcome.applicationId, created: outcome.created };
    },

    // ---------- 对外消息 ----------

    /** Stores a draft message on the application; nothing is sent until the recruiter confirms. */
    async addDraftMessage(
      applicationId: string,
      message: Omit<CandidateMessage, 'id' | 'status' | 'createdAt'>,
    ) {
      const application = await applicationRow(applicationId);
      const id = newId();
      const next: CandidateMessage = {
        ...message,
        id,
        status: 'draft',
        createdAt: new Date().toISOString(),
      };
      await database
        .query()
        .updateTable('applications')
        .set({
          messages: [
            // An older unsent draft of the same kind is replaced.
            ...application.messages.filter(
              (m) =>
                !(
                  m.status === 'draft' &&
                  m.type === message.type &&
                  (m.interviewId ?? null) === (message.interviewId ?? null)
                ),
            ),
            next,
          ],
          updatedAt: new Date(),
        })
        .where('id', '=', applicationId)
        .execute();
      return next;
    },

    async editMessage(
      actor: ActorContext,
      applicationId: string,
      messageId: string,
      input: unknown,
    ) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'manage');
      const application = await applicationRow(applicationId);
      if (!(await access(actor, application)).recruiter)
        throw new HrError('APPLICATION_NOT_FOUND', 404);
      const parsed = z
        .object({
          subject: z.string().trim().min(1).max(200),
          body: z.string().trim().min(1).max(8000),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const messages = application.messages.map((m) =>
        m.id === messageId && m.status === 'draft'
          ? { ...m, ...parsed.data, draftedBy: 'recruiter' as const }
          : m,
      );
      await database
        .query()
        .updateTable('applications')
        .set({ messages, updatedAt: new Date() })
        .where('id', '=', applicationId)
        .execute();
      return service.detail(actor, applicationId);
    },

    /** 招聘负责人确认后发送: the only way a drafted message reaches the candidate. */
    async sendMessage(
      actor: ActorContext,
      applicationId: string,
      messageId: string,
    ) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'manage');
      const application = await applicationRow(applicationId);
      const a = await access(actor, application);
      if (!a.recruiter) throw new HrError('APPLICATION_NOT_FOUND', 404);
      const message = application.messages.find((m) => m.id === messageId);
      if (!message || message.status !== 'draft')
        throw new HrError('MESSAGE_NOT_DRAFT', 409);
      const candidate = await candidateRow(application.candidateId);
      if (!candidate.email) throw new HrError('CANDIDATE_EMAIL_MISSING', 409);
      const delivery = await ctx.sendEmail({
        key: `message:${messageId}`,
        applicationId,
        to: candidate.email,
        subject: message.subject,
        body: message.body,
      });
      const now = new Date().toISOString();
      const messages = application.messages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              status: 'sent' as const,
              sentAt: now,
              sentBy: actor.userId,
              delivery,
            }
          : m,
      );
      await database
        .query()
        .updateTable('applications')
        .set({ messages, updatedAt: new Date() })
        .where('id', '=', applicationId)
        .execute();
      ctx.audit({
        event: 'recruiting.messageSent',
        applicationId,
        type: message.type,
        by: actor.userId,
        delivery,
      });
      return service.detail(actor, applicationId);
    },

    async discardMessage(
      actor: ActorContext,
      applicationId: string,
      messageId: string,
    ) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'manage');
      const application = await applicationRow(applicationId);
      if (!(await access(actor, application)).recruiter)
        throw new HrError('APPLICATION_NOT_FOUND', 404);
      await database
        .query()
        .updateTable('applications')
        .set({
          messages: application.messages.map((m) =>
            m.id === messageId && m.status === 'draft'
              ? { ...m, status: 'discarded' as const }
              : m,
          ),
          updatedAt: new Date(),
        })
        .where('id', '=', applicationId)
        .execute();
      return service.detail(actor, applicationId);
    },

    // ---------- 匿名化 ----------

    /** 候选人申请删除: the recruiter anonymizes; the record keeps what statistics need. */
    async anonymize(actor: ActorContext, candidateId: string) {
      await authorizeAction(actor.authz, COMPOSITE.candidate, 'anonymize');
      const candidate = await candidateRow(candidateId);
      if (candidate.anonymizedAt) return { id: candidateId, anonymized: true };
      await service.anonymizeTrusted(candidateId, actor.userId);
      ctx.audit({
        event: 'recruiting.anonymize',
        candidateId,
        by: actor.userId,
      });
      return { id: candidateId, anonymized: true };
    },

    async anonymizeTrusted(candidateId: string, by: string) {
      const candidate = await candidateRow(candidateId);
      if (candidate.anonymizedAt) return false;
      if (candidate.resumeFileId) await ctx.removeFile(candidate.resumeFileId);
      const now = new Date();
      await database
        .query()
        .updateTable('candidates')
        .set({
          name: '已匿名',
          phone: null,
          email: null,
          resumeFileId: null,
          parsedProfile: null,
          parseConfidence: null,
          parseStatus: 'none',
          customFields: null,
          anonymizedAt: now,
          anonymizedBy: by,
          // The deletion link stops working; deletionRequestedAt stays as the record of the request.
          deletionTokenHash: null,
          updatedAt: now,
        })
        .where('id', '=', candidateId)
        .execute();
      const applications = await database
        .query()
        .selectFrom('applications')
        .select(['id', 'screeningSuggestion'])
        .where('candidateId', '=', candidateId)
        .execute();
      for (const application of applications) {
        const suggestion = json<ScreeningSuggestion | null>(
          application.screeningSuggestion,
          null,
        );
        await database
          .query()
          .updateTable('applications')
          .set({
            messages: [],
            knockoutAnswers: null,
            rejectNote: null,
            bookingTokenHash: null,
            aiInterviewTokenHash: null,
            // Only the level stays, for the agreement rate.
            screeningSuggestion: suggestion
              ? {
                  matchLevel: suggestion.matchLevel,
                  met: [],
                  missing: [],
                  toVerify: [],
                  reasons: [],
                }
              : null,
            updatedAt: now,
          })
          .where('id', '=', str(application.id))
          .execute();
        await database
          .query()
          .updateTable('interviews')
          .set({
            transcript: null,
            aiReport: null,
            questionPlan: null,
            updatedAt: now,
          })
          .where('applicationId', '=', str(application.id))
          .execute();
      }
      return true;
    },

    /** 每天 09:00: candidates past retentionUntil are anonymized. */
    async anonymizeExpired(asOf: string, owner: string) {
      const rows = await database
        .query()
        .selectFrom('candidates')
        .select(['id'])
        .where('anonymizedAt', 'is', null)
        .where('retentionUntil', '<', asOf)
        .execute();
      let count = 0;
      for (const r of rows)
        if (await service.anonymizeTrusted(str(r.id), owner)) count += 1;
      return count;
    },

    /** V2-07 删除申请: a link for the resume receipt; a new one replaces the previous one. */
    async issueDeletionToken(candidateId: string) {
      const { token, hash } = newToken();
      await database
        .query()
        .updateTable('candidates')
        .set({ deletionTokenHash: hash, updatedAt: new Date() })
        .where('id', '=', candidateId)
        .where('anonymizedAt', 'is', null)
        .execute();
      return token;
    },

    /** A booking link for the candidate (self-booking reschedule / cancel). */
    async issueBookingToken(applicationId: string) {
      const { token, hash } = newToken();
      await database
        .query()
        .updateTable('applications')
        .set({ bookingTokenHash: hash, updatedAt: new Date() })
        .where('id', '=', applicationId)
        .execute();
      return token;
    },

    /** Applications waiting in a stage longer than the setting, for the daily reminder. */
    async stale(asOf: string, days: number) {
      const cutoff = new Date(`${addDays(asOf, -days)}T23:59:59+08:00`);
      const rows = await database
        .query()
        .selectFrom('applications')
        .innerJoin('jobPostings', 'jobPostings.id', 'applications.postingId')
        .innerJoin(
          'jobRequisitions',
          'jobRequisitions.id',
          'jobPostings.requisitionId',
        )
        .select([
          'applications.id as id',
          'applications.stage as stage',
          'jobRequisitions.recruiterUserId as recruiterUserId',
          'applications.stageSince as stageSince',
        ])
        .where('applications.stage', 'in', ['applied', 'screening'])
        .execute();
      // Compared as instants (SQLite keeps datetimes as text).
      return rows
        .filter((r) => new Date(str(r.stageSince)).getTime() < cutoff.getTime())
        .map((r) => ({
          id: str(r.id),
          stage: str(r.stage),
          recruiterUserId: r.recruiterUserId ? str(r.recruiterUserId) : null,
        }));
    },
  };
  return service;
}

/** 初筛建议与决定一致: high ↔ advance, low ↔ reject, medium ↔ hold or advance. */
export function agrees(
  level: ScreeningSuggestion['matchLevel'],
  decision: 'advance' | 'hold' | 'reject',
): boolean {
  if (level === 'high') return decision === 'advance';
  if (level === 'low') return decision === 'reject';
  return decision !== 'reject';
}

export type CandidateService = ReturnType<typeof createCandidateService>;
export type { RequisitionView, Requirement };
