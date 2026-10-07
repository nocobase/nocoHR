import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
  type AppClientRouteComponentLoader,
} from '@nocobase/app-client/plugins';
import { describe, expect, it } from 'vitest';

import applicationRoutes from '../../client/routes.ts';

describe('app client routes', () => {
  it('keeps the landing page and the authentication pages', () => {
    // The authentication plugin and this application have to agree on these paths: it sends an unknown visitor to
    // /login, sends a signed-in user who opens a guest page back to /, and mails a reset link to /reset-password,
    // while the sign-in form links to /register and /forgot-password. Only their presence is asserted, so a page the
    // application adds is not a defect. Whether these four are guest pages is not checked here either: app-client
    // refuses any route that claims one of those paths without `auth: 'guest'`.
    expect(pagePaths(resolveRoutes().routes)).toEqual(
      expect.arrayContaining([
        '/',
        '/login',
        '/register',
        '/forgot-password',
        '/reset-password',
      ]),
    );
  });

  it('loads every page component', async () => {
    const resolved = resolveRoutes();
    const loaders = [
      ...componentLoadersIn(resolved.routes),
      ...componentLoadersIn(resolved.settingsRouteTree),
      ...componentLoadersIn(resolved.devRouteTree),
    ];
    // The trees above are filtered by loader, so an empty list would make the loop below pass without loading
    // anything at all.
    expect(loaders).not.toHaveLength(0);

    for (const componentLoader of loaders) {
      // The registered loader is already the wrapped one, so awaiting it holds every page to the contract that its
      // module default-exports a component. A page that moved or lost its default export fails here.
      await expect(componentLoader()).resolves.toMatchObject({
        default: expect.any(Function),
      });
    }
  });

  it('pins the page authorization of every signed-in page', () => {
    // A stored page grant records the page's `authz` resource id (`authorizedAs`), not its route `name`: changing an
    // id is a data change that has to migrate the grants that reference it, not a refactor — so changing this list
    // deliberately is the point. A new page that requires sign-in adds an entry here, because a page that checks
    // access is a new grant somebody has to be given.
    const resolved = resolveRoutes();

    // The landing page opted out of page authorization, so it is reachable by every signed-in user.
    // The talent pages each carry their own page grant; nested pages inherit the grant of their first page.
    expect(pageAuthorizations(resolved.routes)).toEqual([
      { name: 'home', authorizedAs: null },
      // 通知 (站内信): every signed-in user's own inbox, like the landing page.
      { name: 'talent-inbox', authorizedAs: null },
      { name: 'talent-workbench', authorizedAs: 'talent.workbench' },
      { name: 'talent-me', authorizedAs: 'talent.me' },
      { name: 'talent-me-leave-new', authorizedAs: 'talent.me' },
      { name: 'talent-me-leave-edit', authorizedAs: 'talent.me' },
      { name: 'talent-me-assistant', authorizedAs: 'talent.me' },
      { name: 'talent-me-leave-detail', authorizedAs: 'talent.me' },
      { name: 'talent-me-missing-punch', authorizedAs: 'talent.me' },
      { name: 'talent-me-overtime', authorizedAs: 'talent.me' },
      { name: 'talent-me-shift-swap', authorizedAs: 'talent.me' },
      { name: 'talent-me-exception', authorizedAs: 'talent.me' },
      { name: 'talent-me-adjustment-detail', authorizedAs: 'talent.me' },
      { name: 'talent-self-service', authorizedAs: 'talent.selfService' },
      { name: 'talent-employees', authorizedAs: 'talent.employees' },
      { name: 'talent-employee-new', authorizedAs: 'talent.employees' },
      { name: 'talent-employee-import', authorizedAs: 'talent.employees' },
      { name: 'talent-employee-changes', authorizedAs: 'talent.employees' },
      { name: 'talent-employee-detail', authorizedAs: 'talent.employees' },
      { name: 'talent-employee-profile', authorizedAs: 'talent.employees' },
      {
        name: 'talent-employee-correct-job',
        authorizedAs: 'talent.employees',
      },
      { name: 'talent-employee-abilities', authorizedAs: 'talent.employees' },
      { name: 'talent-employee-contracts', authorizedAs: 'talent.employees' },
      {
        name: 'talent-employee-performance',
        authorizedAs: 'talent.employees',
      },
      { name: 'talent-employee-portrait', authorizedAs: 'talent.employees' },
      { name: 'talent-employee-events', authorizedAs: 'talent.employees' },
      { name: 'talent-positions', authorizedAs: 'talent.positions' },
      { name: 'talent-actions', authorizedAs: 'talent.actions' },
      { name: 'talent-action-new', authorizedAs: 'talent.actions' },
      { name: 'talent-action-detail', authorizedAs: 'talent.actions' },
      { name: 'talent-job-events', authorizedAs: 'talent.jobEvents' },
      { name: 'talent-job-event-detail', authorizedAs: 'talent.jobEvents' },
      // V1-02: the compliance list is an HR administrator's tool; a checklist link is gated by its endpoint.
      { name: 'talent-compliance', authorizedAs: 'settings:talent.hr' },
      // V2-06 邮件往来
      { name: 'talent-mail', authorizedAs: 'talent.mail' },
      { name: 'talent-my-mailbox', authorizedAs: 'mail.workspace' },
      { name: 'talent-checklist', authorizedAs: null },
      { name: 'talent-contracts', authorizedAs: 'talent.contracts' },
      // V2-06 薪酬与社保
      { name: 'talent-salaries', authorizedAs: 'talent.salaries' },
      {
        name: 'talent-salary-adjustment-new',
        authorizedAs: 'talent.salaries',
      },
      { name: 'talent-salary-detail', authorizedAs: 'talent.salaries' },
      { name: 'talent-payroll', authorizedAs: 'talent.payroll' },
      { name: 'talent-payroll-bill', authorizedAs: 'talent.payroll' },
      { name: 'talent-payroll-cycle', authorizedAs: 'talent.payroll' },
      { name: 'talent-payroll-payslip', authorizedAs: 'talent.payroll' },
      {
        name: 'talent-social-insurance',
        authorizedAs: 'talent.socialInsurance',
      },
      { name: 'talent-my-payslips', authorizedAs: 'talent.myPayslips' },
      { name: 'talent-schedules', authorizedAs: 'talent.schedules' },
      { name: 'talent-attendance', authorizedAs: 'talent.attendance' },
      { name: 'talent-attendance-import', authorizedAs: 'talent.attendance' },
      ...[
        'talent-leave',
        'talent-leave-balances',
        'talent-leave-hr-entry',
        'talent-leave-hr-edit',
        'talent-leave-initialize',
        'talent-leave-adjust',
        'talent-leave-types',
        'talent-leave-type-new',
        'talent-leave-type-edit',
      ].map((name) => ({ name, authorizedAs: 'talent.leave' })),
      { name: 'talent-approvals', authorizedAs: 'talent.approvals' },
      {
        name: 'talent-approval-leave-detail',
        authorizedAs: 'talent.approvals',
      },
      {
        name: 'talent-approval-adjustment-detail',
        authorizedAs: 'talent.approvals',
      },
      { name: 'talent-knowledge-qa', authorizedAs: 'talent.knowledgeQa' },
      { name: 'talent-knowledge', authorizedAs: 'talent.knowledge' },
      { name: 'talent-knowledge-document', authorizedAs: 'talent.knowledge' },
      {
        name: 'talent-knowledge-document-version',
        authorizedAs: 'talent.knowledge',
      },
      { name: 'talent-org-chart', authorizedAs: 'talent.orgChart' },
      { name: 'talent-hr-reports', authorizedAs: 'talent.hrReports' },
      // V2-07 招聘
      { name: 'talent-workforce-plans', authorizedAs: 'talent.workforcePlans' },
      { name: 'talent-workforce-plan', authorizedAs: 'talent.workforcePlans' },
      { name: 'talent-requisitions', authorizedAs: 'talent.requisitions' },
      { name: 'talent-requisition-new', authorizedAs: 'talent.requisitions' },
      { name: 'talent-requisition', authorizedAs: 'talent.requisitions' },
      { name: 'talent-postings', authorizedAs: 'talent.postings' },
      { name: 'talent-posting', authorizedAs: 'talent.postings' },
      { name: 'talent-candidates', authorizedAs: 'talent.candidates' },
      { name: 'talent-candidate', authorizedAs: 'talent.candidates' },
      { name: 'talent-interviews', authorizedAs: 'talent.interviews' },
      { name: 'talent-interview', authorizedAs: 'talent.interviews' },
      { name: 'talent-offers', authorizedAs: 'talent.offers' },
      { name: 'talent-offer-new', authorizedAs: 'talent.offers' },
      { name: 'talent-offer', authorizedAs: 'talent.offers' },
      { name: 'talent-offer-onboard', authorizedAs: 'talent.offers' },
      {
        name: 'talent-recruiting-reports',
        authorizedAs: 'talent.recruitingReports',
      },
      // V2-07 end
      // V3-11
      { name: 'talent-decisions', authorizedAs: 'talent.decisions' },
      { name: 'talent-team-dashboard', authorizedAs: 'talent.teamDashboard' },
      { name: 'talent-find-people', authorizedAs: 'talent.findPeople' },
      { name: 'talent-signals', authorizedAs: 'talent.signals' },
      { name: 'talent-revisions', authorizedAs: 'talent.revisions' },
      { name: 'talent-audit', authorizedAs: 'talent.audit' },
      // V4-13 人才盘点与继任
      { name: 'talent-talent-reviews', authorizedAs: 'talent.talentReviews' },
      { name: 'talent-talent-review', authorizedAs: 'talent.talentReviews' },
      { name: 'talent-succession', authorizedAs: 'talent.succession' },
      { name: 'talent-succession-plan', authorizedAs: 'talent.succession' },
      { name: 'talent-framework', authorizedAs: 'talent.framework' },
      { name: 'talent-competencies', authorizedAs: 'talent.competencies' },
      { name: 'talent-competency-new', authorizedAs: 'talent.competencies' },
      // V3-08 导入能力评定
      {
        name: 'talent-competency-assessment-import',
        authorizedAs: 'talent.competencies',
      },
      { name: 'talent-competency-detail', authorizedAs: 'talent.competencies' },
      { name: 'talent-my-learning', authorizedAs: 'talent.myLearning' },
      { name: 'talent-learning-course', authorizedAs: 'talent.myLearning' },
      { name: 'talent-courses', authorizedAs: 'talent.courses' },
      { name: 'talent-course-new', authorizedAs: 'talent.courses' },
      { name: 'talent-course-detail', authorizedAs: 'talent.courses' },
      { name: 'talent-assignments', authorizedAs: 'talent.assignments' },
      { name: 'talent-paths', authorizedAs: 'talent.paths' },
      { name: 'talent-sessions', authorizedAs: 'talent.sessions' },
      {
        name: 'talent-practice-scenarios',
        authorizedAs: 'talent.practiceScenarios',
      },
      { name: 'talent-learning-plans', authorizedAs: 'talent.learningPlans' },
      // V4-13 讲师、培训评估、译文审核
      { name: 'talent-instructors', authorizedAs: 'talent.instructors' },
      {
        name: 'talent-training-evaluations',
        authorizedAs: 'talent.trainingEvaluations',
      },
      {
        name: 'talent-training-evaluation',
        authorizedAs: 'talent.trainingEvaluations',
      },
      { name: 'talent-translations', authorizedAs: 'talent.translations' },
      { name: 'talent-translation', authorizedAs: 'talent.translations' },
      { name: 'talent-my-exams', authorizedAs: 'talent.myExams' },
      { name: 'talent-exam-attempt', authorizedAs: 'talent.myExams' },
      { name: 'talent-certifications', authorizedAs: 'talent.certifications' },
      {
        name: 'talent-certification-detail',
        authorizedAs: 'talent.certifications',
      },
      { name: 'talent-questions', authorizedAs: 'talent.questions' },
      { name: 'talent-exams', authorizedAs: 'talent.exams' },
      { name: 'talent-exam-new', authorizedAs: 'talent.exams' },
      { name: 'talent-exam-detail', authorizedAs: 'talent.exams' },
      {
        name: 'talent-training-reports',
        authorizedAs: 'talent.trainingReports',
      },
      // V3-10
      { name: 'talent-external-certs', authorizedAs: 'talent.externalCerts' },
      // V4-13 实操考核
      { name: 'talent-practicals', authorizedAs: 'talent.practicals' },
      { name: 'talent-practical-record', authorizedAs: 'talent.practicals' },
      // V4-12 绩效
      { name: 'talent-my-review', authorizedAs: 'talent.myReview' },
      { name: 'talent-my-review-task', authorizedAs: 'talent.myReview' },
      { name: 'talent-team-reviews', authorizedAs: 'talent.teamReviews' },
      { name: 'talent-team-review', authorizedAs: 'talent.teamReviews' },
      { name: 'talent-calibration', authorizedAs: 'talent.calibration' },
      { name: 'talent-review-cycles', authorizedAs: 'talent.reviewCycles' },
      {
        name: 'talent-review-cycle-detail',
        authorizedAs: 'talent.reviewCycles',
      },
      { name: 'talent-review-schemes', authorizedAs: 'talent.reviewSchemes' },
      { name: 'talent-practice', authorizedAs: 'talent.practice' },
      { name: 'talent-check-in', authorizedAs: 'talent.checkIn' },
      { name: 'demo-batch-record', authorizedAs: 'demo.batchRecord' },
      // V4-14 叉车出库登记
      { name: 'demo-forklift-dispatch', authorizedAs: 'demo.forkliftDispatch' },
    ]);
  });
});

