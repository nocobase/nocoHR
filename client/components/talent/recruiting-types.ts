/**
 * V2-07 招聘: the shapes the recruiting endpoints answer with (see
 * server/providers/hr/recruiting/*). Optional fields are the ones a viewer
 * may not receive (salary, contact data).
 */
import type { Requirement, Step, Suggestion } from './recruiting-lib';

export interface PlanOption {
  type: 'overtime' | 'transfer' | 'hire';
  feasible: boolean;
  detail: {
    hoursPerPerson?: number | null;
    limitHours?: number;
    maxHeadcount?: number;
    covers?: boolean;
    readyInWeeks?: number;
    readyInDays?: number;
  };
  risks: string[];
  costNote: string;
  note?: string | null;
}

export interface PlanCalculation {
  headcount: number;
  outputPerShift: number;
  shiftsPerMonth: number;
  hoursPerShift: number;
  capacity: number;
  plannedOutput: number;
  currentOutput: number | null;
  gapHeadcount: number;
  overtimeLimitHours: number;
  recruitingCycleDays: number;
  onboardingDays: number;
  absorbedOvertimeHours?: number | null;
  sources?: { overtimeLimit?: string; onboarding?: string };
}

export interface Plan {
  id: string;
  month: string;
  departmentTitle: string;
  positionTitle: string;
  plannedOutput: number;
  status: string;
  calculation: PlanCalculation | null;
  options: PlanOption[];
  aiSummary: string | null;
  decision: { types: string[]; note: string | null } | null;
  requisitionId: string | null;
  calculationHash?: string;
  can?: { decide?: boolean; recalculate?: boolean; settings?: boolean };
}

export interface ChecklistItem {
  type: string;
  text: string;
  mustHave: boolean;
}

export interface Requisition {
  id: string;
  departmentId: string;
  positionId: string;
  departmentTitle: string;
  positionTitle: string;
  responsibilities: string | null;
  jobFamily: string | null;
  grade: string | null;
  headcount: number;
  hiredCount: number;
  reason: 'newHeadcount' | 'replacement';
  targetDate: string;
  requirementsChecklist: ChecklistItem[];
  workforcePlanId: string | null;
  status: string;
  approvals: Step[];
  hiringManagerName: string | null;
  recruiterName: string | null;
  poolSuggestion: {
    candidates: { candidateId: string; name: string; reason: string }[];
  } | null;
  postings?: {
    id: string;
    title: string;
    status: string;
    reviewStatus: string;
  }[];
  can?: {
    edit?: boolean;
    approve?: boolean;
    assignRecruiter?: boolean;
    pickRecruiter?: boolean;
  };
}

export interface KnockoutQuestion {
  key: string;
  question: string;
  answerType: 'yesNo' | 'choice' | 'shortText';
  options?: string[] | null;
  requirementKey: string;
  expected?: string | null;
}

export interface Slot {
  start: string;
  end: string;
  capacity: number;
  location: string | null;
  interviewerUserIds: string[];
  booked?: number;
}

export interface Channel {
  name: string;
  link?: string | null;
  postedAt?: string | null;
}

export interface Posting {
  id: string;
  title: string;
  description: string;
  location: string;
  requirements: Requirement[];
  knockoutQuestions: KnockoutQuestion[];
  interviewSlots: Slot[];
  channels: Channel[];
  status: string;
  reviewStatus: string;
  publicSlug: string | null;
  selfBookingEnabled: boolean;
  bookingTemplate: { subject: string; body: string } | null;
  aiInterviewEnabled: boolean;
  aiInterviewPlan: {
    status: string;
    questions: { question: string; lookFor: string }[];
  } | null;
  applicationCount?: number;
  requisition?: { departmentTitle: string };
  can?: { manage?: boolean; publish?: boolean };
}

export interface ApplicationListItem {
  id: string;
  name: string;
  stage: string;
  matchLevel: string | null;
  knockoutUnmet: boolean;
  sourceChannel: string;
  postingTitle: string;
}

