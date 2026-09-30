/**
 * The question bank, exams, candidates' attempts and grading.
 *
 * Answers never leave the server for a candidate: an attempt stores a paper
 * snapshot without them, and results reveal them only as the exam's
 * `showAnswersAfter` allows. The deadline is the server's `deadlineAt`; a
 * minute job submits attempts left open past it with the answers saved so far.
 */
import type { DatabaseConnection } from '@nocobase/db';
import * as XLSX from 'xlsx';

import {
  authorizeAction,
  policyOf,
  tryAuthorizeAction,
  type CollectionPolicies,
} from './authorize.js';
import { recordDraftOutcome } from './draft-snapshots.js';
import type { ActorContext } from './framework-service.js';
import type { LearningService } from './learning-service.js';
import { bool, json, type EmployeeSummary, type Platform } from './platform.js';
import {
  HrError,
  isRecord,
  newId,
  requireEnum,
  requireString,
  str,
} from './shared.js';

export const QUESTION_TYPES = [
  'single',
  'multiple',
  'judge',
  'blank',
  'short',
] as const;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

const QUESTION = 'talent.question';
const EXAM = 'talent.exam';
const TAKING = 'talent.examTaking';
const WRITER = 'talent.contentWriter';
/** Answers sent this long after the deadline still count; later ones are refused. */
const SUBMIT_GRACE_MS = 15_000;

export interface QuestionOption {
  readonly key: string;
  readonly text: string;
}

export interface QuestionView {
  readonly id: string;
  readonly type: QuestionType;
  readonly stem: string;
  readonly options: readonly QuestionOption[];
  readonly answer: unknown;
  readonly explanation: string | null;
  readonly gradingNotes: string | null;
  readonly difficulty: string;
  readonly sourceDocumentId: string | null;
  readonly sourceDocumentTitle: string | null;
  readonly sourceCourseId: string | null;
  readonly sourceCourseTitle: string | null;
  readonly sourceExcerpt: string | null;
  /** The points the question carries by default when added to a paper. */
  readonly score: number;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly source: string;
  readonly reviewStatus: string;
  readonly active: boolean;
  readonly competencies: readonly { id: string; title: string }[];
  readonly usedInExams: number;
}

export interface RandomRule {
  readonly competencyId?: string | null;
  readonly questionType: QuestionType;
  readonly difficulty?: string | null;
  readonly count: number;
  readonly scoreEach: number;
}

export interface ExamSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly paperMode: 'fixed' | 'random';
  readonly questionCount: number;
  readonly totalScore: number;
  readonly durationMinutes: number;
  readonly maxAttempts: number;
  readonly passScore: number;
  readonly showAnswersAfter: string;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly published: boolean;
  readonly active: boolean;
  readonly candidates: number;
  readonly passRate: number | null;
  readonly grading: number;
  /** V3-10 防作弊 settings with their defaults applied. */
  readonly antiCheat: AntiCheat;
  /** Whether the examiner suggests scores for short answers before an instructor grades them. */
  readonly aiGrading: boolean;
  /** Examiner suggestions compared with the final scores: how many were within one point. */
  readonly aiAgreement: {
    compared: number;
    withinOne: number;
    rate: number | null;
  };
  /** Submitted attempts with integrity flags nobody has reviewed yet. */
  readonly flagged: number;
}

export interface AntiCheat {
  readonly shuffleOptions: boolean;
  readonly disableCopy: boolean;
  readonly maxBlurCount: number;
  readonly blurAction: 'flag' | 'submit';
  readonly singleDevice: boolean;
}

export const DEFAULT_ANTI_CHEAT: AntiCheat = {
  shuffleOptions: true,
  disableCopy: true,
  maxBlurCount: 3,
  blurAction: 'flag',
  singleDevice: true,
};

export interface IntegrityFlag {
  readonly type: 'blur' | 'multiDevice' | 'pasteAttempt';
  readonly at: string;
  readonly detail: string | null;
}

/** The examiner's suggestion for one short answer; it never takes effect by itself. */
export interface GradingSuggestion {
  readonly score: number;
  readonly matchedPoints: readonly string[];
  readonly missingPoints: readonly string[];
  readonly rationale: string;
  readonly at: string;
}

export interface LossByCompetency {
  readonly competencyId: string;
  readonly lost: number;
  readonly total: number;
}

export interface ExamDetail extends ExamSummary {
  readonly questions: readonly {
    questionId: string;
    score: number;
    sortOrder: number;
    question: QuestionView | null;
  }[];
  readonly randomRules: readonly (RandomRule & { available: number })[];
  readonly can: {
    manage: boolean;
    publish: boolean;
    grade: boolean;
    resetAttempts: boolean;
    reviewIntegrity: boolean;
    voidAttempt: boolean;
  };
}

export interface PaperItem {
  readonly questionId: string;
  readonly type: QuestionType;
  readonly stem: string;
  readonly options: readonly QuestionOption[];
  readonly blankCount: number;
  readonly score: number;
  readonly competencyIds: readonly string[];
}

export interface AttemptView {
  readonly id: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly attemptNo: number;
  readonly status: string;
  readonly startedAt: string;
  readonly deadlineAt: string;
  readonly serverNow: string;
  readonly submittedAt: string | null;
  readonly items: readonly PaperItem[];
  readonly answers: Record<string, unknown>;
  /** What the answering page enforces; the server enforces the device and the blur limit. */
  readonly antiCheat: Omit<AntiCheat, 'shuffleOptions'>;
  readonly blurCount: number;
  /** Issued when this device started or took over the attempt; the client sends it back in `x-exam-device`. */
  readonly deviceToken: string | null;
}

export interface AttemptResult {
  readonly id: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly employeeName: string;
  readonly attemptNo: number;
  readonly status: string;
  readonly score: number | null;
  readonly passScore: number;
  readonly submittedAt: string | null;
  readonly answersVisible: boolean;
  readonly items: readonly {
    questionId: string;
    type: QuestionType;
    stem: string;
    options: readonly QuestionOption[];
    score: number;
    earned: number | null;
    correct: boolean | null;
    response: unknown;
    answer?: unknown;
    explanation?: string | null;
    gradingNotes?: string | null;
    comment?: string | null;
    /** Graders only: the examiner's suggestion for a short answer. */
    aiSuggestion?: GradingSuggestion | null;
  }[];
  /** Points lost per competency, once the attempt is scored. */
  readonly lossByCompetency: readonly (LossByCompetency & { title: string })[];
  readonly integrity: {
    blurCount: number;
    flags: readonly IntegrityFlag[];
    review: string | null;
    voidReason: string | null;
  } | null;
  readonly wrongByCompetency: readonly {
    competencyId: string;
    title: string;
    wrong: number;
    total: number;
    courses: { id: string; title: string }[];
  }[];
}

export interface MyExam {
  readonly examId: string;
  readonly title: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly passScore: number;
  readonly maxAttempts: number;
  readonly attemptsUsed: number;
  readonly remainingAttempts: number;
  readonly bestScore: number | null;
  /** todo | grading | passed | failed */
  readonly bucket: string;
  readonly inProgressAttemptId: string | null;
  readonly latestAttemptId: string | null;
  readonly dueDate: string | null;
  readonly sources: readonly ('assignment' | 'certification')[];
}

export interface ExamService {
  listQuestions(
    ctx: ActorContext,
    filters: {
      type?: string;
      competencyId?: string;
      difficulty?: string;
      status?: string;
      q?: string;
      sourceDocumentId?: string;
      sourceCourseId?: string;
      /** `mine`: drafts the caller owns and should review ("待我审核"). */
      review?: string;
    },
  ): Promise<{
    items: QuestionView[];
    can: { manage: boolean; confirm: boolean; import: boolean };
  }>;
  saveQuestion(
    ctx: ActorContext,
    id: string | null,
    input: unknown,
  ): Promise<QuestionView>;
  bulkQuestions(
    ctx: ActorContext,
    input: unknown,
  ): Promise<{
    changed: number;
    skipped: readonly { id: string; reason: string }[];
  }>;
  importTemplate(): Buffer;
  importQuestions(
    ctx: ActorContext,
    file: Uint8Array,
  ): Promise<{ created: number }>;
  /** For the content writer: summaries of existing questions to avoid duplicates. */
  questionSummaries(
    ctx: ActorContext,
    input: {
      sourceDocumentId?: string;
      competencyId?: string;
      sourceCourseId?: string;
    },
  ): Promise<
    { id: string; type: string; stem: string; reviewStatus: string }[]
  >;
  createQuestionDrafts(
    ctx: ActorContext,
    input: unknown,
    /** An automation writes the drafts for the course's instructor rather than for itself. */
    options?: { ownerUserId?: string },
  ): Promise<{ created: number; skipped: number; ids: string[] }>;

  listExams(ctx: ActorContext): Promise<{
    items: ExamSummary[];
    canCreate: boolean;
    /** V3-10: may adjust the exam → competency rule. */
    canConfigure: boolean;
  }>;
  getExam(ctx: ActorContext, id: string): Promise<ExamDetail | undefined>;
  saveExam(
    ctx: ActorContext,
    id: string | null,
    input: unknown,
  ): Promise<ExamDetail>;
  publishExam(
    ctx: ActorContext,
    id: string,
    published: boolean,
  ): Promise<ExamDetail>;
  previewPaper(
    ctx: ActorContext,
    id: string,
  ): Promise<{
    items: (PaperItem & { answer: unknown })[];
    totalScore: number;
  }>;
  ruleAvailability(ctx: ActorContext, rules: unknown): Promise<number[]>;

  myExams(ctx: ActorContext): Promise<MyExam[]>;
  /** `deviceToken`: the token this device holds for the attempt, from the `x-exam-device` header. */
  startAttempt(
    ctx: ActorContext,
    examId: string,
    deviceToken?: string | null,
    /** V4-13: the candidate's language (the request's Accept-Language). */
    locale?: string,
  ): Promise<AttemptView>;
  getAttempt(
    ctx: ActorContext,
    attemptId: string,
    deviceToken?: string | null,
  ): Promise<AttemptView>;
  saveAnswers(
    ctx: ActorContext,
    attemptId: string,
    answers: unknown,
    deviceToken?: string | null,
  ): Promise<{ savedAt: string; deadlineAt: string }>;
  submitAttempt(
    ctx: ActorContext,
    attemptId: string,
    answers: unknown,
    deviceToken?: string | null,
  ): Promise<AttemptResult>;
  attemptResult(ctx: ActorContext, attemptId: string): Promise<AttemptResult>;

  listGrading(ctx: ActorContext, examId?: string): Promise<AttemptResult[]>;
  gradeAttempt(
    ctx: ActorContext,
    attemptId: string,
    input: unknown,
  ): Promise<AttemptResult>;
  resetAttempts(
    ctx: ActorContext,
    examId: string,
    employeeId: string,
  ): Promise<{ reset: number }>;
  /** Candidates of one exam with their counted attempts, best score and latest state. */
  examCandidates(
    ctx: ActorContext,
    examId: string,
  ): Promise<
    {
      employeeId: string;
      name: string;
      attempts: number;
      bestScore: number | null;
      status: string;
      latestAttemptId: string;
    }[]
  >;
  autoSubmitExpired(): Promise<number>;

  // ---------- V3-10 10B ----------
  /** The answering page reports a blur or a blocked paste; past the limit the attempt may be submitted. */
  recordIntegrity(
    ctx: ActorContext,
    attemptId: string,
    input: unknown,
    deviceToken?: string | null,
  ): Promise<{ blurCount: number; maxBlurCount: number; submitted: boolean }>;
  /** 异常答卷: submitted attempts with integrity flags, for the exam's reviewers. */
  listIntegrity(ctx: ActorContext, examId: string): Promise<AttemptResult[]>;
  /** An instructor keeps a flagged attempt (valid) or voids it with a reason; optionally resets the attempts. */
  reviewIntegrity(
    ctx: ActorContext,
    attemptId: string,
    input: unknown,
  ): Promise<AttemptResult>;
  /** 考官: the short answers of an attempt with reference answers and grading points, for a grader. */
  gradingMaterial(
    ctx: ActorContext,
    attemptId: string,
  ): Promise<{
    attemptId: string;
    examTitle: string;
    status: string;
    items: {
      questionId: string;
      stem: string;
      score: number;
      referenceAnswer: string;
      gradingPoints: string | null;
      response: string;
      aiSuggestion: GradingSuggestion | null;
    }[];
  }>;
  /** Writes the examiner's suggestion; never changes the attempt's status or score, and never overwrites one. */
  saveGradingSuggestion(
    ctx: ActorContext,
    attemptId: string,
    input: unknown,
  ): Promise<{ saved: boolean }>;
  /** The candidate's own result for the examiner to explain: answers only as `showAnswersAfter` allows. */
  explainResult(ctx: ActorContext, attemptId: string): Promise<AttemptResult>;
}

export interface ExamServiceDeps {
  readonly platform: Platform;
  readonly learning: LearningService;
  readonly examCompetency: () => {
    minWeight: number;
    fullRate: number;
    partialRate: number;
  };
  /** Step 3 issues certificates when requirements are met. */
  readonly onExamPassed?: () =>
    ((employeeId: string, examId: string) => Promise<void>) | undefined;
  /** A renewal exam ran out of attempts without a pass; the certification steward assigns remedial learning. */
  readonly onRecertificationExhausted?: () =>
    ((attemptId: string) => void) | undefined;
  /** V3-10: the administrator-adjusted exam → competency rule; falls back to `examCompetency`. */
  readonly examRules?: () => Promise<{
    minWeight: number;
    fullRate: number;
    partialRate: number;
  }>;
  /**
   * V3-10: an attempt with short answers was submitted on an exam with AI
   * grading. The examiner suggests scores and the instructor is told once the
   * suggestions exist. Returning false means the examiner is not running, and
   * the instructor is told at once.
   */
  readonly onGradingRequested?: () =>
    ((attemptId: string) => boolean) | undefined;
  /** V3-10: a non-renewal attempt failed; the learning coach drafts a remedial plan. */
  readonly onExamFailed?: () => ((attemptId: string) => void) | undefined;
  /** V4-13: the confirmed translations (stem, options) of original questions in a language. */
  readonly translatedQuestions?: (
    ids: readonly string[],
    locale: string,
  ) => Promise<Map<string, { stem: string; options: QuestionOption[] }>>;
}

