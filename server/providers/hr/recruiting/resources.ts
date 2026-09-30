/**
 * V2-07 权限配置: the recruiting business operations and their field grants.
 *
 * Sensitive data is split into its own actions so a grant decides it, not a
 * page: candidate contact data and the resume (`talent.candidate`
 * `viewContact`) and the offer salary (`talent.offer` `viewSalary`). The
 * seed grants `viewContact` to hr.recruiter only and `viewSalary` to
 * hr.recruiter, hr.payrollApprover and hr.payroll; hr.admin and hiring
 * managers hold neither. Interviewers and hiring managers need no permission
 * set of their own: the services add what the interview or requisition
 * record relates them to (a head holds hr.manager; any employee holds
 * `talent.interview` view/score through hr.employee, limited to the
 * interviews that name them).
 *
 * Record scope is decided in the services from the records themselves: a
 * recruiter works on the requisitions assigned to them (the talent pool is
 * read-only across requisitions), a head on the departments they manage.
 */
import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

import { label } from '../shared.js';

const PLAN_FIELDS = [
  'id',
  'departmentId',
  'positionId',
  'month',
  'plannedOutput',
  'currentOutput',
  'source',
  'calculation',
  'calculationHash',
  'options',
  'aiSummary',
  'aiSummaryHash',
  'decision',
  'requisitionId',
  'status',
  'pushedBy',
  'createdAt',
  'updatedAt',
];
const REQUISITION_FIELDS = [
  'id',
  'departmentId',
  'positionId',
  'headcount',
  'reason',
  'workforcePlanId',
  'replacingEmployeeId',
  'targetDate',
  'requirementsChecklist',
  'note',
  'requesterUserId',
  'hiringManagerUserId',
  'recruiterUserId',
  'status',
  'approvals',
  'hiredCount',
  'poolSuggestion',
  'openedAt',
  'filledAt',
  'createdAt',
  'updatedAt',
];
const POSTING_FIELDS = [
  'id',
  'requisitionId',
  'title',
  'description',
  'requirements',
  'location',
  'publicSlug',
  'channels',
  'status',
  'source',
  'reviewStatus',
  'knockoutQuestions',
  'interviewSlots',
  'selfBookingEnabled',
  'bookingTemplate',
  'aiInterviewEnabled',
  'aiInterviewPlan',
  'confirmedBy',
  'confirmedAt',
  'publishedAt',
  'closedAt',
  'createdAt',
  'updatedAt',
];
/** Everything but contact data and the resume file. */
export const CANDIDATE_BASE_FIELDS = [
  'id',
  'name',
  'parsedProfile',
  'parseConfidence',
  'parseStatus',
  'sourceChannel',
  'consentAt',
  'consentBy',
  'retentionUntil',
  'lastActivityAt',
  'anonymizedAt',
  'anonymizedBy',
  'customFields',
  'createdAt',
  'updatedAt',
];
export const CANDIDATE_CONTACT_FIELDS = [
  'id',
  'phone',
  'email',
  'resumeFileId',
];
const APPLICATION_FIELDS = [
  'id',
  'candidateId',
  'postingId',
  'stage',
  'sourceChannel',
  'screeningSuggestion',
  'screenedAt',
  'knockoutAnswers',
  'screeningDecision',
  'decidedBy',
  'decidedAt',
  'rejectRequirementKeys',
  'rejectNote',
  'stageHistory',
  'stageSince',
  'messages',
  'submitCount',
  'lastSubmittedAt',
  'aiInterviewDeclined',
  'createdAt',
  'updatedAt',
];
const INTERVIEW_FIELDS = [
  'id',
  'applicationId',
  'round',
  'mode',
  'scheduledAt',
  'durationMinutes',
  'locationOrLink',
  'interviewerUserIds',
  'questionPlan',
  'questionPlanAt',
  'scorecards',
  'aiSummary',
  'summaryAt',
  'status',
  'slotKey',
  'selfBooked',
  'changesUsed',
  'reminderSentAt',
  'scheduledBy',
  'consentAt',
  'transcript',
  'aiReport',
  'createdAt',
  'updatedAt',
];
/** Everything but the salary. */
export const OFFER_BASE_FIELDS = [
  'id',
  'applicationId',
  'positionId',
  'departmentId',
  'startDate',
  'probationMonths',
  'status',
  'approvals',
  'offerLetterFileId',
  'sentAt',
  'respondBy',
  'respondedAt',
  'responseChannel',
  'declineReason',
  'onboardActionId',
  'preboarding',
  'createdBy',
  'createdAt',
  'updatedAt',
];
export const OFFER_SALARY_FIELDS = ['id', 'salaryOffer', 'outOfRangeReason'];
const CHECK_IN_FIELDS = [
  'id',
  'employeeId',
  'day',
  'channel',
  'askedAt',
  'repliedAt',
  'answers',
  'issues',
  'status',
  'createdAt',
  'updatedAt',
];