export interface ParsedProfile {
  education: { level: string; school?: string | null; major?: string | null }[];
  experiences: {
    summary: string;
    years?: number | null;
    keywords?: string[];
  }[];
  skills: string[];
  certificates: string[];
}

export interface CandidateMessage {
  id: string;
  type: string;
  subject: string;
  body: string;
  status: 'draft' | 'sent' | 'discarded';
  delivery?: string | null;
}

export interface CustomFieldDefinition {
  key: string;
  label: { 'zh-CN'?: string; 'en-US'?: string | null } | null;
  type: string;
  required?: boolean;
}

export interface ApplicationDetail {
  id: string;
  stage: string;
  submitCount: number;
  knockoutUnmet: boolean;
  knockoutAnswers: {
    key: string;
    answer: string;
    meetsExpected: boolean | null;
  }[];
  screeningSuggestion: Suggestion | null;
  messages: CandidateMessage[];
  stageHistory: { from: string | null; to: string; at: string }[];
  interviews: {
    id: string;
    round: number;
    mode: string;
    scheduledAt: string;
    status: string;
  }[];
  offers: { id: string; status: string; startDate: string }[];
  customFieldDefinitions: CustomFieldDefinition[];
  candidate: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    resumeAvailable: boolean;
    parsedProfile: ParsedProfile | null;
    parseStatus: string;
    sourceChannel: string;
    /** The site that forwarded the resume to the recruiting mailbox (渠道名称). */
    sourceName?: string | null;
    consentAt: string | null;
    retentionUntil: string | null;
    anonymizedAt?: string | null;
    /** V2-07 删除申请: when the candidate asked to be deleted through the receipt's link. */
    deletionRequestedAt?: string | null;
    customFields: Record<string, unknown>;
  };
  posting: {
    id: string;
    title: string;
    requirements: Requirement[];
    knockoutQuestions: { key: string; question: string }[];
  };
  requisition: { id: string; departmentTitle: string };
  can: {
    manage?: boolean;
    decide?: boolean;
    contact?: boolean;
    anonymize?: boolean;
    schedule?: boolean;
    offer?: boolean;
  };
}

export interface InterviewListItem {
  id: string;
  round: number;
  mode: string;
  scheduledAt: string;
  status: string;
  candidateName: string;
  postingTitle: string;
  selfBooked: boolean;
  interviewerCount: number;
  submittedCount: number;
}

export interface Scorecard {
  userId: string;
  requirementScores: {
    requirementKey: string;
    score: number;
    evidence?: string | null;
  }[];
  recommendation: string;
  notes?: string | null;
}

export interface QuestionPlanItem {
  requirementKey: string;
  question: string;
  lookFor: string;
  followUps?: string[];
}

export interface InterviewDetailData {
  id: string;
  round: number;
  mode: string;
  scheduledAt: string;
  locationOrLink: string | null;
  status: string;
  interviewers: { userId: string; name: string; submitted: boolean }[];
  questionPlan: QuestionPlanItem[] | null;
  scorecards: Scorecard[];
  mine: Scorecard | null;
  aiSummary: {
    text?: string;
    byRequirement?: {
      requirementKey: string;
      text: string;
      scores: { name: string; score: number }[];
    }[];
    divergences?: string[];
    toVerify?: string[];
  } | null;
  candidate: { name: string; parsedProfile: ParsedProfile | null };
  posting: { title: string; requirements: Requirement[] };
  can: { manage?: boolean; editPlan?: boolean; score?: boolean };
}

export interface Offer {
  id: string;
  candidateName: string;
  positionTitle: string;
  departmentTitle: string;
  startDate: string;
  probationMonths: number;
  status: string;
  approvals: Step[];
  respondBy: string | null;
  hasLetter: boolean;
  onboardActionId: string | null;
  salaryOffer: { baseSalary: number } | null;
  outOfRangeReason: string | null;
  payRange: { range: { min: number; max: number } | null } | null;
  preboarding: {
    remindersSent: { day: number }[];
    arrivalConfirmedAt: string | null;
    uploads: { kind: string }[];
  };
  can: {
    submit?: boolean;
    approve?: boolean;
    send?: boolean;
    record?: boolean;
    withdraw?: boolean;
    onboard?: boolean;
    salary?: boolean;
  };
}