// ---------- Helpers ----------

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(str(value)).toISOString();
}
function stringIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== 'string' || !v || v.length > 64)
  )
    throw new HrError('INVALID_INPUT', 400);
  return [...new Set(value as string[])];
}
function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
/** Blank answers match ignoring surrounding spaces, full- and half-width forms, and letter case. */
export function normalizeBlank(value: unknown): string {
  return str(value ?? '')
    .replace(/[！-～]/gu, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/\u3000/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

/** Validates a question's answer against its type and options. */
export function parseAnswer(
  type: QuestionType,
  answer: unknown,
  options: readonly QuestionOption[],
): unknown {
  const keys = new Set(options.map((o) => o.key));
  switch (type) {
    case 'single':
      if (typeof answer !== 'string' || !keys.has(answer))
        throw new HrError('QUESTION_ANSWER_INVALID', 400);
      return answer;
    case 'multiple': {
      if (
        !Array.isArray(answer) ||
        answer.length < 2 ||
        answer.some((a) => typeof a !== 'string' || !keys.has(a))
      )
        throw new HrError('QUESTION_ANSWER_INVALID', 400);
      return [...new Set(answer as string[])].sort();
    }
    case 'judge':
      if (typeof answer !== 'boolean')
        throw new HrError('QUESTION_ANSWER_INVALID', 400);
      return answer;
    case 'blank': {
      if (!Array.isArray(answer) || !answer.length || answer.length > 10)
        throw new HrError('QUESTION_ANSWER_INVALID', 400);
      return answer.map((blank) => {
        const alternatives = Array.isArray(blank) ? blank : [blank];
        const clean = alternatives
          .map((a) => String(a ?? '').trim())
          .filter(Boolean);
        if (!clean.length) throw new HrError('QUESTION_ANSWER_INVALID', 400);
        return clean;
      });
    }
    case 'short':
      if (typeof answer !== 'string' || !answer.trim())
        throw new HrError('QUESTION_ANSWER_INVALID', 400);
      return answer.trim();
  }
}

/** Scores one objective item; `null` for a short answer, which a person grades. */
export function scoreItem(
  type: QuestionType,
  answer: unknown,
  response: unknown,
  score: number,
): { earned: number | null; correct: boolean | null } {
  switch (type) {
    case 'single': {
      const correct = typeof response === 'string' && response === answer;
      return { earned: correct ? score : 0, correct };
    }
    case 'multiple': {
      // All correct options and nothing else, or nothing.
      const expected = [...(answer as string[])].sort().join('|');
      const given = Array.isArray(response)
        ? [...new Set(response.map(String))].sort().join('|')
        : '';
      const correct = expected === given;
      return { earned: correct ? score : 0, correct };
    }
    case 'judge': {
      const correct = typeof response === 'boolean' && response === answer;
      return { earned: correct ? score : 0, correct };
    }
    case 'blank': {
      const blanks = answer as string[][];
      const given = Array.isArray(response) ? response : [];
      let right = 0;
      blanks.forEach((alternatives, index) => {
        const value = normalizeBlank(given[index]);
        if (value && alternatives.some((a) => normalizeBlank(a) === value))
          right += 1;
      });
      const earned = Math.round(((score * right) / blanks.length) * 100) / 100;
      return { earned, correct: right === blanks.length };
    }
    case 'short':
      return { earned: null, correct: null };
  }
}

function parseOptions(value: unknown, type: QuestionType): QuestionOption[] {
  if (type !== 'single' && type !== 'multiple') return [];
  if (!Array.isArray(value) || value.length < 2 || value.length > 8)
    throw new HrError('QUESTION_OPTIONS_INVALID', 400);
  const seen = new Set<string>();
  return value.map((item, index) => {
    const key =
      isRecord(item) && typeof item.key === 'string' && item.key.trim()
        ? item.key.trim().toUpperCase()
        : String.fromCharCode(65 + index);
    const text: unknown = isRecord(item) ? item.text : item;
    if (typeof text !== 'string' || !text.trim() || seen.has(key))
      throw new HrError('QUESTION_OPTIONS_INVALID', 400);
    seen.add(key);
    return { key, text: text.trim() };
  });
}

/** An exam's anti-cheating settings with the defaults applied to anything not stored. */
export function resolveAntiCheat(value: unknown): AntiCheat {
  const stored = json<Record<string, unknown>>(value, {});
  const flag = (key: keyof AntiCheat) =>
    typeof stored[key] === 'boolean'
      ? stored[key]
      : (DEFAULT_ANTI_CHEAT[key] as boolean);
  const max = Number(stored.maxBlurCount);
  return {
    shuffleOptions: flag('shuffleOptions'),
    disableCopy: flag('disableCopy'),
    maxBlurCount:
      Number.isInteger(max) && max >= 0 && max <= 100
        ? max
        : DEFAULT_ANTI_CHEAT.maxBlurCount,
    blurAction: stored.blurAction === 'submit' ? 'submit' : 'flag',
    singleDevice: flag('singleDevice'),
  };
}

function parseAntiCheat(value: unknown): AntiCheat {
  if (value === undefined || value === null) return DEFAULT_ANTI_CHEAT;
  if (!isRecord(value)) throw new HrError('EXAM_ANTI_CHEAT_INVALID', 400);
  for (const key of ['shuffleOptions', 'disableCopy', 'singleDevice'])
    if (value[key] !== undefined && typeof value[key] !== 'boolean')
      throw new HrError('EXAM_ANTI_CHEAT_INVALID', 400);
  if (
    value.maxBlurCount !== undefined &&
    (!Number.isInteger(value.maxBlurCount) ||
      Number(value.maxBlurCount) < 0 ||
      Number(value.maxBlurCount) > 100)
  )
    throw new HrError('EXAM_ANTI_CHEAT_INVALID', 400);
  if (
    value.blurAction !== undefined &&
    value.blurAction !== 'flag' &&
    value.blurAction !== 'submit'
  )
    throw new HrError('EXAM_ANTI_CHEAT_INVALID', 400);
  return resolveAntiCheat(value);
}

/** Points lost per competency: every competency a question carries takes its whole score. */
export function computeLoss(
  items: readonly PaperItem[],
  results: Readonly<Record<string, { score: number | null }>>,
): LossByCompetency[] {
  const totals = new Map<string, { lost: number; total: number }>();
  for (const item of items)
    for (const competencyId of item.competencyIds) {
      const entry = totals.get(competencyId) ?? { lost: 0, total: 0 };
      entry.total += item.score;
      entry.lost += item.score - Number(results[item.questionId]?.score ?? 0);
      totals.set(competencyId, entry);
    }
  return [...totals.entries()]
    .map(([competencyId, t]) => ({
      competencyId,
      lost: Math.round(t.lost * 100) / 100,
      total: t.total,
    }))
    .sort((a, b) => b.lost - a.lost);
}

/** Whether an attempt's flags need an instructor: too many blurs, another device, or a blocked paste. */
export function isFlagged(
  flags: readonly IntegrityFlag[],
  blurCount: number,
  antiCheat: AntiCheat,
): boolean {
  return (
    blurCount > antiCheat.maxBlurCount ||
    flags.some((f) => f.type === 'multiDevice' || f.type === 'pasteAttempt')
  );
}

// ---------- Service ----------

export function createExamService(deps: ExamServiceDeps): ExamService {
  const { platform, learning } = deps;
  const { database, notify } = platform;

  interface QuestionInput {
    type: QuestionType;
    stem: string;
    options: QuestionOption[];
    answer: unknown;
    explanation: string | null;
    gradingNotes: string | null;
    difficulty: string;
    sourceDocumentId: string | null;
    sourceCourseId: string | null;
    sourceExcerpt: string | null;
    score: number;
    competencyIds: string[];
  }

  function parseQuestion(
    input: unknown,
    options: { requireExcerpt?: boolean } = {},
  ): QuestionInput {
    if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
    const type = requireEnum(
      input.type,
      QUESTION_TYPES,
      'QUESTION_TYPE_INVALID',
    );
    const questionOptions = parseOptions(input.options, type);
    return {
      type,
      stem: requireString(input.stem, 'QUESTION_STEM_REQUIRED', { max: 4000 })!,
      options: questionOptions,
      answer: parseAnswer(type, input.answer, questionOptions),
      explanation: requireString(input.explanation, 'INVALID_INPUT', {
        optional: true,
        max: 4000,
      }),
      gradingNotes: requireString(input.gradingNotes, 'INVALID_INPUT', {
        optional: true,
        max: 4000,
      }),
      difficulty: requireEnum(
        input.difficulty ?? 'medium',
        DIFFICULTIES,
        'QUESTION_DIFFICULTY_INVALID',
      ),
      sourceDocumentId: requireString(input.sourceDocumentId, 'INVALID_INPUT', {
        optional: true,
        max: 64,
      }),
      sourceCourseId: requireString(input.sourceCourseId, 'INVALID_INPUT', {
        optional: true,
        max: 64,
      }),
      score: (() => {
        if (input.score === undefined || input.score === null) return 10;
        const score = Number(input.score);
        if (!Number.isInteger(score) || score < 1 || score > 100)
          throw new HrError('QUESTION_SCORE_INVALID', 400);
        return score;
      })(),
      sourceExcerpt: requireString(
        input.sourceExcerpt,
        'QUESTION_SOURCE_REQUIRED',
        { optional: !options.requireExcerpt, max: 4000 },
      ),
      competencyIds: stringIds(input.competencyIds),
    };
  }

  async function assertCompetencies(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const rows = await database
      .query()
      .selectFrom('competencies')
      .select(['id'])
      .where('id', 'in', [...ids])
      .execute();
    if (rows.length !== ids.length)
      throw new HrError('COMPETENCY_NOT_FOUND', 404);
  }

  async function toQuestionViews(
    rows: readonly Record<string, unknown>[],
  ): Promise<QuestionView[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => String(r.id));
    const query = database.query();
    const tags = await query
      .selectFrom('questionCompetencies')
      .select(['questionId', 'competencyId'])
      .where('questionId', 'in', ids)
      .execute();
    const competencyIds = [...new Set(tags.map((t) => String(t.competencyId)))];
    const titles = competencyIds.length
      ? new Map(
          (
            await query
              .selectFrom('competencies')
              .select(['id', 'title'])
              .where('id', 'in', competencyIds)
              .execute()
          ).map((r) => [String(r.id), String(r.title)]),
        )
      : new Map<string, string>();
    const documentIds = [
      ...new Set(
        rows
          .map((r) => r.sourceDocumentId)
          .filter(Boolean)
          .map(String),
      ),
    ];
    const documents = documentIds.length
      ? new Map(
          (
            await query
              .selectFrom('kbDocuments')
              .select(['id', 'title'])
              .where('id', 'in', documentIds)
              .execute()
          ).map((r) => [String(r.id), String(r.title)]),
        )
      : new Map<string, string>();
    const courseIds = [
      ...new Set(
        rows
          .map((r) => r.sourceCourseId)
          .filter(Boolean)
          .map(String),
      ),
    ];
    const courses = courseIds.length
      ? new Map(
          (
            await query
              .selectFrom('courses')
              .select(['id', 'title'])
              .where('id', 'in', courseIds)
              .execute()
          ).map((r) => [String(r.id), String(r.title)]),
        )
      : new Map<string, string>();
    const usage = await query
      .selectFrom('examQuestions')
      .select(['questionId'])
      .where('questionId', 'in', ids)
      .execute();
    const result: QuestionView[] = [];
    for (const row of rows) {
      const id = String(row.id);
      result.push({
        id,
        type: String(row.type) as QuestionType,
        stem: String(row.stem),
        options: json<QuestionOption[]>(row.options, []),
        answer: json<unknown>(row.answer, null),
        explanation: row.explanation == null ? null : str(row.explanation),
        gradingNotes: row.gradingNotes == null ? null : str(row.gradingNotes),
        difficulty: String(row.difficulty),
        sourceDocumentId:
          row.sourceDocumentId == null ? null : str(row.sourceDocumentId),
        sourceDocumentTitle:
          row.sourceDocumentId == null
            ? null
            : (documents.get(str(row.sourceDocumentId)) ?? null),
        sourceCourseId:
          row.sourceCourseId == null ? null : str(row.sourceCourseId),
        sourceCourseTitle:
          row.sourceCourseId == null
            ? null
            : (courses.get(str(row.sourceCourseId)) ?? null),
        sourceExcerpt:
          row.sourceExcerpt == null ? null : str(row.sourceExcerpt),
        score: row.score == null ? 10 : Number(row.score),
        ownerUserId: String(row.ownerUserId),
        ownerName: await platform.userName(String(row.ownerUserId)),
        source: String(row.source),
        reviewStatus: String(row.reviewStatus),
        active: bool(row.active),
        competencies: tags
          .filter((t) => String(t.questionId) === id)
          .map((t) => ({
            id: String(t.competencyId),
            title: titles.get(String(t.competencyId)) ?? String(t.competencyId),
          })),
        usedInExams: usage.filter((u) => String(u.questionId) === id).length,
      });
    }
    return result;
  }

  async function writeQuestion(
    connection: DatabaseConnection,
    policies: CollectionPolicies,
    id: string | null,
    values: QuestionInput,
    extra: Record<string, unknown>,
  ): Promise<string> {
    const repo = connection
      .repository('questions')
      .withPolicy(policyOf(policies, 'questions'));
    const stamp = new Date();
    const row = {
      type: values.type,
      stem: values.stem,
      options: JSON.stringify(values.options),
      answer: JSON.stringify(values.answer),
      explanation: values.explanation,
      gradingNotes: values.gradingNotes,
      difficulty: values.difficulty,
      sourceDocumentId: values.sourceDocumentId,
      sourceCourseId: values.sourceCourseId,
      sourceExcerpt: values.sourceExcerpt,
      score: values.score,
      updatedAt: stamp,
    };
    const questionId = id ?? newId();
    if (id)
      await repo.updateOne({
        filter: { id },
        values: { ...row, ...extra } as never,
      });
    else
      await repo.createOne({
        values: { id: questionId, ...row, createdAt: stamp, ...extra } as never,
      });
    const links = connection
      .repository('questionCompetencies')
      .withPolicy(policyOf(policies, 'questionCompetencies'));
    const existing = (await links.findMany({
      filter: { questionId },
    })) as Record<string, unknown>[];
    const keep = new Set(values.competencyIds);
    for (const link of existing)
      if (!keep.has(String(link.competencyId)))
        await links.deleteOne({ filter: { id: String(link.id) } });
    const present = new Set(existing.map((l) => String(l.competencyId)));
    for (const competencyId of values.competencyIds)
      if (!present.has(competencyId))
        await links.createOne({
          values: {
            id: newId(),
            questionId,
            competencyId,
            createdAt: stamp,
            updatedAt: stamp,
          },
        });
    return questionId;
  }

  async function loadQuestionRows(
    ids: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<Record<string, unknown>[]> {
    if (!ids.length) return [];
    return await (connection ? connection.query : database.query())
      .selectFrom('questions')
      .selectAll()
      .where('id', 'in', [...ids])
      .execute();
  }

  // ---------- Exams ----------

  function parseRules(value: unknown): RandomRule[] {
    if (!Array.isArray(value) || !value.length || value.length > 20)
      throw new HrError('EXAM_RULES_INVALID', 400);
    return value.map((rule) => {
      if (!isRecord(rule)) throw new HrError('EXAM_RULES_INVALID', 400);
      const count = Number(rule.count);
      const scoreEach = Number(rule.scoreEach);
      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 100 ||
        !Number.isFinite(scoreEach) ||
        scoreEach <= 0 ||
        scoreEach > 100
      )
        throw new HrError('EXAM_RULES_INVALID', 400);
      return {
        competencyId: requireString(rule.competencyId, 'EXAM_RULES_INVALID', {
          optional: true,
          max: 64,
        }),
        questionType: requireEnum(
          rule.questionType,
          QUESTION_TYPES,
          'EXAM_RULES_INVALID',
        ),
        difficulty: rule.difficulty
          ? requireEnum(rule.difficulty, DIFFICULTIES, 'EXAM_RULES_INVALID')
          : null,
        count,
        scoreEach,
      };
    });
  }

  async function candidatesFor(
    rule: RandomRule,
    connection?: DatabaseConnection,
  ): Promise<string[]> {
    const query = connection ? connection.query : database.query();
    let builder = query
      .selectFrom('questions')
      .select(['id'])
      .where('type', '=', rule.questionType)
      .where('reviewStatus', '=', 'confirmed')
      .where('active', '=', true)
      // V4-13: a translation is the same question as its original (按 translationOfId 归并).
      .where('translationOfId', 'is', null);
    if (rule.difficulty)
      builder = builder.where('difficulty', '=', rule.difficulty);
    let ids = (await builder.execute()).map((r) => String(r.id));
    if (rule.competencyId && ids.length) {
      const tagged = await query
        .selectFrom('questionCompetencies')
        .select(['questionId'])
        .where('competencyId', '=', rule.competencyId)
        .execute();
      const set = new Set(tagged.map((t) => String(t.questionId)));
      ids = ids.filter((id) => set.has(id));
    }
    return ids;
  }

  async function examRow(
    id: string,
    connection?: DatabaseConnection,
  ): Promise<Record<string, unknown> | undefined> {
    return await (connection ? connection.query : database.query())
      .selectFrom('exams')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async function fixedPaper(
    examId: string,
    connection?: DatabaseConnection,
  ): Promise<{ questionId: string; score: number; sortOrder: number }[]> {
    const rows = await (connection ? connection.query : database.query())
      .selectFrom('examQuestions')
      .select(['questionId', 'score', 'sortOrder'])
      .where('examId', '=', examId)
      .orderBy('sortOrder', 'asc')
      .execute();
    return rows.map((r) => ({
      questionId: String(r.questionId),
      score: Number(r.score),
      sortOrder: Number(r.sortOrder),
    }));
  }

  async function toExamSummaries(
    rows: readonly Record<string, unknown>[],
  ): Promise<ExamSummary[]> {
    const result: ExamSummary[] = [];
    for (const row of rows) {
      const id = String(row.id);
      const mode = String(row.paperMode) as 'fixed' | 'random';
      let questionCount: number;
      let totalScore: number;
      if (mode === 'fixed') {
        const paper = await fixedPaper(id);
        questionCount = paper.length;
        totalScore = paper.reduce((sum, p) => sum + p.score, 0);
      } else {
        const rules = json<RandomRule[]>(row.randomRules, []);
        questionCount = rules.reduce((sum, r) => sum + r.count, 0);
        totalScore = rules.reduce((sum, r) => sum + r.count * r.scoreEach, 0);
      }
      const all = await database
        .query()
        .selectFrom('examAttempts')
        .select([
          'employeeId',
          'status',
          'itemResults',
          'blurCount',
          'integrityFlags',
          'integrityReview',
        ])
        .where('examId', '=', id)
        .execute();
      const attempts = all.filter((a) => a.status !== 'voided');
      const candidates = new Set(attempts.map((a) => String(a.employeeId)));
      const antiCheat = resolveAntiCheat(row.antiCheat);
      // 考官: suggestion against final score, for graded short answers.
      let compared = 0;
      let withinOne = 0;
      for (const attempt of attempts) {
        if (attempt.status !== 'passed' && attempt.status !== 'failed')
          continue;
        for (const result of Object.values(
          json<
            Record<
              string,
              { score?: number | null; aiSuggestion?: { score?: number } }
            >
          >(attempt.itemResults, {}),
        )) {
          if (
            typeof result?.aiSuggestion?.score !== 'number' ||
            typeof result.score !== 'number'
          )
            continue;
          compared += 1;
          if (Math.abs(result.aiSuggestion.score - result.score) <= 1)
            withinOne += 1;
        }
      }
      const flagged = all.filter(
        (a) =>
          a.status !== 'inProgress' &&
          a.integrityReview == null &&
          isFlagged(
            json<IntegrityFlag[]>(a.integrityFlags, []),
            Number(a.blurCount ?? 0),
            antiCheat,
          ),
      ).length;
      const passed = new Set(
        attempts
          .filter((a) => a.status === 'passed')
          .map((a) => String(a.employeeId)),
      );
      result.push({
        id,
        title: String(row.title),
        description: row.description == null ? null : str(row.description),
        paperMode: mode,
        questionCount,
        totalScore,
        durationMinutes: Number(row.durationMinutes),
        maxAttempts: Number(row.maxAttempts),
        passScore: Number(row.passScore),
        showAnswersAfter: String(row.showAnswersAfter),
        ownerUserId: String(row.ownerUserId),
        ownerName: await platform.userName(String(row.ownerUserId)),
        published: bool(row.published),
        active: bool(row.active),
        candidates: candidates.size,
        passRate: candidates.size
          ? Math.round((passed.size / candidates.size) * 1000) / 10
          : null,
        grading: attempts.filter((a) => a.status === 'grading').length,
        antiCheat,
        aiGrading: row.aiGrading == null ? true : bool(row.aiGrading),
        aiAgreement: {
          compared,
          withinOne,
          rate: compared
            ? Math.round((withinOne / compared) * 1000) / 10
            : null,
        },
        flagged,
      });
    }
    return result;
  }

  async function examDetail(
    ctx: ActorContext,
    id: string,
  ): Promise<ExamDetail | undefined> {
    const policies = await authorizeAction(ctx.authz, EXAM, 'view');
    const row = (await database
      .repository('exams')
      .withPolicy(policyOf(policies, 'exams'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const [summary] = await toExamSummaries([row]);
    const paper = summary.paperMode === 'fixed' ? await fixedPaper(id) : [];
    const questions = await toQuestionViews(
      await loadQuestionRows(paper.map((p) => p.questionId)),
    );
    const rules =
      summary.paperMode === 'random'
        ? json<RandomRule[]>(row.randomRules, [])
        : [];
    const manage = await tryAuthorizeAction(ctx.authz, EXAM, 'manage');
    const canManage = manage
      ? Boolean(
          await database
            .repository('exams')
            .withPolicy(policyOf(manage, 'exams'))
            .findOne({ filter: { id } }),
        )
      : false;
    return {
      ...summary,
      questions: paper.map((p) => ({
        ...p,
        question: questions.find((q) => q.id === p.questionId) ?? null,
      })),
      randomRules: await Promise.all(
        rules.map(async (rule) => ({
          ...rule,
          available: (await candidatesFor(rule)).length,
        })),
      ),
      can: {
        manage: canManage,
        publish: canManage && (await platform.can(ctx, EXAM, 'publish')),
        grade: await platform.can(ctx, EXAM, 'grade'),
        resetAttempts: await platform.can(ctx, EXAM, 'resetAttempts'),
        reviewIntegrity: await platform.can(ctx, EXAM, 'reviewIntegrity'),
        voidAttempt: await platform.can(ctx, EXAM, 'voidAttempt'),
      },
    };
  }

  async function assertExamInScope(
    ctx: ActorContext,
    action: string,
    examId: string,
  ): Promise<CollectionPolicies> {
    const policies = await authorizeAction(ctx.authz, EXAM, action);
    const visible = await database
      .repository('exams')
      .withPolicy(policyOf(policies, 'exams'))
      .findOne({ filter: { id: examId } });
    if (!visible) throw new HrError('EXAM_NOT_FOUND', 404);
    return policies;
  }

  async function buildPaper(
    exam: Record<string, unknown>,
    connection?: DatabaseConnection,
    // V4-13: the candidate's language; a confirmed translation replaces the texts, the question stays the original.
    locale?: string,
  ): Promise<PaperItem[]> {
    const mode = String(exam.paperMode);
    const picks: { questionId: string; score: number }[] = [];
    if (mode === 'fixed') {
      for (const p of await fixedPaper(String(exam.id), connection))
        picks.push({ questionId: p.questionId, score: p.score });
    } else {
      const chosen = new Set<string>();
      for (const [index, rule] of json<RandomRule[]>(
        exam.randomRules,
        [],
      ).entries()) {
        const available = shuffle(
          (await candidatesFor(rule, connection)).filter(
            (id) => !chosen.has(id),
          ),
        );
        if (available.length < rule.count)
          throw new HrError('EXAM_RULE_SHORTAGE', 409, {
            rules: [{ index, available: available.length, count: rule.count }],
          });
        for (const id of available.slice(0, rule.count)) {
          chosen.add(id);
          picks.push({ questionId: id, score: rule.scoreEach });
        }
      }
    }
    const rows = await loadQuestionRows(
      picks.map((p) => p.questionId),
      connection,
    );
    const shuffleOptions = resolveAntiCheat(exam.antiCheat).shuffleOptions;
    const translated =
      locale && deps.translatedQuestions
        ? await deps.translatedQuestions(
            picks.map((p) => p.questionId),
            locale,
          )
        : new Map<string, { stem: string; options: QuestionOption[] }>();
    const tags = picks.length
      ? await (connection ? connection.query : database.query())
          .selectFrom('questionCompetencies')
          .select(['questionId', 'competencyId'])
          .where(
            'questionId',
            'in',
            picks.map((p) => p.questionId),
          )
          .execute()
      : [];
    return picks.map((pick) => {
      const found = rows.find((r) => String(r.id) === pick.questionId)!;
      const text = translated.get(pick.questionId);
      const row = text
        ? { ...found, stem: text.stem, options: text.options }
        : found;
      const type = String(row.type) as QuestionType;
      const answer = json<unknown>(row.answer, null);
      return {
        questionId: pick.questionId,
        type,
        stem: String(row.stem),
        // With 选项乱序 on, option order is shuffled per attempt and kept in the snapshot; keys stay attached to their text.
        options:
          type === 'single' || type === 'multiple'
            ? shuffleOptions
              ? shuffle(json<QuestionOption[]>(row.options, []))
              : json<QuestionOption[]>(row.options, [])
            : [],
        blankCount:
          type === 'blank' && Array.isArray(answer) ? answer.length : 0,
        score: pick.score,
        competencyIds: tags
          .filter((t) => String(t.questionId) === pick.questionId)
          .map((t) => String(t.competencyId)),
      };
    });
  }

  // ---------- Candidate ----------

  async function ownEmployee(ctx: ActorContext): Promise<EmployeeSummary> {
    const employee = await platform.employeeOfUser(ctx.userId);
    if (!employee || employee.status === 'leave')
      throw new HrError('EMPLOYEE_NOT_LINKED', 404);
    return employee;
  }

  /** Why a candidate may sit an exam: an open or finished exam assignment, or an enabled certification that requires it. */
  async function eligibility(
    employeeId: string,
    examId: string,
  ): Promise<{
    sources: ('assignment' | 'certification')[];
    recertAssignmentId: string | null;
    dueDate: string | null;
  }> {
    const query = database.query();
    const assignments = await query
      .selectFrom('assignments')
      .select(['id', 'status', 'source', 'dueDate', 'createdAt'])
      .where('employeeId', '=', employeeId)
      .where('examId', '=', examId)
      .where('status', '!=', 'cancelled')
      .orderBy('createdAt', 'desc')
      .execute();
    const certifications = await query
      .selectFrom('certificationExams')
      .innerJoin(
        'certifications',
        'certifications.id',
        'certificationExams.certificationId',
      )
      .select(['certifications.id as id'])
      .where('certificationExams.examId', '=', examId)
      .where('certifications.active', '=', true)
      .execute();
    const sources: ('assignment' | 'certification')[] = [];
    if (assignments.length) sources.push('assignment');
    if (certifications.length) sources.push('certification');
    const recert = assignments.find(
      (a) =>
        a.source === 'recertification' &&
        ['notStarted', 'inProgress', 'overdue'].includes(String(a.status)),
    );
    const open = assignments.find((a) =>
      ['notStarted', 'inProgress', 'overdue'].includes(String(a.status)),
    );
    return {
      sources,
      recertAssignmentId: recert ? String(recert.id) : null,
      dueDate: open?.dueDate
        ? str(
            open.dueDate instanceof Date
              ? open.dueDate.toISOString()
              : open.dueDate,
          ).slice(0, 10)
        : null,
    };
  }

  /**
   * Attempts that count against the limit: recertification keeps its own
   * count. An attempt voided after an integrity review still counts (it has a
   * `voidReason`); a reset stops everything before it from counting.
   */
  async function countedAttempts(
    employeeId: string,
    examId: string,
    recertAssignmentId: string | null,
    connection?: DatabaseConnection,
  ) {
    let builder = (connection ? connection.query : database.query())
      .selectFrom('examAttempts')
      .select([
        'id',
        'attemptNo',
        'status',
        'score',
        'submittedAt',
        'assignmentId',
      ])
      .where('employeeId', '=', employeeId)
      .where('examId', '=', examId)
      .where('resetAt', 'is', null)
      .where((eb) =>
        eb.or([eb('status', '!=', 'voided'), eb('voidReason', 'is not', null)]),
      );
    builder = recertAssignmentId
      ? builder.where('assignmentId', '=', recertAssignmentId)
      : builder.where('assignmentId', 'is', null);
    return builder.orderBy('attemptNo', 'desc').execute();
  }

  async function loadOwnAttempt(
    ctx: ActorContext,
    action: string,
    attemptId: string,
  ): Promise<{
    row: Record<string, unknown>;
    policies: CollectionPolicies;
    employee: EmployeeSummary;
  }> {
    const policies = await authorizeAction(ctx.authz, TAKING, action);
    const employee = await ownEmployee(ctx);
    const row = (await database
      .repository('examAttempts')
      .withPolicy(policyOf(policies, 'examAttempts'))
      .findOne({ filter: { id: attemptId } })) as
      Record<string, unknown> | undefined;
    if (!row || String(row.employeeId) !== employee.id)
      throw new HrError('ATTEMPT_NOT_FOUND', 404);
    return { row, policies, employee };
  }

  function toAttemptView(
    row: Record<string, unknown>,
    exam: Record<string, unknown>,
    deviceToken: string | null = null,
  ): AttemptView {
    const examTitle = String(exam.title);
    const antiCheat = resolveAntiCheat(exam.antiCheat);
    return {
      id: String(row.id),
      examId: String(row.examId),
      examTitle,
      attemptNo: Number(row.attemptNo),
      status: String(row.status),
      startedAt: iso(row.startedAt)!,
      deadlineAt: iso(row.deadlineAt)!,
      serverNow: new Date().toISOString(),
      submittedAt: iso(row.submittedAt),
      items: json<PaperItem[]>(row.paperSnapshot, []),
      answers: json<Record<string, unknown>>(row.answers, {}),
      antiCheat: {
        disableCopy: antiCheat.disableCopy,
        maxBlurCount: antiCheat.maxBlurCount,
        blurAction: antiCheat.blurAction,
        singleDevice: antiCheat.singleDevice,
      },
      blurCount: Number(row.blurCount ?? 0),
      deviceToken,
    };
  }

  const MAX_FLAGS = 200;

  async function appendFlag(
    attemptId: string,
    flag: IntegrityFlag,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const row = await database
      .query()
      .selectFrom('examAttempts')
      .select(['integrityFlags'])
      .where('id', '=', attemptId)
      .executeTakeFirst();
    const flags = json<IntegrityFlag[]>(row?.integrityFlags, []);
    await database
      .query()
      .updateTable('examAttempts')
      .set({
        integrityFlags: [...flags, flag].slice(-MAX_FLAGS),
        ...extra,
        updatedAt: new Date(),
      })
      .where('id', '=', attemptId)
      .execute();
  }

  /**
   * 单设备作答: the device that started (or last took over) an attempt holds
   * its token. Opening the attempt without that token is another device: it
   * takes the attempt over and the takeover is flagged. After a takeover, a
   * save or submission without the current token is refused and flagged. A
   * client that never sends a token is accepted until the first takeover.
   */
  async function assertDevice(
    row: Record<string, unknown>,
    exam: Record<string, unknown>,
    token: string | null | undefined,
  ): Promise<void> {
    if (!resolveAntiCheat(exam.antiCheat).singleDevice) return;
    const stored = row.deviceToken == null ? null : str(row.deviceToken);
    if (!stored || token === stored) return;
    const flags = json<IntegrityFlag[]>(row.integrityFlags, []);
    if (!token && !flags.some((f) => f.type === 'multiDevice')) return;
    await appendFlag(String(row.id), {
      type: 'multiDevice',
      at: new Date().toISOString(),
      detail: 'rejected',
    });
    throw new HrError('ATTEMPT_DEVICE_CHANGED', 409);
  }

  /** Opening an attempt on a device without its token takes it over: a new token for this device. */
  async function takeOver(
    row: Record<string, unknown>,
    exam: Record<string, unknown>,
    token: string | null | undefined,
  ): Promise<string | null> {
    if (!resolveAntiCheat(exam.antiCheat).singleDevice) return null;
    const stored = row.deviceToken == null ? null : str(row.deviceToken);
    if (stored && token === stored) return null;
    const next = newId();
    if (stored)
      await appendFlag(
        String(row.id),
        { type: 'multiDevice', at: new Date().toISOString(), detail: 'opened' },
        { deviceToken: next },
      );
    else
      await database
        .query()
        .updateTable('examAttempts')
        .set({ deviceToken: next, updatedAt: new Date() })
        .where('id', '=', String(row.id))
        .execute();
    return next;
  }

  function cleanAnswers(
    items: readonly PaperItem[],
    value: unknown,
  ): Record<string, unknown> {
    if (value === undefined || value === null) return {};
    if (!isRecord(value)) throw new HrError('INVALID_INPUT', 400);
    const result: Record<string, unknown> = {};
    for (const item of items) {
      const response = value[item.questionId];
      if (response === undefined || response === null) continue;
      if (item.type === 'single' && typeof response === 'string')
        result[item.questionId] = response.slice(0, 8);
      else if (item.type === 'multiple' && Array.isArray(response))
        result[item.questionId] = response.map(String).slice(0, 8);
      else if (item.type === 'judge' && typeof response === 'boolean')
        result[item.questionId] = response;
      else if (item.type === 'blank' && Array.isArray(response))
        result[item.questionId] = response
          .map((r) => String(r ?? '').slice(0, 200))
          .slice(0, 10);
      else if (item.type === 'short' && typeof response === 'string')
        result[item.questionId] = response.slice(0, 8000);
    }
    return result;
  }

  /**
   * Scores an attempt and finishes it: straight to passed/failed when every
   * question is objective, to grading otherwise. Runs once: only an
   * in-progress row is updated.
   */
  async function finalize(
    attemptId: string,
    answers: Record<string, unknown> | undefined,
  ): Promise<string> {
    const outcome = await database.transaction(async (connection) => {
      const row = await connection.query
        .selectFrom('examAttempts')
        .selectAll()
        .where('id', '=', attemptId)
        .executeTakeFirst();
      if (!row || row.status !== 'inProgress') return undefined;
      const exam = (await examRow(String(row.examId), connection))!;
      const items = json<PaperItem[]>(row.paperSnapshot, []);
      const saved = answers ?? json<Record<string, unknown>>(row.answers, {});
      const questions = await loadQuestionRows(
        items.map((i) => i.questionId),
        connection,
      );
      const results: Record<
        string,
        {
          score: number | null;
          correct: boolean | null;
          comment: string | null;
        }
      > = {};
      let objective = 0;
      let hasShort = false;
      for (const item of items) {
        const question = questions.find(
          (q) => String(q.id) === item.questionId,
        );
        const answer = json<unknown>(question?.answer, null);
        const { earned, correct } = scoreItem(
          item.type,
          answer,
          saved[item.questionId],
          item.score,
        );
        if (item.type === 'short') hasShort = true;
        else objective += earned ?? 0;
        results[item.questionId] = { score: earned, correct, comment: null };
      }
      const total = items.reduce((sum, i) => sum + i.score, 0);
      const status = hasShort
        ? 'grading'
        : total && (objective / total) * 100 >= Number(exam.passScore)
          ? 'passed'
          : 'failed';
      const score = hasShort
        ? null
        : total
          ? Math.round((objective / total) * 1000) / 10
          : 0;
      const stamp = new Date();
      await connection.query
        .updateTable('examAttempts')
        .set({
          answers: JSON.stringify(saved),
          submittedAt: stamp,
          objectiveScore: objective,
          score,
          status,
          itemResults: JSON.stringify(results),
          // Scored attempts carry their loss by competency; a graded one gets it when the grade is in.
          lossByCompetency: hasShort ? null : computeLoss(items, results),
          updatedAt: stamp,
        })
        .where('id', '=', attemptId)
        .where('status', '=', 'inProgress')
        .execute();
      if (status === 'passed')
        await learning.completeExamAssignments(
          connection,
          String(row.employeeId),
          String(row.examId),
        );
      return { status, row, exam };
    });
    if (!outcome) return 'skipped';
    if (outcome.status === 'grading') {
      // V3-10 考官: with AI grading on, the instructor is told once the suggestions exist.
      const aiGrading =
        outcome.exam.aiGrading == null ? true : bool(outcome.exam.aiGrading);
      if (aiGrading && deps.onGradingRequested?.()?.(attemptId))
        return outcome.status;
      await notify({
        key: `attempt:${attemptId}:grading`,
        userIds: [String(outcome.exam.ownerUserId)],
        message: 'examGradingNeeded',
        params: {
          title: String(outcome.exam.title),
          name:
            (await platform.employee(String(outcome.row.employeeId)))?.name ??
            '',
        },
        path: `/talent/exams/${String(outcome.exam.id)}?tab=grading`,
      });
    } else if (outcome.status === 'passed') {
      await afterPassed(attemptId);
    } else if (outcome.status === 'failed') {
      await afterFailed(attemptId);
    }
    return outcome.status;
  }

  /**
   * A failed renewal attempt that used the last attempt its renewal allows
   * wakes the certification steward, which assigns remedial learning. The
   * steward decides nothing about the certificate: its status follows rules.
   */
  async function afterFailed(attemptId: string): Promise<void> {
    const row = await database
      .query()
      .selectFrom('examAttempts')
      .select(['employeeId', 'examId', 'assignmentId'])
      .where('id', '=', attemptId)
      .executeTakeFirst();
    if (!row) return;
    const assignment = row.assignmentId
      ? await database
          .query()
          .selectFrom('assignments')
          .select(['source'])
          .where('id', '=', str(row.assignmentId))
          .executeTakeFirst()
      : undefined;
    if (!assignment || str(assignment.source) !== 'recertification') {
      // V3-10 学习教练: a failed ordinary exam gets a remedial plan draft; renewals are the steward's.
      deps.onExamFailed?.()?.(attemptId);
      return;
    }
    const exam = await examRow(str(row.examId));
    if (!exam) return;
    const attempts = await countedAttempts(
      str(row.employeeId),
      str(row.examId),
      str(row.assignmentId),
    );
    if (
      attempts.length >= Number(exam.maxAttempts) &&
      !attempts.some(
        (a) =>
          a.status === 'passed' ||
          a.status === 'grading' ||
          a.status === 'inProgress',
      )
    )
      deps.onRecertificationExhausted?.()?.(attemptId);
  }

  /** Exam results feed competency levels and certification requirements. */
  async function afterPassed(attemptId: string): Promise<void> {
    const row = (await database
      .query()
      .selectFrom('examAttempts')
      .selectAll()
      .where('id', '=', attemptId)
      .executeTakeFirst()) as Record<string, unknown>;
    await writeCompetencyLevels(row);
    await deps.onExamPassed?.()?.(String(row.employeeId), String(row.examId));
  }

  async function writeCompetencyLevels(
    attempt: Record<string, unknown>,
  ): Promise<void> {
    const rule = deps.examRules
      ? await deps.examRules()
      : deps.examCompetency();
    const items = json<PaperItem[]>(attempt.paperSnapshot, []);
    const results = json<Record<string, { score: number | null }>>(
      attempt.itemResults,
      {},
    );
    const total = items.reduce((sum, i) => sum + i.score, 0);
    if (!total) return;
    const employee = await platform.employee(String(attempt.employeeId));
    if (!employee) return;
    const exam = await examRow(String(attempt.examId));
    const byCompetency = new Map<
      string,
      { possible: number; earned: number }
    >();
    for (const item of items) {
      for (const competencyId of item.competencyIds) {
        const entry = byCompetency.get(competencyId) ?? {
          possible: 0,
          earned: 0,
        };
        entry.possible += item.score;
        entry.earned += results[item.questionId]?.score ?? 0;
        byCompetency.set(competencyId, entry);
      }
    }
    const query = database.query();
    for (const [competencyId, { possible, earned }] of byCompetency) {
      if (possible / total < rule.minWeight) continue;
      const requirement = await query
        .selectFrom('positionRequirements')
        .select(['requiredLevel'])
        .where('positionId', '=', employee.positionId)
        .where('competencyId', '=', competencyId)
        .where('reviewStatus', '=', 'confirmed')
        .executeTakeFirst();
      if (!requirement) continue;
      const rate = earned / possible;
      const required = Number(requirement.requiredLevel);
      const level =
        rate >= rule.fullRate
          ? required
          : rate >= rule.partialRate
            ? required - 1
            : 0;
      if (level < 1) continue;
      const latest = await query
        .selectFrom('employeeCompetencies')
        .select(['level'])
        .where('employeeId', '=', employee.id)
        .where('competencyId', '=', competencyId)
        .orderBy('assessedAt', 'desc')
        .executeTakeFirst();
      // An exam never lowers a higher level already recorded.
      if (latest && Number(latest.level) >= level) continue;
      const stamp = new Date();
      await query
        .insertInto('employeeCompetencies')
        .values({
          id: newId(),
          employeeId: employee.id,
          competencyId,
          level,
          source: 'exam',
          evidence: `考试《${str(exam?.title ?? '')}》该能力项得分率 ${Math.round(rate * 1000) / 10}%`,
          assessedBy: 'system',
          assessedAt: stamp,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
    }
  }

  function answersVisible(
    exam: Record<string, unknown>,
    status: string,
  ): boolean {
    const mode = String(exam.showAnswersAfter);
    if (status === 'inProgress' || status === 'grading') return false;
    if (mode === 'afterSubmit') return true;
    if (mode === 'afterPass') return status === 'passed';
    return false;
  }

  async function toResult(
    row: Record<string, unknown>,
    options: { forGrader?: boolean } = {},
  ): Promise<AttemptResult> {
    const exam = (await examRow(String(row.examId)))!;
    const items = json<PaperItem[]>(row.paperSnapshot, []);
    const answers = json<Record<string, unknown>>(row.answers, {});
    const results = json<
      Record<
        string,
        {
          score: number | null;
          correct: boolean | null;
          comment: string | null;
          aiSuggestion?: GradingSuggestion;
        }
      >
    >(row.itemResults, {});
    const visible =
      options.forGrader || answersVisible(exam, String(row.status));
    const scored = row.status === 'passed' || row.status === 'failed';
    const loss = scored
      ? (json<LossByCompetency[] | null>(row.lossByCompetency, null) ??
        computeLoss(items, results))
      : [];
    const questions = await loadQuestionRows(items.map((i) => i.questionId));
    const employee = await platform.employee(String(row.employeeId));
    // Wrong answers grouped by competency, with published courses that cover it.
    const tally = new Map<string, { wrong: number; total: number }>();
    for (const item of items) {
      const correct = results[item.questionId]?.correct;
      for (const competencyId of item.competencyIds) {
        const entry = tally.get(competencyId) ?? { wrong: 0, total: 0 };
        entry.total += 1;
        if (correct === false) entry.wrong += 1;
        tally.set(competencyId, entry);
      }
    }
    const competencyIds = [
      ...new Set([...tally.keys(), ...loss.map((l) => l.competencyId)]),
    ];
    const titles = competencyIds.length
      ? new Map(
          (
            await database
              .query()
              .selectFrom('competencies')
              .select(['id', 'title'])
              .where('id', 'in', competencyIds)
              .execute()
          ).map((r) => [String(r.id), String(r.title)]),
        )
      : new Map<string, string>();
    const courses = await learning.coursesForCompetencies(competencyIds);
    const showItems =
      visible ||
      String(row.status) === 'passed' ||
      String(row.status) === 'failed';
    return {
      id: String(row.id),
      examId: String(row.examId),
      examTitle: String(exam.title),
      employeeName: employee?.name ?? '',
      attemptNo: Number(row.attemptNo),
      status: String(row.status),
      score: row.score == null ? null : Number(row.score),
      passScore: Number(exam.passScore),
      submittedAt: iso(row.submittedAt),
      answersVisible: visible,
      items: showItems
        ? items.map((item) => {
            const question = questions.find(
              (q) => String(q.id) === item.questionId,
            );
            const result = results[item.questionId];
            return {
              questionId: item.questionId,
              type: item.type,
              stem: item.stem,
              options: item.options,
              score: item.score,
              earned: result?.score ?? null,
              correct: visible ? (result?.correct ?? null) : null,
              response: answers[item.questionId] ?? null,
              ...(visible
                ? {
                    answer: json<unknown>(question?.answer, null),
                    explanation:
                      question?.explanation == null
                        ? null
                        : str(question.explanation),
                    gradingNotes:
                      options.forGrader && question?.gradingNotes != null
                        ? str(question.gradingNotes)
                        : null,
                    comment: result?.comment ?? null,
                  }
                : {}),
              ...(options.forGrader && item.type === 'short'
                ? { aiSuggestion: result?.aiSuggestion ?? null }
                : {}),
            };
          })
        : [],
      lossByCompetency: loss.map((l) => ({
        ...l,
        title: titles.get(l.competencyId) ?? l.competencyId,
      })),
      integrity: options.forGrader
        ? {
            blurCount: Number(row.blurCount ?? 0),
            flags: json<IntegrityFlag[]>(row.integrityFlags, []),
            review:
              row.integrityReview == null ? null : str(row.integrityReview),
            voidReason: row.voidReason == null ? null : str(row.voidReason),
          }
        : null,
      wrongByCompetency: [...tally.entries()]
        .filter(([, entry]) => entry.wrong > 0)
        .map(([competencyId, entry]) => ({
          competencyId,
          title: titles.get(competencyId) ?? competencyId,
          wrong: entry.wrong,
          total: entry.total,
          courses: courses[competencyId] ?? [],
        })),
    };
  }

  const service: ExamService = {
    // ---------- Questions ----------
    async listQuestions(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, QUESTION, 'view');
      const q = filters.q?.trim();
      let rows = (await database
        .repository('questions')
        .withPolicy(policyOf(policies, 'questions'))
        .findMany({
          filter: (f) =>
            f.and([
              ...(filters.type ? [f.string('type').eq(filters.type)] : []),
              ...(filters.difficulty
                ? [f.string('difficulty').eq(filters.difficulty)]
                : []),
              ...(filters.sourceDocumentId
                ? [f.string('sourceDocumentId').eq(filters.sourceDocumentId)]
                : []),
              ...(filters.sourceCourseId
                ? [f.string('sourceCourseId').eq(filters.sourceCourseId)]
                : []),
              ...(filters.review === 'mine'
                ? [
                    f.string('reviewStatus').eq('draft'),
                    f.string('ownerUserId').eq(ctx.userId),
                  ]
                : []),
              ...(filters.status === 'draft' || filters.status === 'confirmed'
                ? [f.string('reviewStatus').eq(filters.status)]
                : []),
              ...(filters.status === 'inactive'
                ? [f.boolean('active').isFalse()]
                : []),
              ...(q
                ? [f.string('stem').includes(q, { mode: 'insensitive' })]
                : []),
            ]),
          sort: (s) => [s.field('updatedAt').desc()],
        })) as Record<string, unknown>[];
      // V4-13: translations are reviewed in 译文审核, not listed as questions of their own.
      const translated = new Set(
        (
          await database
            .query()
            .selectFrom('questions')
            .select(['id'])
            .where('translationOfId', 'is not', null)
            .execute()
        ).map((t) => String(t.id)),
      );
      rows = rows.filter((r) => !translated.has(String(r.id)));
      if (filters.competencyId) {
        const tagged = await database
          .query()
          .selectFrom('questionCompetencies')
          .select(['questionId'])
          .where('competencyId', '=', filters.competencyId)
          .execute();
        const set = new Set(tagged.map((t) => String(t.questionId)));
        rows = rows.filter((r) => set.has(String(r.id)));
      }
      return {
        items: await toQuestionViews(rows),
        can: {
          manage: await platform.can(ctx, QUESTION, 'manage'),
          confirm: await platform.can(ctx, QUESTION, 'confirm'),
          import: await platform.can(ctx, QUESTION, 'import'),
        },
      };
    },

    async saveQuestion(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, QUESTION, 'manage');
      const values = parseQuestion(input);
      await assertCompetencies(values.competencyIds);
      const questionId = await database.transaction(async (connection) => {
        if (id) {
          const current = (await connection
            .repository('questions')
            .withPolicy(policyOf(policies, 'questions'))
            .findOne({ filter: { id } })) as
            Record<string, unknown> | undefined;
          if (!current) throw new HrError('QUESTION_NOT_FOUND', 404);
          return writeQuestion(connection, policies, id, values, {});
        }
        return writeQuestion(connection, policies, null, values, {
          ownerUserId: ctx.userId,
          source: 'manual',
          reviewStatus: 'confirmed',
          active: true,
        });
      });
      const [view] = await toQuestionViews(
        await loadQuestionRows([questionId]),
      );
      return view;
    },

    async bulkQuestions(ctx, input) {
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const action = requireEnum(
        input.action,
        ['confirm', 'discard', 'disable', 'enable'] as const,
        'INVALID_INPUT',
      );
      const ids = stringIds(input.ids).slice(0, 500);
      if (!ids.length) throw new HrError('INVALID_INPUT', 400);
      const policies = await authorizeAction(
        ctx.authz,
        QUESTION,
        action === 'discard' ? 'manage' : 'confirm',
      );
      const view = await authorizeAction(ctx.authz, QUESTION, 'view');
      const visible = new Set(
        (
          (await database
            .repository('questions')
            .withPolicy(policyOf(view, 'questions'))
            .findMany({
              filter: (f) => f.or(ids.map((id) => f.string('id').eq(id))),
            })) as Record<string, unknown>[]
        ).map((r) => String(r.id)),
      );
      const skipped: { id: string; reason: string }[] = [];
      const decisions: { id: string; action: 'confirmed' | 'discarded' }[] = [];
      let changed = 0;
      await database.transaction(async (connection) => {
        const repo = connection
          .repository('questions')
          .withPolicy(policyOf(policies, 'questions'));
        for (const id of ids) {
          if (!visible.has(id)) {
            skipped.push({ id, reason: 'notFound' });
            continue;
          }
          const row = (await connection.query
            .selectFrom('questions')
            .select(['id', 'reviewStatus'])
            .where('id', '=', id)
            .executeTakeFirst()) as Record<string, unknown>;
          const stamp = new Date();
          if (action === 'confirm') {
            if (row.reviewStatus === 'confirmed') continue;
            await repo.updateOne({
              filter: { id },
              values: { reviewStatus: 'confirmed', updatedAt: stamp },
            });
            decisions.push({ id, action: 'confirmed' });
          } else if (action === 'discard') {
            // Only a draft nothing references can be discarded; anything else is disabled instead.
            const used = await connection.query
              .selectFrom('examQuestions')
              .select(['id'])
              .where('questionId', '=', id)
              .executeTakeFirst();
            if (row.reviewStatus !== 'draft' || used) {
              skipped.push({ id, reason: 'notDraft' });
              continue;
            }
            decisions.push({ id, action: 'discarded' });
            await connection.query
              .deleteFrom('questionCompetencies')
              .where('questionId', '=', id)
              .execute();
            await connection.query
              .deleteFrom('questions')
              .where('id', '=', id)
              .where('reviewStatus', '=', 'draft')
              .execute();
          } else {
            await repo.updateOne({
              filter: { id },
              values: { active: action === 'enable', updatedAt: stamp },
            });
          }
          changed += 1;
        }
      });
      // Outside the transaction: the run items live on another connection.
      for (const decision of decisions)
        await recordDraftOutcome(
          database,
          'question',
          decision.id,
          decision.action,
          ctx.userId,
        );
      return { changed, skipped };
    },

    importTemplate() {
      const sheet = XLSX.utils.aoa_to_sheet([
        ['题型', '题干', '选项', '答案', '解析', '难度', '能力项编码'],
        [
          '单选',
          '设备停机超过多长时间，重新开机须做首件检验？',
          'A. 5 分钟|B. 10 分钟|C. 15 分钟|D. 30 分钟',
          'C',
          '见《CNC 加工作业指导书》WI-MC-0231 4.3 停机后首件。',
          '易',
          'cnc-operation',
        ],
        [
          '多选',
          '以下哪些内容应记入首件检验记录？',
          'A. 测量的关键尺寸|B. 检验结果|C. 检验人签名|D. 午餐时间',
          'A,B,C',
          '',
          '中',
          'quality-records',
        ],
        [
          '判断',
          '过程检验记录写错时，可以用涂改液覆盖后重写。',
          '',
          '错',
          '',
          '易',
          'quality-records',
        ],
        [
          '填空',
          '批量加工中每____件自检一次关键尺寸。',
          '',
          '20',
          '',
          '易',
          'cnc-operation',
        ],
        [
          '简答',
          '加工中发现铁屑缠绕在刀具上，你应如何处理？',
          '',
          '先停机，设备停止运转后再打开防护门；不戴手套和首饰，用专用铁钩或毛刷清理，不得用手清理；关好防护门后恢复加工。',
          '评分要点：先停机再开防护门、不戴手套和首饰、用铁钩或毛刷清理',
          '中',
          'safety-5s',
        ],
      ]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, '题目');
      return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    },

    async importQuestions(ctx, file) {
      const policies = await authorizeAction(ctx.authz, QUESTION, 'import');
      let rows: unknown[][];
      try {
        const book = XLSX.read(file, { type: 'array' });
        rows = XLSX.utils.sheet_to_json<unknown[]>(
          book.Sheets[book.SheetNames[0]],
          { header: 1, blankrows: false },
        );
      } catch {
        throw new HrError('IMPORT_FILE_INVALID', 400);
      }
      const data = rows
        .slice(1)
        .filter((r) => r.some((c) => str(c ?? '').trim()));
      if (!data.length) throw new HrError('IMPORT_FILE_INVALID', 400);
      if (data.length > 500) throw new HrError('IMPORT_TOO_MANY_ROWS', 400);
      const typeNames: Record<string, QuestionType> = {
        单选: 'single',
        多选: 'multiple',
        判断: 'judge',
        填空: 'blank',
        简答: 'short',
        single: 'single',
        multiple: 'multiple',
        judge: 'judge',
        blank: 'blank',
        short: 'short',
      };
      const difficultyNames: Record<string, string> = {
        易: 'easy',
        中: 'medium',
        难: 'hard',
        easy: 'easy',
        medium: 'medium',
        hard: 'hard',
      };
      const competencies = await database
        .query()
        .selectFrom('competencies')
        .select(['id', 'code'])
        .execute();
      const byCode = new Map(
        competencies.map((c) => [String(c.code), String(c.id)]),
      );
      const errors: { row: number; code: string }[] = [];
      const parsed: QuestionInput[] = [];
      data.forEach((cells, index) => {
        const cell = (i: number) => str(cells[i] ?? '').trim();
        try {
          const type = typeNames[cell(0)];
          if (!type) throw new HrError('QUESTION_TYPE_INVALID', 400);
          const options = cell(2)
            ? cell(2)
                .split('|')
                .map((part, i) => {
                  const match = /^([A-Ha-h])[.、．)\s]\s*(.+)$/u.exec(
                    part.trim(),
                  );
                  return match
                    ? { key: match[1].toUpperCase(), text: match[2].trim() }
                    : { key: String.fromCharCode(65 + i), text: part.trim() };
                })
            : [];
          const rawAnswer = cell(3);
          const answer =
            type === 'multiple'
              ? rawAnswer
                  .toUpperCase()
                  .split(/[,，\s]+/u)
                  .filter(Boolean)
              : type === 'single'
                ? rawAnswer.toUpperCase()
                : type === 'judge'
                  ? ['对', '正确', 'true', 't', '√', 'yes'].includes(
                      rawAnswer.toLowerCase(),
                    )
                    ? true
                    : ['错', '错误', 'false', 'f', '×', 'no'].includes(
                          rawAnswer.toLowerCase(),
                        )
                      ? false
                      : rawAnswer
                  : type === 'blank'
                    ? rawAnswer
                        .split('|')
                        .map((blank) => blank.split('/').map((a) => a.trim()))
                    : rawAnswer;
          const codes = cell(6)
            .split(/[,，\s]+/u)
            .filter(Boolean);
          const competencyIds = codes.map((code) => {
            const id = byCode.get(code);
            if (!id) throw new HrError('IMPORT_COMPETENCY_NOT_FOUND', 400);
            return id;
          });
          parsed.push(
            parseQuestion({
              type,
              stem: cell(1),
              options,
              answer,
              explanation: type === 'short' ? null : cell(4) || null,
              gradingNotes: type === 'short' ? cell(4) || null : null,
              difficulty: difficultyNames[cell(5)] ?? 'medium',
              competencyIds,
            }),
          );
        } catch (error) {
          errors.push({
            row: index + 2,
            code: error instanceof HrError ? error.code : 'INVALID_INPUT',
          });
        }
      });
      if (errors.length)
        throw new HrError('IMPORT_HAS_ERRORS', 400, { errors });
      await database.transaction(async (connection) => {
        for (const values of parsed)
          await writeQuestion(connection, policies, null, values, {
            ownerUserId: ctx.userId,
            source: 'import',
            reviewStatus: 'confirmed',
            active: true,
          });
      });
      return { created: parsed.length };
    },

    async questionSummaries(ctx, input) {
      await authorizeAction(ctx.authz, WRITER, 'use');
      const policies = await authorizeAction(ctx.authz, QUESTION, 'view');
      let rows = (await database
        .repository('questions')
        .withPolicy(policyOf(policies, 'questions'))
        .findMany({
          filter: (f) =>
            f.and([
              ...(input.sourceDocumentId
                ? [f.string('sourceDocumentId').eq(input.sourceDocumentId)]
                : []),
              ...(input.sourceCourseId
                ? [f.string('sourceCourseId').eq(input.sourceCourseId)]
                : []),
            ]),
        })) as Record<string, unknown>[];
      if (input.competencyId) {
        const tagged = await database
          .query()
          .selectFrom('questionCompetencies')
          .select(['questionId'])
          .where('competencyId', '=', input.competencyId)
          .execute();
        const set = new Set(tagged.map((t) => String(t.questionId)));
        rows = rows.filter((r) => set.has(String(r.id)));
      }
      return rows.slice(0, 200).map((r) => ({
        id: String(r.id),
        type: String(r.type),
        stem: String(r.stem).slice(0, 200),
        reviewStatus: String(r.reviewStatus),
      }));
    },

    async createQuestionDrafts(ctx, input, options = {}) {
      const ownerUserId = options.ownerUserId ?? ctx.userId;
      await authorizeAction(ctx.authz, WRITER, 'use');
      const policies = await authorizeAction(ctx.authz, QUESTION, 'manage');
      if (
        !isRecord(input) ||
        !Array.isArray(input.questions) ||
        !input.questions.length ||
        input.questions.length > 50
      )
        throw new HrError('INVALID_INPUT', 400);
      const sourceDocumentId = requireString(
        input.sourceDocumentId,
        'INVALID_INPUT',
        { optional: true, max: 64 },
      );
      const sourceCourseId = requireString(
        input.sourceCourseId,
        'INVALID_INPUT',
        { optional: true, max: 64 },
      );
      if (
        sourceCourseId &&
        !(await database
          .query()
          .selectFrom('courses')
          .select(['id'])
          .where('id', '=', sourceCourseId)
          .executeTakeFirst())
      )
        throw new HrError('COURSE_NOT_FOUND', 404);
      const drafts = input.questions.map((q) =>
        parseQuestion(
          { ...(isRecord(q) ? q : {}), sourceDocumentId, sourceCourseId },
          { requireExcerpt: true },
        ),
      );
      for (const draft of drafts) await assertCompetencies(draft.competencyIds);
      const ids: string[] = [];
      let skipped = 0;
      await database.transaction(async (connection) => {
        for (const draft of drafts) {
          // A retried call does not duplicate a draft with the same stem.
          const same = await connection.query
            .selectFrom('questions')
            .select(['id'])
            .where('stem', '=', draft.stem)
            .where('ownerUserId', '=', ownerUserId)
            .where('source', '=', 'ai')
            .executeTakeFirst();
          if (same) {
            skipped += 1;
            continue;
          }
          ids.push(
            await writeQuestion(connection, policies, null, draft, {
              ownerUserId,
              source: 'ai',
              reviewStatus: 'draft',
              active: true,
            }),
          );
        }
      });
      return { created: ids.length, skipped, ids };
    },

    // ---------- Exams ----------
    async listExams(ctx) {
      const policies = await authorizeAction(ctx.authz, EXAM, 'view');
      const rows = (await database
        .repository('exams')
        .withPolicy(policyOf(policies, 'exams'))
        .findMany({ sort: (s) => [s.field('updatedAt').desc()] })) as Record<
        string,
        unknown
      >[];
      return {
        items: await toExamSummaries(rows),
        canCreate: await platform.can(ctx, EXAM, 'manage'),
        canConfigure: await platform.can(ctx, EXAM, 'configure'),
      };
    },

    getExam: examDetail,

    async saveExam(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, EXAM, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const int = (
        value: unknown,
        code: string,
        min: number,
        max: number,
        fallback: number,
      ) => {
        if (value === undefined || value === null || value === '')
          return fallback;
        const n = Number(value);
        if (!Number.isInteger(n) || n < min || n > max)
          throw new HrError(code, 400);
        return n;
      };
      const paperMode = requireEnum(
        input.paperMode,
        ['fixed', 'random'] as const,
        'EXAM_MODE_INVALID',
      );
      const values = {
        title: requireString(input.title, 'EXAM_TITLE_REQUIRED', { max: 200 })!,
        description: requireString(input.description, 'INVALID_INPUT', {
          optional: true,
          max: 4000,
        }),
        paperMode,
        durationMinutes: int(
          input.durationMinutes,
          'EXAM_DURATION_INVALID',
          1,
          600,
          30,
        ),
        maxAttempts: int(input.maxAttempts, 'EXAM_ATTEMPTS_INVALID', 1, 20, 3),
        passScore: int(input.passScore, 'EXAM_PASS_SCORE_INVALID', 0, 100, 80),
        showAnswersAfter: requireEnum(
          input.showAnswersAfter ?? 'afterPass',
          ['never', 'afterSubmit', 'afterPass'] as const,
          'INVALID_INPUT',
        ),
        antiCheat: JSON.stringify(parseAntiCheat(input.antiCheat)),
        aiGrading: (() => {
          if (input.aiGrading === undefined || input.aiGrading === null)
            return true;
          if (typeof input.aiGrading !== 'boolean')
            throw new HrError('INVALID_INPUT', 400);
          return input.aiGrading;
        })(),
      };
      const rules = paperMode === 'random' ? parseRules(input.randomRules) : [];
      let paper: { questionId: string; score: number }[] = [];
      if (paperMode === 'fixed') {
        if (!Array.isArray(input.questions))
          throw new HrError('EXAM_QUESTIONS_INVALID', 400);
        paper = input.questions.map((item) => {
          if (!isRecord(item) || typeof item.questionId !== 'string')
            throw new HrError('EXAM_QUESTIONS_INVALID', 400);
          const score = Number(item.score);
          if (!Number.isFinite(score) || score <= 0 || score > 100)
            throw new HrError('EXAM_QUESTIONS_INVALID', 400);
          return { questionId: item.questionId, score };
        });
        if (new Set(paper.map((p) => p.questionId)).size !== paper.length)
          throw new HrError('EXAM_QUESTIONS_INVALID', 400);
        const rows = await loadQuestionRows(paper.map((p) => p.questionId));
        // Drafts and disabled questions never reach a paper.
        if (
          rows.length !== paper.length ||
          rows.some((r) => r.reviewStatus !== 'confirmed' || !bool(r.active))
        )
          throw new HrError('QUESTION_NOT_CONFIRMED', 409);
      }
      const examId = id ?? newId();
      await database.transaction(async (connection) => {
        const repo = connection
          .repository('exams')
          .withPolicy(policyOf(policies, 'exams'));
        const stamp = new Date();
        if (id) {
          const current = (await repo.findOne({ filter: { id } })) as
            Record<string, unknown> | undefined;
          if (!current) throw new HrError('EXAM_NOT_FOUND', 404);
          if (bool(current.published))
            throw new HrError('EXAM_PUBLISHED_LOCKED', 409);
          await repo.updateOne({
            filter: { id },
            values: {
              ...values,
              randomRules:
                paperMode === 'random' ? JSON.stringify(rules) : null,
              updatedAt: stamp,
            },
          });
        } else {
          await repo.createOne({
            values: {
              id: examId,
              ...values,
              randomRules:
                paperMode === 'random' ? JSON.stringify(rules) : null,
              ownerUserId: ctx.userId,
              published: false,
              active: true,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
        }
        const links = connection
          .repository('examQuestions')
          .withPolicy(policyOf(policies, 'examQuestions'));
        const existing = (await links.findMany({
          filter: { examId },
        })) as Record<string, unknown>[];
        for (const row of existing)
          await links.deleteOne({ filter: { id: String(row.id) } });
        let order = 0;
        for (const item of paper)
          await links.createOne({
            values: {
              id: newId(),
              examId,
              questionId: item.questionId,
              sortOrder: order++,
              score: item.score,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
      });
      return (await examDetail(ctx, examId))!;
    },

    async publishExam(ctx, id, published) {
      const policies = await assertExamInScope(ctx, 'publish', id);
      const manage = await assertExamInScope(ctx, 'manage', id).catch(
        () => undefined,
      );
      if (!manage) throw new HrError('FORBIDDEN', 403);
      const exam = (await examRow(id))!;
      if (published) {
        if (!bool(exam.active)) throw new HrError('EXAM_INACTIVE', 409);
        if (String(exam.paperMode) === 'fixed') {
          const paper = await fixedPaper(id);
          if (!paper.length) throw new HrError('EXAM_QUESTIONS_INVALID', 409);
          const rows = await loadQuestionRows(paper.map((p) => p.questionId));
          if (
            rows.some((r) => r.reviewStatus !== 'confirmed' || !bool(r.active))
          )
            throw new HrError('QUESTION_NOT_CONFIRMED', 409);
        } else {
          const rules = json<RandomRule[]>(exam.randomRules, []);
          const shortages: {
            index: number;
            available: number;
            count: number;
          }[] = [];
          for (const [index, rule] of rules.entries()) {
            const available = (await candidatesFor(rule)).length;
            if (available < rule.count)
              shortages.push({ index, available, count: rule.count });
          }
          if (!rules.length) throw new HrError('EXAM_RULES_INVALID', 409);
          if (shortages.length)
            throw new HrError('EXAM_RULE_SHORTAGE', 409, { rules: shortages });
        }
      }
      await database
        .repository('exams')
        .withPolicy(policyOf(policies, 'exams'))
        .updateOne({
          filter: { id },
          values: { published, updatedAt: new Date() },
        });
      return (await examDetail(ctx, id))!;
    },

    async previewPaper(ctx, id) {
      await assertExamInScope(ctx, 'manage', id);
      const exam = (await examRow(id))!;
      const items = await buildPaper(exam);
      const rows = await loadQuestionRows(items.map((i) => i.questionId));
      return {
        items: items.map((item) => ({
          ...item,
          answer: json<unknown>(
            rows.find((r) => String(r.id) === item.questionId)?.answer,
            null,
          ),
        })),
        totalScore: items.reduce((sum, i) => sum + i.score, 0),
      };
    },

    async ruleAvailability(ctx, rules) {
      await authorizeAction(ctx.authz, EXAM, 'manage');
      return Promise.all(
        parseRules(rules).map(
          async (rule) => (await candidatesFor(rule)).length,
        ),
      );
    },

    // ---------- Candidate ----------
    async myExams(ctx) {
      await authorizeAction(ctx.authz, TAKING, 'viewResult');
      const employee = await ownEmployee(ctx);
      const query = database.query();
      const assigned = await query
        .selectFrom('assignments')
        .select(['examId'])
        .where('employeeId', '=', employee.id)
        .where('status', '!=', 'cancelled')
        .where('examId', 'is not', null)
        .execute();
      // Every enabled certification may be sat, but only the relevant ones are listed here: those whose competency
      // the position requires, and those the candidate holds or has held. Others start from the certification page,
      // and once started they are listed through their attempts.
      const positionCompetencies = employee.positionId
        ? (
            await query
              .selectFrom('positionRequirements')
              .select(['competencyId'])
              .where('positionId', '=', employee.positionId)
              .where('reviewStatus', '=', 'confirmed')
              .execute()
          ).map((r) => str(r.competencyId))
        : [];
      const held = (
        await query
          .selectFrom('employeeCertificates')
          .select(['certificationId'])
          .where('employeeId', '=', employee.id)
          .execute()
      ).map((r) => str(r.certificationId));
      const certificationRows = await query
        .selectFrom('certificationExams')
        .innerJoin(
          'certifications',
          'certifications.id',
          'certificationExams.certificationId',
        )
        .select([
          'certificationExams.examId as examId',
          'certifications.id as certificationId',
          'certifications.competencyId as competencyId',
        ])
        .where('certifications.active', '=', true)
        .execute();
      const required = certificationRows.filter(
        (r) =>
          held.includes(str(r.certificationId)) ||
          (r.competencyId != null &&
            positionCompetencies.includes(str(r.competencyId))),
      );
      const attempted = await query
        .selectFrom('examAttempts')
        .select(['examId'])
        .where('employeeId', '=', employee.id)
        .where('status', '!=', 'voided')
        .execute();
      const examIds = [
        ...new Set(
          [...assigned, ...required, ...attempted].map((r) => str(r.examId)),
        ),
      ];
      const result: MyExam[] = [];
      for (const examId of examIds) {
        const exam = await examRow(examId);
        if (!exam || !bool(exam.published) || !bool(exam.active)) continue;
        const { sources, recertAssignmentId, dueDate } = await eligibility(
          employee.id,
          examId,
        );
        const attempts = await countedAttempts(
          employee.id,
          examId,
          recertAssignmentId,
        );
        const all = await query
          .selectFrom('examAttempts')
          .select(['id', 'status', 'score', 'attemptNo', 'createdAt'])
          .where('employeeId', '=', employee.id)
          .where('examId', '=', examId)
          .where('status', '!=', 'voided')
          .orderBy('createdAt', 'desc')
          .execute();
        const scores = all
          .map((a) => (a.score == null ? null : Number(a.score)))
          .filter((s): s is number => s !== null);
        const inProgress = all.find((a) => a.status === 'inProgress');
        const latest = all[0];
        const passedNow = recertAssignmentId
          ? attempts.some((a) => a.status === 'passed')
          : all.some((a) => a.status === 'passed');
        const bucket = inProgress
          ? 'todo'
          : passedNow
            ? 'passed'
            : attempts.some((a) => a.status === 'grading')
              ? 'grading'
              : attempts.length >= Number(exam.maxAttempts)
                ? 'failed'
                : attempts.length && !recertAssignmentId
                  ? 'failed'
                  : 'todo';
        result.push({
          examId,
          title: String(exam.title),
          description: exam.description == null ? null : str(exam.description),
          durationMinutes: Number(exam.durationMinutes),
          passScore: Number(exam.passScore),
          maxAttempts: Number(exam.maxAttempts),
          attemptsUsed: attempts.length,
          remainingAttempts: Math.max(
            0,
            Number(exam.maxAttempts) - attempts.length,
          ),
          bestScore: scores.length ? Math.max(...scores) : null,
          bucket:
            bucket === 'failed' && attempts.length < Number(exam.maxAttempts)
              ? 'failed'
              : bucket,
          inProgressAttemptId: inProgress ? String(inProgress.id) : null,
          latestAttemptId: latest ? String(latest.id) : null,
          dueDate,
          sources,
        });
      }
      return result;
    },

    async startAttempt(ctx, examId, deviceToken, locale) {
      const policies = await authorizeAction(ctx.authz, TAKING, 'start');
      const employee = await ownEmployee(ctx);
      const exam = await examRow(examId);
      if (!exam || !bool(exam.published) || !bool(exam.active))
        throw new HrError('EXAM_NOT_AVAILABLE', 404);
      const { sources, recertAssignmentId } = await eligibility(
        employee.id,
        examId,
      );
      if (!sources.length) throw new HrError('EXAM_NOT_AVAILABLE', 403);
      // Refreshing the page returns to the same attempt.
      const open = await database
        .query()
        .selectFrom('examAttempts')
        .selectAll()
        .where('employeeId', '=', employee.id)
        .where('examId', '=', examId)
        .where('status', '=', 'inProgress')
        .executeTakeFirst();
      if (open) {
        if (
          new Date(String(iso(open.deadlineAt))).getTime() + SUBMIT_GRACE_MS <
          Date.now()
        ) {
          await finalize(String(open.id), undefined);
        } else {
          return toAttemptView(
            open,
            exam,
            await takeOver(open, exam, deviceToken),
          );
        }
      }
      const attempts = await countedAttempts(
        employee.id,
        examId,
        recertAssignmentId,
      );
      if (!recertAssignmentId && attempts.some((a) => a.status === 'passed'))
        throw new HrError('EXAM_ALREADY_PASSED', 409);
      if (attempts.some((a) => a.status === 'grading'))
        throw new HrError('EXAM_AWAITING_GRADING', 409);
      if (attempts.length >= Number(exam.maxAttempts))
        throw new HrError('EXAM_NO_ATTEMPTS_LEFT', 409);
      const items = await buildPaper(exam, undefined, locale);
      const started = new Date();
      const deadline = new Date(
        started.getTime() + Number(exam.durationMinutes) * 60_000,
      );
      const allNos = await database
        .query()
        .selectFrom('examAttempts')
        .select(['attemptNo'])
        .where('employeeId', '=', employee.id)
        .where('examId', '=', examId)
        .execute();
      const attemptNo =
        allNos.reduce((max, r) => Math.max(max, Number(r.attemptNo)), 0) + 1;
      const id = newId();
      const issuedToken = newId();
      await database
        .repository('examAttempts')
        .withPolicy(policyOf(policies, 'examAttempts'))
        .createOne({
          values: {
            id,
            examId,
            employeeId: employee.id,
            assignmentId: recertAssignmentId,
            attemptNo,
            paperSnapshot: JSON.stringify(items),
            answers: JSON.stringify({}),
            startedAt: started,
            deadlineAt: deadline,
            submittedAt: null,
            objectiveScore: null,
            subjectiveScore: null,
            score: null,
            status: 'inProgress',
            gradedBy: null,
            itemResults: null,
            blurCount: 0,
            integrityFlags: null,
            deviceToken: issuedToken,
            createdAt: started,
            updatedAt: started,
          },
        });
      // An assignment becomes "in progress" once its exam is started.
      await database
        .query()
        .updateTable('assignments')
        .set({ status: 'inProgress', updatedAt: started })
        .where('employeeId', '=', employee.id)
        .where('examId', '=', examId)
        .where('status', '=', 'notStarted')
        .execute();
      const row = (await database
        .query()
        .selectFrom('examAttempts')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst()) as Record<string, unknown>;
      return toAttemptView(row, exam, issuedToken);
    },

    async getAttempt(ctx, attemptId, deviceToken) {
      const { row } = await loadOwnAttempt(ctx, 'save', attemptId);
      const exam = (await examRow(String(row.examId)))!;
      if (
        row.status === 'inProgress' &&
        new Date(String(iso(row.deadlineAt))).getTime() + SUBMIT_GRACE_MS <
          Date.now()
      ) {
        await finalize(attemptId, undefined);
        const fresh = (await database
          .query()
          .selectFrom('examAttempts')
          .selectAll()
          .where('id', '=', attemptId)
          .executeTakeFirst()) as Record<string, unknown>;
        return toAttemptView(fresh, exam);
      }
      return toAttemptView(
        row,
        exam,
        row.status === 'inProgress'
          ? await takeOver(row, exam, deviceToken)
          : null,
      );
    },

    async saveAnswers(ctx, attemptId, answers, deviceToken) {
      const { row, policies } = await loadOwnAttempt(ctx, 'save', attemptId);
      if (row.status !== 'inProgress') throw new HrError('ATTEMPT_CLOSED', 409);
      await assertDevice(
        row,
        (await examRow(String(row.examId)))!,
        deviceToken,
      );
      const deadline = new Date(String(iso(row.deadlineAt))).getTime();
      if (deadline + SUBMIT_GRACE_MS < Date.now()) {
        await finalize(attemptId, undefined);
        throw new HrError('ATTEMPT_EXPIRED', 409);
      }
      const clean = cleanAnswers(
        json<PaperItem[]>(row.paperSnapshot, []),
        answers,
      );
      const stamp = new Date();
      await database
        .repository('examAttempts')
        .withPolicy(policyOf(policies, 'examAttempts'))
        .updateOne({
          filter: { id: attemptId, status: 'inProgress' },
          values: { answers: JSON.stringify(clean), updatedAt: stamp },
        });
      return { savedAt: stamp.toISOString(), deadlineAt: iso(row.deadlineAt)! };
    },

    async submitAttempt(ctx, attemptId, answers, deviceToken) {
      const { row } = await loadOwnAttempt(ctx, 'submit', attemptId);
      if (row.status !== 'inProgress') throw new HrError('ATTEMPT_CLOSED', 409);
      await assertDevice(
        row,
        (await examRow(String(row.examId)))!,
        deviceToken,
      );
      const deadline = new Date(String(iso(row.deadlineAt))).getTime();
      if (deadline + SUBMIT_GRACE_MS < Date.now()) {
        // Answers sent after the deadline are refused; the attempt is scored with what was saved in time.
        await finalize(attemptId, undefined);
        throw new HrError('ATTEMPT_EXPIRED', 409);
      }
      await finalize(
        attemptId,
        cleanAnswers(json<PaperItem[]>(row.paperSnapshot, []), answers),
      );
      return service.attemptResult(ctx, attemptId);
    },

    async attemptResult(ctx, attemptId) {
      const { row } = await loadOwnAttempt(ctx, 'viewResult', attemptId);
      if (row.status === 'inProgress')
        throw new HrError('ATTEMPT_NOT_SUBMITTED', 409);
      return toResult(row);
    },

    // ---------- Grading ----------
    async listGrading(ctx, examId) {
      const policies = await authorizeAction(ctx.authz, EXAM, 'grade');
      const exams = (await database
        .repository('exams')
        .withPolicy(policyOf(policies, 'exams'))
        .findMany({
          filter: (f) => f.and(examId ? [f.string('id').eq(examId)] : []),
        })) as Record<string, unknown>[];
      if (!exams.length) return [];
      const own = await platform.employeeOfUser(ctx.userId);
      const rows = (await database
        .repository('examAttempts')
        .withPolicy(policyOf(policies, 'examAttempts'))
        .findMany({
          filter: (f) =>
            f.and([
              f.string('status').eq('grading'),
              f.or(exams.map((e) => f.string('examId').eq(String(e.id)))),
            ]),
          sort: (s) => [s.field('submittedAt').asc()],
        })) as Record<string, unknown>[];
      // A grader never grades their own attempt.
      return Promise.all(
        rows
          .filter((r) => !own || String(r.employeeId) !== own.id)
          .map((r) => toResult(r, { forGrader: true })),
      );
    },

    async gradeAttempt(ctx, attemptId, input) {
      const policies = await authorizeAction(ctx.authz, EXAM, 'grade');
      const row = (await database
        .repository('examAttempts')
        .withPolicy(policyOf(policies, 'examAttempts'))
        .findOne({ filter: { id: attemptId } })) as
        Record<string, unknown> | undefined;
      if (!row) throw new HrError('ATTEMPT_NOT_FOUND', 404);
      if (
        !(await database
          .repository('exams')
          .withPolicy(policyOf(policies, 'exams'))
          .findOne({ filter: { id: String(row.examId) } }))
      )
        throw new HrError('ATTEMPT_NOT_FOUND', 404);
      const own = await platform.employeeOfUser(ctx.userId);
      if (own && String(row.employeeId) === own.id)
        throw new HrError('GRADE_OWN_ATTEMPT', 403);
      if (row.status !== 'grading')
        throw new HrError('ATTEMPT_NOT_GRADING', 409);
      if (!isRecord(input) || !Array.isArray(input.items))
        throw new HrError('INVALID_INPUT', 400);
      const items = json<PaperItem[]>(row.paperSnapshot, []);
      const results = json<
        Record<
          string,
          {
            score: number | null;
            correct: boolean | null;
            comment: string | null;
          }
        >
      >(row.itemResults, {});
      const shorts = items.filter((i) => i.type === 'short');
      let subjective = 0;
      for (const item of shorts) {
        const graded = (input.items as unknown[]).find(
          (g) => isRecord(g) && g.questionId === item.questionId,
        ) as Record<string, unknown> | undefined;
        const score = Number(graded?.score);
        if (
          !graded ||
          !Number.isFinite(score) ||
          score < 0 ||
          score > item.score
        )
          throw new HrError('GRADE_SCORE_INVALID', 400, {
            questionId: item.questionId,
          });
        subjective += score;
        results[item.questionId] = {
          ...results[item.questionId],
          score,
          correct: score >= item.score,
          comment: requireString(graded.comment, 'INVALID_INPUT', {
            optional: true,
            max: 2000,
          }),
        };
      }
      const total = items.reduce((sum, i) => sum + i.score, 0);
      const earned = Number(row.objectiveScore ?? 0) + subjective;
      const score = total ? Math.round((earned / total) * 1000) / 10 : 0;
      const exam = (await examRow(String(row.examId)))!;
      const status = score >= Number(exam.passScore) ? 'passed' : 'failed';
      await database.transaction(async (connection) => {
        const stamp = new Date();
        await connection
          .repository('examAttempts')
          .withPolicy(policyOf(policies, 'examAttempts'))
          .updateOne({
            filter: { id: attemptId, status: 'grading' },
            values: {
              subjectiveScore: subjective,
              score,
              status,
              gradedBy: ctx.userId,
              itemResults: JSON.stringify(results),
              lossByCompetency: computeLoss(items, results),
              updatedAt: stamp,
            },
          });
        if (status === 'passed')
          await learning.completeExamAssignments(
            connection,
            String(row.employeeId),
            String(row.examId),
          );
      });
      const employee = await platform.employee(String(row.employeeId));
      if (employee?.userId)
        await notify({
          key: `attempt:${attemptId}:graded`,
          userIds: [employee.userId],
          message: status === 'passed' ? 'examPassed' : 'examFailed',
          params: { title: String(exam.title), score: String(score) },
          path: `/talent/my-exams/attempts/${attemptId}`,
        });
      if (status === 'passed') await afterPassed(attemptId);
      else await afterFailed(attemptId);
      const fresh = (await database
        .query()
        .selectFrom('examAttempts')
        .selectAll()
        .where('id', '=', attemptId)
        .executeTakeFirst()) as Record<string, unknown>;
      return toResult(fresh, { forGrader: true });
    },

    async resetAttempts(ctx, examId, employeeId) {
      const policies = await assertExamInScope(ctx, 'resetAttempts', examId);
      const rows = (await database
        .repository('examAttempts')
        .withPolicy(policyOf(policies, 'examAttempts'))
        .findMany({
          filter: (f) =>
            f.and([
              f.string('examId').eq(examId),
              f.string('employeeId').eq(employeeId),
              f.or([
                f.string('status').eq('failed'),
                f.string('status').eq('voided'),
              ]),
            ]),
        })) as Record<string, unknown>[];
      // Failed attempts and attempts voided after an integrity review, not yet reset.
      const counted = rows.filter(
        (r) =>
          r.resetAt == null && (r.status === 'failed' || r.voidReason != null),
      );
      if (!counted.length) throw new HrError('NOTHING_TO_RESET', 409);
      // They stay on record but no longer count against the limit.
      const stamp = new Date();
      for (const row of counted)
        await database
          .repository('examAttempts')
          .withPolicy(policyOf(policies, 'examAttempts'))
          .updateOne({
            filter: { id: String(row.id), status: String(row.status) },
            values: { status: 'voided', resetAt: stamp, updatedAt: stamp },
          });
      return { reset: counted.length };
    },

    async examCandidates(ctx, examId) {
      const policies = await assertExamInScope(ctx, 'grade', examId);
      const rows = (await database
        .repository('examAttempts')
        .withPolicy(policyOf(policies, 'examAttempts'))
        .findMany({
          filter: { examId },
          sort: (s) => [s.field('createdAt').desc()],
        })) as Record<string, unknown>[];
      const byEmployee = new Map<string, Record<string, unknown>[]>();
      for (const row of rows)
        byEmployee.set(String(row.employeeId), [
          ...(byEmployee.get(String(row.employeeId)) ?? []),
          row,
        ]);
      const result = [];
      for (const [employeeId, attempts] of byEmployee) {
        const counted = attempts.filter((a) => a.status !== 'voided');
        const scores = counted
          .map((a) => (a.score == null ? null : Number(a.score)))
          .filter((v): v is number => v !== null);
        const latest = attempts[0];
        result.push({
          employeeId,
          name: (await platform.employee(employeeId))?.name ?? '',
          attempts: counted.length,
          bestScore: scores.length ? Math.max(...scores) : null,
          status: counted.some((a) => a.status === 'passed')
            ? 'passed'
            : String(latest.status),
          latestAttemptId: String(latest.id),
        });
      }
      return result.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    },

    // ---------- V3-10 10B: anti-cheating ----------
    async recordIntegrity(ctx, attemptId, input, deviceToken) {
      const { row } = await loadOwnAttempt(ctx, 'save', attemptId);
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const type = requireEnum(
        input.type,
        ['blur', 'pasteAttempt'] as const,
        'INVALID_INPUT',
      );
      const exam = (await examRow(String(row.examId)))!;
      const antiCheat = resolveAntiCheat(exam.antiCheat);
      if (row.status !== 'inProgress')
        return {
          blurCount: Number(row.blurCount ?? 0),
          maxBlurCount: antiCheat.maxBlurCount,
          submitted: false,
        };
      await assertDevice(row, exam, deviceToken);
      const blurCount = Number(row.blurCount ?? 0) + (type === 'blur' ? 1 : 0);
      await appendFlag(
        attemptId,
        {
          type,
          at: new Date().toISOString(),
          detail:
            type === 'blur'
              ? String(blurCount)
              : requireString(input.detail, 'INVALID_INPUT', {
                  optional: true,
                  max: 200,
                }),
        },
        type === 'blur' ? { blurCount } : {},
      );
      // Past the limit with blurAction = submit: scored with what was saved.
      let submitted = false;
      if (
        type === 'blur' &&
        blurCount > antiCheat.maxBlurCount &&
        antiCheat.blurAction === 'submit'
      )
        submitted = (await finalize(attemptId, undefined)) !== 'skipped';
      return { blurCount, maxBlurCount: antiCheat.maxBlurCount, submitted };
    },

    async listIntegrity(ctx, examId) {
      const policies = await assertExamInScope(ctx, 'reviewIntegrity', examId);
      const exam = (await examRow(examId))!;
      const antiCheat = resolveAntiCheat(exam.antiCheat);
      const rows = (await database
        .repository('examAttempts')
        .withPolicy(policyOf(policies, 'examAttempts'))
        .findMany({
          filter: { examId },
          sort: (s) => [s.field('submittedAt').desc()],
        })) as Record<string, unknown>[];
      const own = await platform.employeeOfUser(ctx.userId);
      return Promise.all(
        rows
          .filter(
            (r) =>
              r.status !== 'inProgress' &&
              (!own || String(r.employeeId) !== own.id) &&
              isFlagged(
                json<IntegrityFlag[]>(r.integrityFlags, []),
                Number(r.blurCount ?? 0),
                antiCheat,
              ),
          )
          .map((r) => toResult(r, { forGrader: true })),
      );
    },

    async reviewIntegrity(ctx, attemptId, input) {
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const decision = requireEnum(
        input.decision,
        ['valid', 'void'] as const,
        'INVALID_INPUT',
      );
      const policies = await authorizeAction(
        ctx.authz,
        EXAM,
        decision === 'void' ? 'voidAttempt' : 'reviewIntegrity',
      );
      const row = (await database
        .repository('examAttempts')
        .withPolicy(policyOf(policies, 'examAttempts'))
        .findOne({ filter: { id: attemptId } })) as
        Record<string, unknown> | undefined;
      if (!row) throw new HrError('ATTEMPT_NOT_FOUND', 404);
      await assertExamInScope(ctx, 'reviewIntegrity', String(row.examId));
      const own = await platform.employeeOfUser(ctx.userId);
      if (own && String(row.employeeId) === own.id)
        throw new HrError('GRADE_OWN_ATTEMPT', 403);
      if (row.status === 'inProgress' || row.status === 'voided')
        throw new HrError('ATTEMPT_NOT_REVIEWABLE', 409);
      const stamp = new Date();
      if (decision === 'void') {
        const reason = requireString(input.reason, 'VOID_REASON_REQUIRED', {
          max: 1000,
        });
        if (!reason) throw new HrError('VOID_REASON_REQUIRED', 400);
        // A pass a certificate was issued on is not voided here: HR revokes the certificate first.
        if (row.status === 'passed') {
          const cited = await database
            .query()
            .selectFrom('employeeCertificates')
            .select(['id', 'evidence'])
            .where('employeeId', '=', String(row.employeeId))
            .execute();
          if (
            cited.some((c) =>
              json<{ attemptIds?: string[] }>(
                c.evidence,
                {},
              ).attemptIds?.includes(attemptId),
            )
          )
            throw new HrError('ATTEMPT_CERTIFIED', 409);
        }
        await database
          .repository('examAttempts')
          .withPolicy(policyOf(policies, 'examAttempts'))
          .updateOne({
            filter: { id: attemptId, status: String(row.status) },
            values: {
              status: 'voided',
              voidReason: reason,
              integrityReview: 'voided',
              updatedAt: stamp,
            },
          });
      } else {
        await database
          .repository('examAttempts')
          .withPolicy(policyOf(policies, 'examAttempts'))
          .updateOne({
            filter: { id: attemptId },
            values: { integrityReview: 'valid', updatedAt: stamp },
          });
      }
      if (input.resetAttempts === true)
        await service
          .resetAttempts(ctx, String(row.examId), String(row.employeeId))
          .catch((error: unknown) => {
            if (!(
              error instanceof HrError && error.code === 'NOTHING_TO_RESET'
            ))
              throw error;
          });
      const fresh = (await database
        .query()
        .selectFrom('examAttempts')
        .selectAll()
        .where('id', '=', attemptId)
        .executeTakeFirst()) as Record<string, unknown>;
      return toResult(fresh, { forGrader: true });
    },

    // ---------- V3-10 10B: the examiner ----------
    async gradingMaterial(ctx, attemptId) {
      const policies = await authorizeAction(ctx.authz, EXAM, 'grade');
      const row = (await database
        .repository('examAttempts')
        .withPolicy(policyOf(policies, 'examAttempts'))
        .findOne({ filter: { id: attemptId } })) as
        Record<string, unknown> | undefined;
      if (!row) throw new HrError('ATTEMPT_NOT_FOUND', 404);
      // Only the exam's graders: its owner (instructors) or HR.
      await assertExamInScope(ctx, 'grade', String(row.examId));
      const own = await platform.employeeOfUser(ctx.userId);
      if (own && String(row.employeeId) === own.id)
        throw new HrError('GRADE_OWN_ATTEMPT', 403);
      const exam = (await examRow(String(row.examId)))!;
      const items = json<PaperItem[]>(row.paperSnapshot, []).filter(
        (i) => i.type === 'short',
      );
      const answers = json<Record<string, unknown>>(row.answers, {});
      const results = json<
        Record<string, { aiSuggestion?: GradingSuggestion }>
      >(row.itemResults, {});
      const questions = await loadQuestionRows(items.map((i) => i.questionId));
      return {
        attemptId,
        examTitle: String(exam.title),
        status: String(row.status),
        items: items.map((item) => {
          const question = questions.find(
            (q) => String(q.id) === item.questionId,
          );
          return {
            questionId: item.questionId,
            stem: item.stem,
            score: item.score,
            referenceAnswer: str(json<unknown>(question?.answer, '') ?? ''),
            gradingPoints:
              question?.gradingNotes == null
                ? null
                : str(question.gradingNotes),
            response:
              typeof answers[item.questionId] === 'string'
                ? (answers[item.questionId] as string)
                : '',
            aiSuggestion: results[item.questionId]?.aiSuggestion ?? null,
          };
        }),
      };
    },

    async saveGradingSuggestion(ctx, attemptId, input) {
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const material = await service.gradingMaterial(ctx, attemptId);
      if (material.status !== 'grading')
        throw new HrError('ATTEMPT_NOT_GRADING', 409);
      const questionId = requireString(input.questionId, 'INVALID_INPUT', {
        max: 64,
      })!;
      const item = material.items.find((i) => i.questionId === questionId);
      if (!item) throw new HrError('QUESTION_NOT_FOUND', 404);
      // One suggestion per answer: a repeated trigger never replaces it.
      if (item.aiSuggestion) return { saved: false };
      const score = Number(input.score);
      if (!Number.isFinite(score) || score < 0)
        throw new HrError('GRADE_SCORE_INVALID', 400);
      const points = (value: unknown) => {
        if (value === undefined || value === null) return [];
        if (
          !Array.isArray(value) ||
          value.length > 20 ||
          value.some((v) => typeof v !== 'string' || v.length > 500)
        )
          throw new HrError('INVALID_INPUT', 400);
        return value as string[];
      };
      const suggestion: GradingSuggestion = {
        // Never above the question's points.
        score: Math.min(item.score, Math.round(score * 2) / 2),
        matchedPoints: points(input.matchedPoints),
        missingPoints: points(input.missingPoints),
        rationale:
          requireString(input.rationale, 'INVALID_INPUT', { max: 2000 }) ?? '',
        at: new Date().toISOString(),
      };
      // Read and write in one statement pair on the query builder; the status and score stay as they are.
      const row = await database
        .query()
        .selectFrom('examAttempts')
        .select(['itemResults'])
        .where('id', '=', attemptId)
        .executeTakeFirst();
      const results = json<Record<string, Record<string, unknown>>>(
        row?.itemResults,
        {},
      );
      if (results[questionId]?.aiSuggestion) return { saved: false };
      results[questionId] = {
        score: null,
        correct: null,
        comment: null,
        ...results[questionId],
        aiSuggestion: suggestion,
      };
      await database
        .query()
        .updateTable('examAttempts')
        .set({ itemResults: results, updatedAt: new Date() })
        .where('id', '=', attemptId)
        .where('status', '=', 'grading')
        .execute();
      return { saved: true };
    },

    async explainResult(ctx, attemptId) {
      return service.attemptResult(ctx, attemptId);
    },

    async autoSubmitExpired() {
      const cutoff = Date.now() - SUBMIT_GRACE_MS;
      // Compared in code: a stored datetime and a bound Date do not compare reliably in every dialect (SQLite).
      const rows = (
        await database
          .query()
          .selectFrom('examAttempts')
          .select(['id', 'deadlineAt'])
          .where('status', '=', 'inProgress')
          .execute()
      )
        .filter((row) => new Date(iso(row.deadlineAt)!).getTime() < cutoff)
        .slice(0, 100);
      let count = 0;
      for (const row of rows)
        if ((await finalize(String(row.id), undefined)) !== 'skipped')
          count += 1;
      return count;
    },
  };

  return service;
}