const read = (collection: string, fields: string[]) =>
  defineDatabasePermission((p) => p.collection(collection).read(fields));
const write = (collection: string, fields: string[]) =>
  defineDatabasePermission((p) =>
    p.collection(collection).read(fields).create(fields).update(fields),
  );

const plans = read('workforcePlans', PLAN_FIELDS);
const plansWrite = write('workforcePlans', PLAN_FIELDS);
/** The ERP account writes plan numbers only; it reads nothing back but its own push result. */
const plansImport = defineDatabasePermission((p) =>
  p
    .collection('workforcePlans')
    .create(PLAN_FIELDS)
    .update([
      'plannedOutput',
      'currentOutput',
      'source',
      'calculation',
      'calculationHash',
      'options',
      'status',
      'pushedBy',
      'updatedAt',
    ]),
);
const requisitions = read('jobRequisitions', REQUISITION_FIELDS);
const requisitionsWrite = write('jobRequisitions', REQUISITION_FIELDS);
const postings = read('jobPostings', POSTING_FIELDS);
const postingsWrite = write('jobPostings', POSTING_FIELDS);
const candidates = read('candidates', CANDIDATE_BASE_FIELDS);
const candidatesContact = read('candidates', CANDIDATE_CONTACT_FIELDS);
const candidatesWrite = write('candidates', [
  ...CANDIDATE_BASE_FIELDS,
  ...CANDIDATE_CONTACT_FIELDS.slice(1),
]);
const applications = read('applications', APPLICATION_FIELDS);
const applicationsWrite = write('applications', APPLICATION_FIELDS);
const interviews = read('interviews', INTERVIEW_FIELDS);
const interviewsWrite = write('interviews', INTERVIEW_FIELDS);
const offers = read('offers', OFFER_BASE_FIELDS);
const offersSalary = read('offers', OFFER_SALARY_FIELDS);
const offersWrite = write('offers', [
  ...OFFER_BASE_FIELDS,
  ...OFFER_SALARY_FIELDS.slice(1),
]);
const checkIns = read('newHireCheckIns', CHECK_IN_FIELDS);

const t = (key: string) => label(`recruiting.authz.${key}`);

export const workforcePlanResource = defineCompositeResource(
  'talent.workforcePlan',
  (r) =>
    r
      .title(t('workforcePlan.title'))
      .action('view', (a) =>
        a.title(t('actions.view')).grant('workforcePlans', plans),
      )
      .action('decide', (a) =>
        a.title(t('workforcePlan.decide')).grant('workforcePlans', plansWrite),
      )
      .action('import', (a) =>
        a.title(t('workforcePlan.import')).grant('workforcePlans', plansImport),
      ),
);

export const requisitionResource = defineCompositeResource(
  'talent.requisition',
  (r) =>
    r
      .title(t('requisition.title'))
      .action('view', (a) =>
        a.title(t('actions.view')).grant('jobRequisitions', requisitions),
      )
      .action('create', (a) =>
        a
          .title(t('requisition.create'))
          .grant('jobRequisitions', requisitionsWrite),
      )
      .action('approve', (a) =>
        a
          .title(t('requisition.approve'))
          .grant('jobRequisitions', requisitionsWrite),
      )
      .action('assignRecruiter', (a) =>
        a
          .title(t('requisition.assignRecruiter'))
          .grant('jobRequisitions', requisitionsWrite),
      ),
);

export const postingResource = defineCompositeResource('talent.posting', (r) =>
  r
    .title(t('posting.title'))
    .action('view', (a) =>
      a
        .title(t('actions.view'))
        .grant('jobPostings', postings)
        .grant('jobRequisitions', requisitions),
    )
    .action('manage', (a) =>
      a
        .title(t('actions.manage'))
        .grant('jobPostings', postingsWrite)
        .grant('jobRequisitions', requisitions),
    )
    .action('publish', (a) =>
      a.title(t('posting.publish')).grant('jobPostings', postingsWrite),
    ),
);

export const candidateResource = defineCompositeResource(
  'talent.candidate',
  (r) =>
    r
      .title(t('candidate.title'))
      .action('view', (a) =>
        a
          .title(t('actions.view'))
          .grant('candidates', candidates)
          .grant('applications', applications),
      )
      .action('viewContact', (a) =>
        a
          .title(t('candidate.viewContact'))
          .grant('candidates', candidatesContact),
      )
      .action('manage', (a) =>
        a
          .title(t('actions.manage'))
          .grant('candidates', candidatesWrite)
          .grant('applications', applicationsWrite),
      )
      .action('decide', (a) =>
        a
          .title(t('candidate.decide'))
          .grant('applications', applicationsWrite),
      )
      .action('anonymize', (a) =>
        a
          .title(t('candidate.anonymize'))
          .grant('candidates', candidatesWrite),
      ),
);