export interface OfferPreview {
  to: string | null;
  subject: string;
  body: string;
  preboardingTemplate: { subject: string; body: string };
}

export interface StructureOption {
  id: string;
  title: string;
  applies: boolean;
  range: { min: number; max: number } | null;
  allowances: { code: string; title: string }[];
}

export interface OnboardDraft {
  onboardActionId: string | null;
  draft: {
    name?: string;
    mobile?: string | null;
    email?: string | null;
    effectiveDate?: string;
    probationMonths?: number;
    /** Estimated from the resume's work years; HR may correct it. */
    careerStartDate?: string | null;
  };
  departmentTitle: string;
  positionTitle: string;
  suggestions: {
    id: string;
    kind: string;
    status: string;
    reason?: string | null;
    fields: Record<string, { value: string; confidence: number }>;
  }[];
}

export interface Report {
  scope: 'mine' | 'summary';
  funnel: { stage: string; count: number; rate: number | null }[];
  averageDaysToHire: number | null;
  hires: number;
  channels: { name: string; applications: number; hired: number }[];
  screening: { decided: number; agreed: number; agreementRate: number | null };
  interviews: { held: number; attended: number; attendanceRate: number | null };
  aiInterview: {
    compared: number;
    averageScoreWhenAdvanced: number | null;
    averageScoreWhenNot: number | null;
  };
}

export interface PublicJob {
  slug: string;
  title: string;
  description: string;
  location: string;
  requirements: { text: string; mustHave: boolean }[];
  questions: {
    key: string;
    question: string;
    answerType: string;
    options: string[];
  }[];
  selfBooking: boolean;
  maxResumeMb: number;
  consentText: string;
  fields: CustomFieldDefinition[];
}

export interface PublicSlot {
  start: string;
  location: string | null;
  label: string;
}

export interface ApplyResult {
  merged: boolean;
  bookingToken: string | null;
  slots: PublicSlot[];
}

export interface BookingView {
  title: string;
  booked: { label: string; location: string | null; canChange: boolean } | null;
  slots: PublicSlot[];
}

export interface PublicOffer {
  name: string;
  position: string;
  department: string;
  startDate: string;
  probationMonths: number;
  status: string;
  expired: boolean;
  hasLetter: boolean;
  preboarding: {
    arrivalConfirmedAt: string | null;
    uploads: { kind: string }[];
    kinds: string[];
  } | null;
}

export interface AiInterviewView {
  title: string;
  minutes: number;
  declined: boolean;
  consentAt: string | null;
  finished: boolean;
  transcript: { role: 'assistant' | 'candidate'; text: string; at: string }[];
  next: string | null;
}

export interface CapacityRow {
  departmentId: string;
  positionId: string;
  outputPerShift: number;
  shiftsPerMonth: number;
  hoursPerShift: number;
}

export interface TransferRow {
  departmentId: string;
  maxHeadcount: number;
  coordinatorUserId: string | null;
}

export interface ApprovalRow {
  departmentId: string;
  name: string;
  approverUserId: string;
}

export interface RecruitingSettingsValue {
  publicPage: { enabled: boolean; ipLimitPerHour: number; maxResumeMb: number };
  retention: { months: number };
  reminders: {
    stageStaleDays: number;
    offerRespondDays: number;
    preboardingDays: number[];
    escalateDaysBefore: number;
  };
  approvals: { requisitionExtra: ApprovalRow[] };
  workforce: {
    capacity: CapacityRow[];
    transferLimits: TransferRow[];
    recruitingCycleDays: number;
    absorbOvertimeHours: number;
    onboardingDays: number;
  };
  checkIns: {
    days: number[];
    noReplyDays: number;
    questions: string[];
    routing: Partial<Record<string, string>>;
  };
  interviews: { freeShiftCodes: string[] };
  assistant: { bulkHeadcount: number; poolLimit: number };
  email: { channel: string; redirectTo: string | null };
  templates: Partial<Record<string, { subject: string; body: string } | null>>;
}