/** This application's own contribution, registered the way the client runtime registers it. */
function resolveRoutes() {
  return resolveAppClientContributions([
    {
      packageName: '@nocobase/app-template-default',
      routes: applicationRoutes,
      source: 'application',
    },
  ]);
}

/**
 * The paths of the pages a route tree registers. A menu group names no component, so it carries no path of its own
 * and inherits its parent's — filtering on `componentLoader` is what keeps that inherited path out of the list.
 */
function pagePaths(routes: readonly AppClientRegisteredRoute[]): string[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader ? [route.path] : []),
    ...pagePaths(route.children ?? []),
  ]);
}

/** Every page loader in a tree, at any depth. */
function componentLoadersIn(
  routes: readonly AppClientRegisteredRoute[],
): AppClientRouteComponentLoader[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader ? [route.componentLoader] : []),
    ...componentLoadersIn(route.children ?? []),
  ]);
}

/** Page authorization comes directly from the registered tree. */
function pageAuthorizations(
  routes: readonly AppClientRegisteredRoute[],
): { name: string; authorizedAs: string | null }[] {
  return routes.flatMap((route) => [
    ...(route.componentLoader && route.auth === 'required'
      ? [
          {
            name: route.name,
            authorizedAs:
              route.authz === 'skip'
                ? null
                : route.authz === 'unrestricted'
                  ? 'unrestricted'
                  : route.authz.resource.type === 'page'
                    ? route.authz.resource.id
                    : `${route.authz.resource.type}:${route.authz.resource.id}`,
          },
        ]
      : []),
    ...pageAuthorizations(route.children ?? []),
  ]);
}