export const interviewResource = defineCompositeResource(
  'talent.interview',
  (r) =>
    r
      .title(t('interview.title'))
      .action('view', (a) =>
        a.title(t('actions.view')).grant('interviews', interviews),
      )
      .action('schedule', (a) =>
        a
          .title(t('interview.schedule'))
          .grant('interviews', interviewsWrite)
          .grant('applications', applicationsWrite),
      )
      .action('score', (a) =>
        a.title(t('interview.score')).grant('interviews', interviewsWrite),
      ),
);

export const offerResource = defineCompositeResource('talent.offer', (r) =>
  r
    .title(t('offer.title'))
    .action('view', (a) => a.title(t('actions.view')).grant('offers', offers))
    .action('viewSalary', (a) =>
      a.title(t('offer.viewSalary')).grant('offers', offersSalary),
    )
    .action('manage', (a) =>
      a.title(t('actions.manage')).grant('offers', offersWrite),
    )
    .action('approve', (a) =>
      a.title(t('offer.approve')).grant('offers', offersWrite),
    )
    .action('send', (a) => a.title(t('offer.send')).grant('offers', offersWrite))
    // hr.admin: turns an accepted offer into the onboarding action (工号由 HR 填写); no salary.
    .action('onboard', (a) =>
      a.title(t('offer.onboard')).grant('offers', offers),
    ),
);

export const recruitingReportResource = defineCompositeResource(
  'talent.recruitingReport',
  (r) =>
    r
      .title(t('report.title'))
      // Totals only: conversion, cycle time, channels, agreement.
      .action('view', (a) =>
        a
          .title(t('actions.view'))
          .grant('applications', read('applications', ['id', 'stage'])),
      )
      // Per requisition, for the requisitions the recruiter is responsible for.
      .action('detail', (a) =>
        a
          .title(t('report.detail'))
          .grant('applications', applications)
          .grant('jobRequisitions', requisitions),
      ),
);

export const recruitingSettingsResource = defineCompositeResource(
  'talent.recruitingSettings',
  (r) =>
    r
      .title(t('settings.title'))
      .action('manage', (a) =>
        a.title(t('actions.manage')).grant('jobPostings', postings),
      ),
);

export const newHireCheckInResource = defineCompositeResource(
  'talent.newHireCheckIn',
  (r) =>
    r
      .title(t('checkIn.title'))
      .action('view', (a) =>
        a.title(t('actions.view')).grant('newHireCheckIns', checkIns),
      ),
);

export const recruitingAssistantResource = defineCompositeResource(
  'talent.recruitingAssistant',
  (r) =>
    r
      .title(t('assistant.title'))
      .action('use', (a) =>
        a.title(t('assistant.use')).grant('applications', applications),
      )
      // Pause, owner, run time and run records of the recruiting assistant's work (hr.admin).
      .action('configure', (a) =>
        a.title(t('assistant.configure')).grant('jobPostings', postings),
      ),
);

export const RECRUITING_COMPOSITES = [
  workforcePlanResource,
  requisitionResource,
  postingResource,
  candidateResource,
  interviewResource,
  offerResource,
  recruitingReportResource,
  recruitingSettingsResource,
  newHireCheckInResource,
  recruitingAssistantResource,
] as const;

export const RECRUITING_COLLECTIONS: readonly { name: string; title: string }[] =
  [
    { name: 'workforcePlans', title: 'recruiting.collections.workforcePlans' },
    {
      name: 'jobRequisitions',
      title: 'recruiting.collections.jobRequisitions',
    },
    { name: 'jobPostings', title: 'recruiting.collections.jobPostings' },
    { name: 'candidates', title: 'recruiting.collections.candidates' },
    { name: 'applications', title: 'recruiting.collections.applications' },
    { name: 'interviews', title: 'recruiting.collections.interviews' },
    { name: 'offers', title: 'recruiting.collections.offers' },
    {
      name: 'newHireCheckIns',
      title: 'recruiting.collections.newHireCheckIns',
    },
  ];

/** The pages of the step (client/routes.ts declares them). */
export const RECRUITING_PAGES = {
  workforcePlans: 'talent.workforcePlans',
  requisitions: 'talent.requisitions',
  postings: 'talent.postings',
  candidates: 'talent.candidates',
  interviews: 'talent.interviews',
  offers: 'talent.offers',
  reports: 'talent.recruitingReports',
  settings: 'talent.recruitingSettings',
} as const;

export const COMPOSITE = {
  plan: 'talent.workforcePlan',
  requisition: 'talent.requisition',
  posting: 'talent.posting',
  candidate: 'talent.candidate',
  interview: 'talent.interview',
  offer: 'talent.offer',
  report: 'talent.recruitingReport',
  settings: 'talent.recruitingSettings',
  checkIn: 'talent.newHireCheckIn',
  assistant: 'talent.recruitingAssistant',
} as const;
