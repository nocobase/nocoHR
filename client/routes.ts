import {
  Award,
  Bot,
  BarChart3,
  ClipboardCheck,
  FileQuestion,
  LineChart,
  NotebookPen,
  BookMarked,
  BookOpen,
  BookOpenCheck,
  Briefcase,
  CalendarDays,
  CalendarRange,
  Fingerprint,
  ClipboardPen,
  GraduationCap,
  Library,
  ListChecks,
  MessageCircleQuestion,
  MessagesSquare,
  Route,
  FileSignature,
  GitBranch,
  IdCard,
  Network,
  Shuffle,
  History,
  RefreshCcw,
  Target,
  Users,
  Workflow,
  Layers,
  SlidersHorizontal,
  LayoutGrid,
  Sparkles,
  RadioTower,
  ShieldCheck,
  Columns3,
} from 'lucide-react';
// V2-06
import { Calculator, ReceiptText, Wallet } from 'lucide-react';
// V4-13 (ClipboardCheck comes with the first import)
import {
  Grid2x2Check,
  KeyRound,
  Languages,
  MessageSquareHeart,
  PlugZap,
  Presentation,
} from 'lucide-react';
// V4-12
import {
  CalendarCheck,
  ClipboardSignature,
  FileSliders,
  Scale,
  Trophy,
  UsersRound,
} from 'lucide-react';
// V2-07
import {
  CalendarClock,
  ClipboardList,
  Contact,
  Factory,
  Handshake,
  Megaphone,
  PieChart,
  UserPlus,
} from 'lucide-react';
// V3-11
import {
  FileArchive,
  FileDiff,
  Gavel,
  Grid3x3,
  Radar,
  UserSearch,
} from 'lucide-react';
import {
  defineAppRoutes,
  defineDevRoutes,
  defineSettingsRoutes,
  type AppClientRouteContribution,
} from '@nocobase/app-client/plugins';

const page = (id: string) =>
  ({ resource: { type: 'page', id }, action: 'access' }) as const;

const appRoutes: AppClientRouteContribution = defineAppRoutes([
  {
    // Every signed-in user reaches the landing page. `authz: 'skip'` takes it out of page authorization entirely, so
    // no permission change can leave a user signed in with nowhere to land. It has no menu entry: the page forwards
    // to the first talent page the user may open, and explains the situation when there is none.
    authz: 'skip',
    auth: 'required',
    componentLoader: () => import('./pages/home.js'),
    name: 'home',
    path: '/',
  },
  {
    // 人事：一级菜单（总纲“界面约定”）。分组只组织菜单，每个页面各自声明页面权限；用户一个都打不开的分组会隐藏。
    name: 'hr',
    navigation: { title: 'navigation.hr', icon: Briefcase },
    children: [
      {
        name: 'talent-workbench',
        path: '/talent/workbench',
        auth: 'required',
        authz: page('talent.workbench'),
        navigation: { title: 'workbench.title', icon: ListChecks },
        componentLoader: () => import('./pages/talent/workbench/index.js'),
      },
      {
        name: 'talent-me',
        path: '/talent/me',
        auth: 'required',
        authz: page('talent.me'),
        navigation: { title: 'navigation.talentMe', icon: IdCard },
        componentLoader: () => import('./pages/talent/me/index.js'),
        children: [
          {
            name: 'talent-me-leave-new',
            path: 'leave/new',
            componentLoader: () => import('./pages/talent/me/leave-new.js'),
          },
          {
            name: 'talent-me-leave-edit',
            path: 'leave/:requestId/edit',
            componentLoader: () => import('./pages/talent/me/leave-new.js'),
          },
          {
            // 问人事助理 (V1-02): a drawer over my profile.
            name: 'talent-me-assistant',
            path: 'assistant',
            breadcrumb: { title: 'talent.me.assistant.title' },
            componentLoader: () => import('./pages/talent/me/assistant.js'),
          },
          {
            name: 'talent-me-leave-detail',
            path: 'leave/:requestId',
            breadcrumb: { title: 'attendance.leave.ownDetail.title' },
            componentLoader: () => import('./pages/talent/me/leave-detail.js'),
          },
          // V2-05 考勤与假期: 补卡 / 加班 / 调班 dialogs and a request drawer over 我的档案.
          {
            name: 'talent-me-missing-punch',
            path: 'attendance/missing-punch',
            componentLoader: () =>
              import('./pages/talent/me/attendance/missing-punch.js'),
          },
          {
            name: 'talent-me-overtime',
            path: 'attendance/overtime',
            componentLoader: () =>
              import('./pages/talent/me/attendance/overtime.js'),
          },
          {
            name: 'talent-me-shift-swap',
            path: 'attendance/shift-swap',
            componentLoader: () =>
              import('./pages/talent/me/attendance/shift-swap.js'),
          },
          // V2-05 (realigned): 考勤异常说明.
          {
            name: 'talent-me-exception',
            path: 'attendance/exception',
            componentLoader: () =>
              import('./pages/talent/me/attendance/exception.js'),
          },
          {
            name: 'talent-me-adjustment-detail',
            path: 'attendance/adjustments/:adjustmentId',
            breadcrumb: { title: 'attendance.adjustments.detailTitle' },
            componentLoader: () =>
              import('./pages/talent/me/attendance/adjustment-detail.js'),
          },
        ],
      },
      {
        // 自助 (V1-04): the employee's existing self-service features as cards.
        name: 'talent-self-service',
        path: '/talent/self-service',
        auth: 'required',
        authz: page('talent.selfService'),
        navigation: { title: 'navigation.talentSelfService', icon: LayoutGrid },
        componentLoader: () => import('./pages/talent/self-service/index.js'),
      },
      {
        name: 'talent-employees',
        path: '/talent/employees',
        auth: 'required',
        authz: page('talent.employees'),
        navigation: { title: 'navigation.talentEmployees', icon: Users },
        breadcrumb: { title: 'navigation.talentEmployees' },
        componentLoader: () => import('./pages/talent/employees/index.js'),
        children: [
          {
            name: 'talent-employee-new',
            path: 'new',
            componentLoader: () => import('./pages/talent/employees/new.js'),
          },
          {
            name: 'talent-employee-import',
            path: 'import',
            breadcrumb: { title: 'talent.import.title' },
            componentLoader: () => import('./pages/talent/employees/import.js'),
          },
          {
            name: 'talent-employee-changes',
            path: 'changes',
            componentLoader: () =>
              import('./pages/talent/employees/changes.js'),
          },
          {
            name: 'talent-employee-detail',
            path: ':employeeId',
            breadcrumb: { title: 'talent.detail.breadcrumb' },
            componentLoader: () =>
              import('./pages/talent/employees/detail/index.js'),
            children: [
              {
                name: 'talent-employee-profile',
                path: 'profile',
                componentLoader: () =>
                  import('./pages/talent/employees/detail/profile.js'),
                children: [
                  {
                    // 更正任职信息 (V1-02): a dialog over the 档案 tab.
                    name: 'talent-employee-correct-job',
                    path: 'correct-job',
                    componentLoader: () =>
                      import('./pages/talent/employees/detail/correct-job.js'),
                  },
                ],
              },
              {
                name: 'talent-employee-abilities',
                path: 'abilities',
                componentLoader: () =>
                  import('./pages/talent/employees/detail/abilities.js'),
              },
              {
                name: 'talent-employee-contracts',
                path: 'contracts',
                componentLoader: () =>
                  import('./pages/talent/employees/detail/contracts.js'),
              },
              {
                // V4-12 绩效: the employee's review results.
                name: 'talent-employee-performance',
                path: 'performance',
                componentLoader: () =>
                  import('./pages/talent/employees/detail/performance.js'),
              },
              {
                // V3-11 画像: AI summary with evidence and the business-data timeline.
                name: 'talent-employee-portrait',
                path: 'portrait',
                componentLoader: () =>
                  import('./pages/talent/employees/detail/portrait.js'),
              },
              {
                name: 'talent-employee-events',
                path: 'events',
                componentLoader: () =>
                  import('./pages/talent/employees/detail/events.js'),
              },
            ],
          },
        ],
      },
      {
        name: 'talent-positions',
        path: '/talent/positions',
        auth: 'required',
        authz: page('talent.positions'),
        navigation: { title: 'navigation.talentPositions', icon: Layers },
        componentLoader: () => import('./pages/talent/positions/index.js'),
      },
      {
        name: 'talent-actions',
        path: '/talent/actions',
        auth: 'required',
        authz: page('talent.actions'),
        navigation: { title: 'navigation.talentActions', icon: Shuffle },
        componentLoader: () => import('./pages/talent/actions/index.js'),
        children: [
          {
            name: 'talent-action-new',
            path: 'new',
            componentLoader: () => import('./pages/talent/actions/new.js'),
          },
          {
            name: 'talent-action-detail',
            path: ':actionId',
            componentLoader: () => import('./pages/talent/actions/detail.js'),
          },
        ],
      },
      {
        // 岗位变动 (V1-03): every job event, whichever way it was produced; managers see their own scope.
        name: 'talent-job-events',
        path: '/talent/job-events',
        auth: 'required',
        authz: page('talent.jobEvents'),
        navigation: { title: 'navigation.talentJobEvents', icon: History },
        componentLoader: () => import('./pages/talent/job-events/index.js'),
        children: [
          {
            name: 'talent-job-event-detail',
            path: ':eventId',
            componentLoader: () =>
              import('./pages/talent/job-events/detail.js'),
          },
        ],
      },
      {
        // 用工合规检查 (V1-02): an HR administrator's list, so it checks the HR settings item like 人事设置.
        name: 'talent-compliance',
        path: '/talent/compliance',
        auth: 'required',
        authz: {
          resource: { type: 'settings', id: 'talent.hr' },
          action: 'administer',
        },
        navigation: { title: 'navigation.talentCompliance', icon: ShieldCheck },
        componentLoader: () => import('./pages/talent/compliance/index.js'),
      },
      {
        // 变动影响清单 (V1-02): reached from the workbench, notifications and actions. An approver without the actions
        // page opens a preview through its link, so the page does not gate; the endpoint answers 404 to anyone else.
        name: 'talent-checklist',
        path: '/talent/checklists/:checklistId',
        auth: 'required',
        authz: 'skip',
        componentLoader: () => import('./pages/talent/checklists/detail.js'),
      },
      {
        name: 'talent-contracts',
        path: '/talent/contracts',
        auth: 'required',
        authz: page('talent.contracts'),
        navigation: {
          title: 'navigation.talentContracts',
          icon: FileSignature,
        },
        componentLoader: () => import('./pages/talent/contracts/index.js'),
      },
      // V2-06 薪酬与社保: 薪资档案, 算薪 (with 派遣账单), 社保公积金, and every employee's 工资条.
      {
        name: 'talent-salaries',
        path: '/talent/salaries',
        auth: 'required',
        authz: page('talent.salaries'),
        navigation: { title: 'payroll.navigation.salaries', icon: Wallet },
        componentLoader: () =>
          import('./pages/talent/payroll/salaries/index.js'),
        children: [
          {
            name: 'talent-salary-adjustment-new',
            path: 'adjustments/new',
            componentLoader: () =>
              import('./pages/talent/payroll/salaries/adjustment-new.js'),
          },
          {
            name: 'talent-salary-detail',
            path: ':employeeId',
            componentLoader: () =>
              import('./pages/talent/payroll/salaries/detail.js'),
          },
        ],
      },
      {
        name: 'talent-payroll',
        path: '/talent/payroll',
        auth: 'required',
        authz: page('talent.payroll'),
        navigation: { title: 'payroll.navigation.payroll', icon: Calculator },
        breadcrumb: { title: 'payroll.navigation.payroll' },
        componentLoader: () => import('./pages/talent/payroll/index.js'),
        children: [
          {
            name: 'talent-payroll-bill',
            path: 'vendor-bills/:billId',
            componentLoader: () =>
              import('./pages/talent/payroll/bill-detail.js'),
          },
          {
            name: 'talent-payroll-cycle',
            path: ':cycleId',
            breadcrumb: { title: 'payroll.cycle.breadcrumb' },
            componentLoader: () =>
              import('./pages/talent/payroll/cycle/index.js'),
            children: [
              {
                name: 'talent-payroll-payslip',
                path: 'payslips/:payslipId',
                componentLoader: () =>
                  import('./pages/talent/payroll/cycle/payslip.js'),
              },
            ],
          },
        ],
      },
      {
        name: 'talent-social-insurance',
        path: '/talent/social-insurance',
        auth: 'required',
        authz: page('talent.socialInsurance'),
        navigation: {
          title: 'payroll.navigation.socialInsurance',
          icon: ShieldCheck,
        },
        componentLoader: () =>
          import('./pages/talent/payroll/social-insurance/index.js'),
      },
      {
        // 我的档案 · 工资条 has its own page (the 我的档案 page belongs to another step); it asks for the password again.
        name: 'talent-my-payslips',
        path: '/talent/my-payslips',
        auth: 'required',
        authz: page('talent.myPayslips'),
        navigation: {
          title: 'payroll.navigation.myPayslips',
          icon: ReceiptText,
        },
        componentLoader: () => import('./pages/talent/payroll/my-payslips.js'),
      },
      // V2-06 end
      {
        // 排班 (V2-05): the employee × date grid of a department.
        name: 'talent-schedules',
        path: '/talent/schedules',
        auth: 'required',
        authz: page('talent.schedules'),
        navigation: {
          title: 'attendance.scheduling.title',
          icon: CalendarRange,
        },
        componentLoader: () => import('./pages/talent/schedules/index.js'),
      },
      {
        // 考勤 (V2-05): 日报 / 月报 / 异常, with the punch import as a dialog.
        name: 'talent-attendance',
        path: '/talent/attendance',
        auth: 'required',
        authz: page('talent.attendance'),
        navigation: { title: 'attendance.board.title', icon: Fingerprint },
        componentLoader: () => import('./pages/talent/attendance/index.js'),
        children: [
          {
            name: 'talent-attendance-import',
            path: 'import',
            componentLoader: () =>
              import('./pages/talent/attendance/import.js'),
          },
        ],
      },
      {
        name: 'talent-leave',
        path: '/talent/leave',
        auth: 'required',
        authz: page('talent.leave'),
        navigation: { title: 'attendance.leave.title', icon: CalendarDays },
        componentLoader: () => import('./pages/talent/leave/index.js'),
        children: [
          {
            name: 'talent-leave-balances',
            path: 'balances',
            componentLoader: () =>
              import('./pages/talent/leave/balances/index.js'),
            children: [
              {
                name: 'talent-leave-hr-entry',
                path: 'entry',
                componentLoader: () =>
                  import('./pages/talent/leave/balances/hr-entry.js'),
              },
              {
                name: 'talent-leave-hr-edit',
                path: 'entry/:requestId',
                componentLoader: () =>
                  import('./pages/talent/leave/balances/hr-entry.js'),
              },
              {
                name: 'talent-leave-initialize',
                path: 'initialize',
                componentLoader: () =>
                  import('./pages/talent/leave/balances/initialize.js'),
              },
              {
                name: 'talent-leave-adjust',
                path: ':balanceId',
                componentLoader: () =>
                  import('./pages/talent/leave/balances/adjust.js'),
              },
            ],
          },
          {
            name: 'talent-leave-types',
            path: 'types',
            componentLoader: () =>
              import('./pages/talent/leave/types/index.js'),
            children: [
              {
                name: 'talent-leave-type-new',
                path: 'new',
                componentLoader: () =>
                  import('./pages/talent/leave/types/edit.js'),
              },
              {
                name: 'talent-leave-type-edit',
                path: ':typeId/edit',
                componentLoader: () =>
                  import('./pages/talent/leave/types/edit.js'),
              },
            ],
          },
        ],
      },
      {
        name: 'talent-approvals',
        path: '/talent/approvals',
        auth: 'required',
        authz: page('talent.approvals'),
        navigation: {
          title: 'attendance.approvals.title',
          icon: ClipboardCheck,
        },
        componentLoader: () => import('./pages/talent/approvals/index.js'),
        breadcrumb: { title: 'attendance.approvals.title' },
        children: [
          {
            name: 'talent-approval-leave-detail',
            path: 'leave/:requestId',
            breadcrumb: { title: 'attendance.approvals.detail' },
            componentLoader: () => import('./pages/talent/approvals/detail.js'),
          },
          {
            name: 'talent-approval-adjustment-detail',
            path: 'adjustments/:adjustmentId',
            breadcrumb: { title: 'attendance.adjustments.detailTitle' },
            componentLoader: () =>
              import('./pages/talent/approvals/adjustment-detail.js'),
          },
        ],
      },
      {
        name: 'talent-knowledge-qa',
        path: '/talent/ask',
        auth: 'required',
        authz: page('talent.knowledgeQa'),
        navigation: {
          title: 'navigation.talentKnowledgeQa',
          icon: MessageCircleQuestion,
        },
        componentLoader: () => import('./pages/talent/ask/index.js'),
      },
      {
        name: 'talent-knowledge',
        path: '/talent/knowledge',
        auth: 'required',
        authz: page('talent.knowledge'),
        navigation: { title: 'navigation.talentKnowledge', icon: Library },
        breadcrumb: { title: 'navigation.talentKnowledge' },
        componentLoader: () => import('./pages/talent/knowledge/index.js'),
        children: [
          {
            name: 'talent-knowledge-document',
            path: ':documentId',
            breadcrumb: { title: 'talent.knowledge.documentBreadcrumb' },
            componentLoader: () => import('./pages/talent/knowledge/detail.js'),
            children: [
              {
                // 上传新版本 (V1-04): a dialog over the document it replaces.
                name: 'talent-knowledge-document-version',
                path: 'versions/new',
                componentLoader: () =>
                  import('./pages/talent/knowledge/version-new.js'),
              },
            ],
          },
        ],
      },
      {
        name: 'talent-org-chart',
        path: '/talent/org-chart',
        auth: 'required',
        authz: page('talent.orgChart'),
        navigation: { title: 'navigation.talentOrgChart', icon: GitBranch },
        componentLoader: () => import('./pages/talent/org-chart/index.js'),
      },
      {
        name: 'talent-hr-reports',
        path: '/talent/hr-reports',
        auth: 'required',
        authz: page('talent.hrReports'),
        navigation: { title: 'navigation.talentHrReports', icon: BarChart3 },
        componentLoader: () => import('./pages/talent/hr-reports/index.js'),
      },
    ],
  },
  // V2-07 招聘：一级菜单（总纲“界面约定”，第七步起）。Each page declares its own page resource; a detail opens as a
  // child page (RouteChildPage) over its list, which renders the Outlet.
  {
    name: 'recruiting',
    navigation: { title: 'recruiting.navigation.group', icon: UserPlus },
    children: [
      {
        name: 'talent-workforce-plans',
        path: '/talent/workforce-plans',
        auth: 'required',
        authz: page('talent.workforcePlans'),
        navigation: {
          title: 'recruiting.navigation.workforcePlans',
          icon: Factory,
        },
        breadcrumb: { title: 'recruiting.navigation.workforcePlans' },
        componentLoader: () =>
          import('./pages/talent/recruiting/workforce-plans/index.js'),
        children: [
          {
            name: 'talent-workforce-plan',
            path: ':planId',
            breadcrumb: { title: 'recruiting.navigation.detail' },
            componentLoader: () =>
              import('./pages/talent/recruiting/workforce-plans/detail.js'),
          },
        ],
      },
      {
        name: 'talent-requisitions',
        path: '/talent/requisitions',
        auth: 'required',
        authz: page('talent.requisitions'),
        navigation: {
          title: 'recruiting.navigation.requisitions',
          icon: ClipboardList,
        },
        breadcrumb: { title: 'recruiting.navigation.requisitions' },
        componentLoader: () =>
          import('./pages/talent/recruiting/requisitions/index.js'),
        children: [
          {
            name: 'talent-requisition-new',
            path: 'new',
            breadcrumb: { title: 'recruiting.navigation.new' },
            componentLoader: () =>
              import('./pages/talent/recruiting/requisitions/new.js'),
          },
          {
            name: 'talent-requisition',
            path: ':requisitionId',
            breadcrumb: { title: 'recruiting.navigation.detail' },
            componentLoader: () =>
              import('./pages/talent/recruiting/requisitions/detail.js'),
          },
        ],
      },
      {
        name: 'talent-postings',
        path: '/talent/postings',
        auth: 'required',
        authz: page('talent.postings'),
        navigation: {
          title: 'recruiting.navigation.postings',
          icon: Megaphone,
        },
        breadcrumb: { title: 'recruiting.navigation.postings' },
        componentLoader: () =>
          import('./pages/talent/recruiting/postings/index.js'),
        children: [
          {
            name: 'talent-posting',
            path: ':postingId',
            breadcrumb: { title: 'recruiting.navigation.detail' },
            componentLoader: () =>
              import('./pages/talent/recruiting/postings/detail.js'),
          },
        ],
      },
      {
        name: 'talent-candidates',
        path: '/talent/candidates',
        auth: 'required',
        authz: page('talent.candidates'),
        navigation: {
          title: 'recruiting.navigation.candidates',
          icon: Contact,
        },
        breadcrumb: { title: 'recruiting.navigation.candidates' },
        componentLoader: () =>
          import('./pages/talent/recruiting/candidates/index.js'),
        children: [
          {
            name: 'talent-candidate',
            path: ':applicationId',
            breadcrumb: { title: 'recruiting.navigation.detail' },
            componentLoader: () =>
              import('./pages/talent/recruiting/candidates/detail.js'),
          },
        ],
      },
      {
        name: 'talent-interviews',
        path: '/talent/interviews',
        auth: 'required',
        authz: page('talent.interviews'),
        navigation: {
          title: 'recruiting.navigation.interviews',
          icon: CalendarClock,
        },
        breadcrumb: { title: 'recruiting.navigation.interviews' },
        componentLoader: () =>
          import('./pages/talent/recruiting/interviews/index.js'),
        children: [
          {
            name: 'talent-interview',
            path: ':interviewId',
            breadcrumb: { title: 'recruiting.navigation.detail' },
            componentLoader: () =>
              import('./pages/talent/recruiting/interviews/detail.js'),
          },
        ],
      },
      {
        name: 'talent-offers',
        path: '/talent/offers',
        auth: 'required',
        authz: page('talent.offers'),
        navigation: { title: 'recruiting.navigation.offers', icon: Handshake },
        breadcrumb: { title: 'recruiting.navigation.offers' },
        componentLoader: () =>
          import('./pages/talent/recruiting/offers/index.js'),
        children: [
          {
            name: 'talent-offer-new',
            path: 'new',
            breadcrumb: { title: 'recruiting.navigation.new' },
            componentLoader: () =>
              import('./pages/talent/recruiting/offers/new.js'),
          },
          {
            name: 'talent-offer',
            path: ':offerId',
            breadcrumb: { title: 'recruiting.navigation.detail' },
            componentLoader: () =>
              import('./pages/talent/recruiting/offers/detail.js'),
          },
          {
            name: 'talent-offer-onboard',
            path: ':offerId/onboard',
            breadcrumb: { title: 'recruiting.navigation.onboard' },
            componentLoader: () =>
              import('./pages/talent/recruiting/offers/onboard.js'),
          },
        ],
      },
      {
        name: 'talent-recruiting-reports',
        path: '/talent/recruiting-reports',
        auth: 'required',
        authz: page('talent.recruitingReports'),
        navigation: { title: 'recruiting.navigation.reports', icon: PieChart },
        componentLoader: () => import('./pages/talent/recruiting/reports.js'),
      },
    ],
  },
  // V2-07 end
  {
    // 人才发展：一级菜单（总纲“界面约定”，第八步起），内含能力体系、学习与培训、考试与认证三个子分组。
    name: 'talent-development',
    navigation: { title: 'navigation.talentDevelopment', icon: GraduationCap },
    children: [
      // V3-11 画像、联动与内容维护: the six pages sit directly under 人才发展 (spec: 人才发展 / 待我决定 …).
      {
        name: 'talent-decisions',
        path: '/talent/decisions',
        auth: 'required',
        authz: page('talent.decisions'),
        navigation: { title: 'navigation.talentDecisions', icon: Gavel },
        componentLoader: () => import('./pages/talent/decisions/index.js'),
      },
      {
        name: 'talent-team-dashboard',
        path: '/talent/team-dashboard',
        auth: 'required',
        authz: page('talent.teamDashboard'),
        navigation: { title: 'navigation.talentTeamDashboard', icon: Grid3x3 },
        componentLoader: () => import('./pages/talent/team-dashboard/index.js'),
      },
      {
        name: 'talent-find-people',
        path: '/talent/find-people',
        auth: 'required',
        authz: page('talent.findPeople'),
        navigation: { title: 'navigation.talentFindPeople', icon: UserSearch },
        componentLoader: () => import('./pages/talent/find-people/index.js'),
      },
      {
        name: 'talent-signals',
        path: '/talent/signals',
        auth: 'required',
        authz: page('talent.signals'),
        navigation: { title: 'navigation.talentSignals', icon: Radar },
        componentLoader: () => import('./pages/talent/signals/index.js'),
      },
      {
        name: 'talent-revisions',
        path: '/talent/revisions',
        auth: 'required',
        authz: page('talent.revisions'),
        navigation: { title: 'navigation.talentRevisions', icon: FileDiff },
        componentLoader: () => import('./pages/talent/revisions/index.js'),
      },
      {
        name: 'talent-audit',
        path: '/talent/audit',
        auth: 'required',
        authz: page('talent.audit'),
        navigation: { title: 'navigation.talentAudit', icon: FileArchive },
        componentLoader: () => import('./pages/talent/audit/index.js'),
      },
      // V3-11 end
      // V4-13 人才盘点与继任: 人才盘点 (hr.admin; heads during the review) and 继任计划 (hr.admin; the incumbent's superior reads).
      {
        name: 'talent-talent-reviews',
        path: '/talent/talent-reviews',
        auth: 'required',
        authz: page('talent.talentReviews'),
        navigation: { title: 'navigation.talentTalentReviews', icon: Grid2x2Check },
        breadcrumb: { title: 'navigation.talentTalentReviews' },
        componentLoader: () => import('./pages/talent/talent-reviews/index.js'),
        children: [
          {
            name: 'talent-talent-review',
            path: ':reviewId',
            breadcrumb: { title: 'talentReview.navigation.detail' },
            componentLoader: () => import('./pages/talent/talent-reviews/detail.js'),
          },
        ],
      },
      {
        name: 'talent-succession',
        path: '/talent/succession',
        auth: 'required',
        authz: page('talent.succession'),
        navigation: { title: 'navigation.talentSuccession', icon: KeyRound },
        breadcrumb: { title: 'navigation.talentSuccession' },
        componentLoader: () => import('./pages/talent/succession/index.js'),
        children: [
          {
            name: 'talent-succession-plan',
            path: ':planId',
            breadcrumb: { title: 'talentReview.navigation.detail' },
            componentLoader: () => import('./pages/talent/succession/detail.js'),
          },
        ],
      },
      // V4-13 end
      {
        // 能力体系：岗位能力模型与能力词典。
        name: 'talent-system',
        navigation: { title: 'navigation.talentSystem', icon: Target },
        children: [
          {
            name: 'talent-framework',
            path: '/talent/framework',
            auth: 'required',
            authz: page('talent.framework'),
            navigation: { title: 'navigation.talentFramework', icon: Workflow },
            componentLoader: () => import('./pages/talent/framework/index.js'),
          },
          {
            name: 'talent-competencies',
            path: '/talent/competencies',
            auth: 'required',
            authz: page('talent.competencies'),
            navigation: {
              title: 'navigation.talentCompetencies',
              icon: BookOpenCheck,
            },
            componentLoader: () =>
              import('./pages/talent/competencies/index.js'),
            children: [
              {
                name: 'talent-competency-new',
                path: 'new',
                componentLoader: () =>
                  import('./pages/talent/competencies/new.js'),
              },
              // V3-08: 导入能力评定 (hr.admin; the endpoint checks talent.assessment.import).
              {
                name: 'talent-competency-assessment-import',
                path: 'assessments-import',
                componentLoader: () =>
                  import('./pages/talent/competencies/import.js'),
              },
              {
                name: 'talent-competency-detail',
                path: ':competencyId',
                componentLoader: () =>
                  import('./pages/talent/competencies/detail.js'),
              },
            ],
          },
        ],
      },
      {
        // 学习与培训：员工自己的学习，以及讲师、HR、主管的课程、任务、路径、班次、陪练和学习计划。
        name: 'learning-center',
        navigation: { title: 'navigation.learningCenter', icon: BookOpen },
        children: [
          {
            name: 'talent-my-learning',
            path: '/talent/learning',
            auth: 'required',
            authz: page('talent.myLearning'),
            navigation: {
              title: 'navigation.talentMyLearning',
              icon: BookOpen,
            },
            breadcrumb: { title: 'navigation.talentMyLearning' },
            componentLoader: () => import('./pages/talent/learning/index.js'),
            children: [
              {
                name: 'talent-learning-course',
                path: ':courseId',
                breadcrumb: { title: 'talent.learning.courseBreadcrumb' },
                componentLoader: () =>
                  import('./pages/talent/learning/course.js'),
              },
            ],
          },
          {
            name: 'talent-courses',
            path: '/talent/courses',
            auth: 'required',
            authz: page('talent.courses'),
            navigation: { title: 'navigation.talentCourses', icon: BookMarked },
            breadcrumb: { title: 'navigation.talentCourses' },
            componentLoader: () => import('./pages/talent/courses/index.js'),
            children: [
              {
                name: 'talent-course-new',
                path: 'new',
                breadcrumb: { title: 'talent.courses.create' },
                componentLoader: () =>
                  import('./pages/talent/courses/editor.js'),
              },
              {
                name: 'talent-course-detail',
                path: ':courseId',
                breadcrumb: { title: 'talent.courses.courseBreadcrumb' },
                componentLoader: () =>
                  import('./pages/talent/courses/editor.js'),
              },
            ],
          },
          {
            name: 'talent-assignments',
            path: '/talent/assignments',
            auth: 'required',
            authz: page('talent.assignments'),
            navigation: {
              title: 'navigation.talentAssignments',
              icon: ListChecks,
            },
            componentLoader: () =>
              import('./pages/talent/assignments/index.js'),
          },
          {
            name: 'talent-paths',
            path: '/talent/paths',
            auth: 'required',
            authz: page('talent.paths'),
            navigation: { title: 'navigation.talentPaths', icon: Route },
            componentLoader: () => import('./pages/talent/paths/index.js'),
          },
          {
            name: 'talent-sessions',
            path: '/talent/sessions',
            auth: 'required',
            authz: page('talent.sessions'),
            navigation: {
              title: 'navigation.talentSessions',
              icon: CalendarDays,
            },
            componentLoader: () => import('./pages/talent/sessions/index.js'),
          },
          {
            name: 'talent-practice-scenarios',
            path: '/talent/practice-scenarios',
            auth: 'required',
            authz: page('talent.practiceScenarios'),
            navigation: {
              title: 'navigation.talentPracticeScenarios',
              icon: MessagesSquare,
            },
            componentLoader: () =>
              import('./pages/talent/practice-scenarios/index.js'),
          },
          {
            name: 'talent-learning-plans',
            path: '/talent/learning-plans',
            auth: 'required',
            authz: page('talent.learningPlans'),
            navigation: {
              title: 'navigation.talentLearningPlans',
              icon: ClipboardPen,
            },
            componentLoader: () =>
              import('./pages/talent/learning-plans/index.js'),
          },
          // V4-13 讲师 (hr.admin), 培训评估 (everyone answers; results by scope), 译文审核 (instructors, hr.admin).
          {
            name: 'talent-instructors',
            path: '/talent/instructors',
            auth: 'required',
            authz: page('talent.instructors'),
            navigation: { title: 'navigation.talentInstructors', icon: Presentation },
            componentLoader: () => import('./pages/talent/instructors/index.js'),
          },
          {
            name: 'talent-training-evaluations',
            path: '/talent/training-evaluations',
            auth: 'required',
            authz: page('talent.trainingEvaluations'),
            navigation: {
              title: 'navigation.talentTrainingEvaluations',
              icon: MessageSquareHeart,
            },
            breadcrumb: { title: 'navigation.talentTrainingEvaluations' },
            componentLoader: () =>
              import('./pages/talent/training-evaluations/index.js'),
            children: [
              {
                name: 'talent-training-evaluation',
                path: ':evaluationId',
                breadcrumb: { title: 'talentReview.navigation.respond' },
                componentLoader: () =>
                  import('./pages/talent/training-evaluations/respond.js'),
              },
            ],
          },
          {
            name: 'talent-translations',
            path: '/talent/translations',
            auth: 'required',
            authz: page('talent.translations'),
            navigation: { title: 'navigation.talentTranslations', icon: Languages },
            breadcrumb: { title: 'navigation.talentTranslations' },
            componentLoader: () => import('./pages/talent/translations/index.js'),
            children: [
              {
                name: 'talent-translation',
                path: ':type/:translationId',
                breadcrumb: { title: 'talentReview.navigation.detail' },
                componentLoader: () =>
                  import('./pages/talent/translations/detail.js'),
              },
            ],
          },
          // V4-13 end
        ],
      },
      {
        // 考试与认证：我的考试、证书，以及题库、考试和培训报表。
        name: 'exams-center',
        navigation: { title: 'navigation.examsCenter', icon: Award },
        children: [
          {
            name: 'talent-my-exams',
            path: '/talent/my-exams',
            auth: 'required',
            authz: page('talent.myExams'),
            navigation: {
              title: 'navigation.talentMyExams',
              icon: NotebookPen,
            },
            breadcrumb: { title: 'navigation.talentMyExams' },
            componentLoader: () => import('./pages/talent/my-exams/index.js'),
            children: [
              {
                name: 'talent-exam-attempt',
                path: 'attempts/:attemptId',
                breadcrumb: { title: 'talent.myExams.attemptBreadcrumb' },
                componentLoader: () =>
                  import('./pages/talent/my-exams/attempt.js'),
              },
            ],
          },
          {
            name: 'talent-certifications',
            path: '/talent/certifications',
            auth: 'required',
            authz: page('talent.certifications'),
            navigation: {
              title: 'navigation.talentCertifications',
              icon: Award,
            },
            breadcrumb: { title: 'navigation.talentCertifications' },
            componentLoader: () =>
              import('./pages/talent/certifications/index.js'),
            children: [
              {
                name: 'talent-certification-detail',
                path: ':certificationId',
                breadcrumb: { title: 'talent.certifications.breadcrumb' },
                componentLoader: () =>
                  import('./pages/talent/certifications/detail.js'),
              },
            ],
          },
          {
            name: 'talent-questions',
            path: '/talent/questions',
            auth: 'required',
            authz: page('talent.questions'),
            navigation: {
              title: 'navigation.talentQuestions',
              icon: FileQuestion,
            },
            componentLoader: () => import('./pages/talent/questions/index.js'),
          },
          {
            name: 'talent-exams',
            path: '/talent/exams',
            auth: 'required',
            authz: page('talent.exams'),
            navigation: {
              title: 'navigation.talentExams',
              icon: ClipboardCheck,
            },
            breadcrumb: { title: 'navigation.talentExams' },
            componentLoader: () => import('./pages/talent/exams/index.js'),
            children: [
              {
                name: 'talent-exam-new',
                path: 'new',
                breadcrumb: { title: 'talent.exams.create' },
                componentLoader: () => import('./pages/talent/exams/detail.js'),
              },
              {
                name: 'talent-exam-detail',
                path: ':examId',
                breadcrumb: { title: 'talent.exams.examBreadcrumb' },
                componentLoader: () => import('./pages/talent/exams/detail.js'),
              },
            ],
          },
          {
            name: 'talent-training-reports',
            path: '/talent/training-reports',
            auth: 'required',
            authz: page('talent.trainingReports'),
            navigation: {
              title: 'navigation.talentTrainingReports',
              icon: LineChart,
            },
            componentLoader: () =>
              import('./pages/talent/training-reports/index.js'),
          },
          // V3-10 10B: HR verifies the external certificates employees register.
          {
            name: 'talent-external-certs',
            path: '/talent/external-certs',
            auth: 'required',
            authz: page('talent.externalCerts'),
            navigation: {
              title: 'navigation.talentExternalCerts',
              icon: ShieldCheck,
            },
            componentLoader: () =>
              import('./pages/talent/external-certs/index.js'),
          },
          // V4-13 实操考核 (hr.admin, hr.instructor, hr.practicalAssessor; witnesses open their records from a notice).
          {
            name: 'talent-practicals',
            path: '/talent/practicals',
            auth: 'required',
            authz: page('talent.practicals'),
            navigation: { title: 'navigation.talentPracticals', icon: ClipboardCheck },
            breadcrumb: { title: 'navigation.talentPracticals' },
            componentLoader: () => import('./pages/talent/practicals/index.js'),
            children: [
              {
                name: 'talent-practical-record',
                path: 'records/:recordId',
                breadcrumb: { title: 'talentReview.navigation.record' },
                componentLoader: () => import('./pages/talent/practicals/record.js'),
              },
            ],
          },
          // V4-13 end
        ],
      },
      // V4-12 绩效: 考核方案 and 考核周期 (hr.admin), 我的考核 (everyone), 团队考核 (heads), 校准 (hr.admin; heads read).
      {
        name: 'performance-center',
        navigation: { title: 'navigation.performanceCenter', icon: Trophy },
        children: [
          {
            name: 'talent-my-review',
            path: '/talent/my-review',
            auth: 'required',
            authz: page('talent.myReview'),
            navigation: {
              title: 'navigation.talentMyReview',
              icon: ClipboardSignature,
            },
            breadcrumb: { title: 'navigation.talentMyReview' },
            componentLoader: () =>
              import('./pages/talent/performance/my-review.js'),
            children: [
              {
                name: 'talent-my-review-task',
                path: 'reviews/:reviewId',
                breadcrumb: { title: 'performance.review.breadcrumb' },
                componentLoader: () =>
                  import('./pages/talent/performance/review.js'),
              },
            ],
          },
          {
            name: 'talent-team-reviews',
            path: '/talent/team-reviews',
            auth: 'required',
            authz: page('talent.teamReviews'),
            navigation: {
              title: 'navigation.talentTeamReviews',
              icon: UsersRound,
            },
            breadcrumb: { title: 'navigation.talentTeamReviews' },
            componentLoader: () => import('./pages/talent/performance/team.js'),
            children: [
              {
                name: 'talent-team-review',
                path: ':reviewId',
                breadcrumb: { title: 'performance.review.breadcrumb' },
                componentLoader: () =>
                  import('./pages/talent/performance/review.js'),
              },
            ],
          },
          {
            name: 'talent-calibration',
            path: '/talent/calibration',
            auth: 'required',
            authz: page('talent.calibration'),
            navigation: { title: 'navigation.talentCalibration', icon: Scale },
            componentLoader: () =>
              import('./pages/talent/performance/calibration.js'),
          },
          {
            name: 'talent-review-cycles',
            path: '/talent/review-cycles',
            auth: 'required',
            authz: page('talent.reviewCycles'),
            navigation: {
              title: 'navigation.talentReviewCycles',
              icon: CalendarCheck,
            },
            breadcrumb: { title: 'navigation.talentReviewCycles' },
            componentLoader: () =>
              import('./pages/talent/performance/cycles.js'),
            children: [
              {
                name: 'talent-review-cycle-detail',
                path: ':cycleId',
                breadcrumb: { title: 'performance.cycles.breadcrumb' },
                componentLoader: () =>
                  import('./pages/talent/performance/cycle-detail.js'),
              },
            ],
          },
          {
            name: 'talent-review-schemes',
            path: '/talent/review-schemes',
            auth: 'required',
            authz: page('talent.reviewSchemes'),
            navigation: {
              title: 'navigation.talentReviewSchemes',
              icon: FileSliders,
            },
            componentLoader: () =>
              import('./pages/talent/performance/schemes.js'),
          },
        ],
      },
      // V4-12 end
    ],
  },
  {
    // 陪练: a practice conversation, opened from "my learning", a scenario's trial run or a profile; no menu entry.
    name: 'talent-practice',
    path: '/talent/practice/:practiceId',
    auth: 'required',
    authz: page('talent.practice'),
    breadcrumb: { title: 'navigation.talentPractice' },
    componentLoader: () => import('./pages/talent/practice/index.js'),
  },
  {
    // 签到: the page a session's QR code opens on a phone; no menu entry.
    name: 'talent-check-in',
    path: '/talent/check-in',
    auth: 'required',
    authz: page('talent.checkIn'),
    breadcrumb: { title: 'navigation.talentCheckIn' },
    componentLoader: () => import('./pages/talent/check-in/index.js'),
  },
  {
    // 设备开工登记（演示）: a stand-in business page that only holders of a valid CNC 岗位上岗证 reach.
    // It demonstrates the certificate → permission loop, not a product feature, so it has no menu entry (the user
    // asked for it to stay out of the menu); the certification page links to it (see client/pages/demo/pages.ts).
    name: 'demo-batch-record',
    path: '/demo/batch-record',
    auth: 'required',
    authz: page('demo.batchRecord'),
    breadcrumb: { title: 'navigation.demoBatchRecord' },
    componentLoader: () => import('./pages/demo/batch-record.js'),
  },
  {
    // V4-14 叉车出库登记: like the start-up sign-off above, reached only from the 叉车证 certificate (no menu entry, the
    // user's decision); its page resource is granted through equip.forkliftOperator on that certification.
    name: 'demo-forklift-dispatch',
    path: '/demo/forklift-dispatch',
    auth: 'required',
    authz: page('demo.forkliftDispatch'),
    breadcrumb: { title: 'navigation.demoForkliftDispatch' },
    componentLoader: () => import('./pages/demo/forklift-dispatch.js'),
  },
  // V2-07 公开页面 (no sign-in): the careers page, self-booking, the AI initial interview and the offer page. Their API is
  // /api/public/recruiting/*, which carries only a slug or a link token (server/routes/hr/recruiting.ts).
  {
    name: 'public-jobs',
    path: '/jobs',
    auth: 'optional',
    authz: 'skip',
    componentLoader: () => import('./pages/talent/recruiting/public/jobs.js'),
  },
  {
    name: 'public-job-booking',
    path: '/jobs/booking/:token',
    auth: 'optional',
    authz: 'skip',
    componentLoader: () =>
      import('./pages/talent/recruiting/public/booking.js'),
  },
  {
    name: 'public-job-ai-interview',
    path: '/jobs/ai-interview/:token',
    auth: 'optional',
    authz: 'skip',
    componentLoader: () =>
      import('./pages/talent/recruiting/public/ai-interview.js'),
  },
  {
    name: 'public-job',
    path: '/jobs/:slug',
    auth: 'optional',
    authz: 'skip',
    componentLoader: () => import('./pages/talent/recruiting/public/job.js'),
  },
  {
    name: 'public-offer',
    path: '/offer/:token',
    auth: 'optional',
    authz: 'skip',
    componentLoader: () => import('./pages/talent/recruiting/public/offer.js'),
  },
  // V2-07 end
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/login.js'),
    name: 'login',
    path: '/login',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/register.js'),
    name: 'register',
    path: '/register',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/forgot-password.js'),
    name: 'forgot-password',
    path: '/forgot-password',
  },
  {
    auth: 'guest',
    authz: 'skip',
    componentLoader: () => import('./pages/auth/reset-password.js'),
    name: 'reset-password',
    path: '/reset-password',
  },
]);

const settingsRoutes: AppClientRouteContribution = defineSettingsRoutes([
  {
    name: 'talent-attendance-settings',
    path: '/attendance',
    navigation: { title: 'attendance.settings.title', icon: SlidersHorizontal },
    authz: page('talent.attendanceSettings'),
    componentLoader: () => import('./pages/settings/attendance/index.js'),
    children: [
      {
        name: 'talent-attendance-catalog-new',
        path: ':kind/new',
        componentLoader: () =>
          import('./pages/settings/attendance/catalog/edit.js'),
      },
      {
        name: 'talent-attendance-catalog-edit',
        path: ':kind/:recordId/edit',
        componentLoader: () =>
          import('./pages/settings/attendance/catalog/edit.js'),
      },
    ],
  },
  {
    name: 'talent-personnel-settings',
    path: '/personnel',
    navigation: { title: 'personnelSettings.title', icon: SlidersHorizontal },
    authz: {
      resource: { type: 'settings', id: 'talent.hr' },
      action: 'administer',
    },
    componentLoader: () => import('./pages/settings/personnel/index.js'),
  },
  {
    // V4-14 设置 / 持证上岗: the industry pack's switch, certification-only permission sets, the schedule and transfer
    // checks, shifts' required certifications (hr.admin through the page resource).
    name: 'talent-licensed-operation-settings',
    path: '/licensed-operation',
    navigation: {
      title: 'navigation.licensedOperationSettings',
      icon: SlidersHorizontal,
    },
    authz: page('talent.licensedOperationSettings'),
    componentLoader: () => import('./pages/settings/licensed/index.js'),
  },
  {
    // V3-09 学习规则: due-soon days, plan expiry, check-in window, default watch share. hr.admin only, like 人事设置.
    name: 'talent-learning-settings',
    path: '/learning',
    navigation: { title: 'learningSettings.title', icon: SlidersHorizontal },
    authz: {
      resource: { type: 'settings', id: 'talent.hr' },
      action: 'administer',
    },
    componentLoader: () => import('./pages/settings/learning/index.js'),
  },
  {
    // 字段管理 (V1-01, 总纲 可定制约定): the fields administrators add to business tables.
    name: 'talent-custom-fields',
    path: '/custom-fields',
    navigation: { title: 'customFields.title', icon: Columns3 },
    authz: {
      resource: { type: 'settings', id: 'talent.hr' },
      action: 'administer',
    },
    componentLoader: () => import('./pages/settings/custom-fields/index.js'),
  },
  {
    // 组织管理: departments, heads and members. Checks the departments settings item the server registers.
    name: 'talent-departments',
    path: '/departments',
    navigation: { title: 'navigation.talentDepartments', icon: Network },
    authz: {
      resource: { type: 'settings', id: 'talent.departments' },
      action: 'read',
    },
    componentLoader: () => import('./pages/settings/departments/index.js'),
  },
  {
    // 组织同步 (V1-03): four tabs as child routes; the runs tab opens a run in a drawer, the mappings tab its dialogs.
    name: 'talent-org-sync',
    path: '/org-sync',
    navigation: { title: 'navigation.orgSync', icon: RefreshCcw },
    authz: page('talent.orgSync'),
    componentLoader: () => import('./pages/settings/org-sync/index.js'),
    children: [
      {
        name: 'talent-org-sync-connection',
        path: 'connection',
        componentLoader: () =>
          import('./pages/settings/org-sync/connection.js'),
      },
      {
        name: 'talent-org-sync-runs',
        path: 'runs',
        componentLoader: () => import('./pages/settings/org-sync/runs.js'),
        children: [
          {
            name: 'talent-org-sync-run-detail',
            path: ':runId',
            componentLoader: () =>
              import('./pages/settings/org-sync/run-detail.js'),
          },
        ],
      },
      {
        name: 'talent-org-sync-issues',
        path: 'issues',
        componentLoader: () => import('./pages/settings/org-sync/issues.js'),
      },
      {
        name: 'talent-org-sync-aliases',
        path: 'aliases',
        componentLoader: () => import('./pages/settings/org-sync/aliases.js'),
        children: [
          {
            name: 'talent-org-sync-alias-new',
            path: 'new',
            componentLoader: () =>
              import('./pages/settings/org-sync/alias-edit.js'),
          },
          {
            name: 'talent-org-sync-alias-edit',
            path: ':aliasId/edit',
            componentLoader: () =>
              import('./pages/settings/org-sync/alias-edit.js'),
          },
        ],
      },
    ],
  },
  {
    // AI 自动化: each AI employee's proactive work, its owner, switch and run time, and the run records.
    name: 'talent-ai-automations',
    path: '/ai-automations',
    navigation: { title: 'navigation.aiAutomations', icon: Bot },
    authz: {
      resource: { type: 'settings', id: 'talent.aiAutomations' },
      action: 'read',
    },
    componentLoader: () => import('./pages/settings/ai-automations/index.js'),
  },
  {
    // V2-06 薪酬设置: salary structures and the payroll rules (hr.payroll).
    name: 'talent-payroll-settings',
    path: '/payroll',
    navigation: { title: 'payroll.settings.title', icon: Wallet },
    breadcrumb: { title: 'payroll.settings.title' },
    authz: page('talent.payrollSettings'),
    componentLoader: () => import('./pages/settings/payroll/index.js'),
    children: [
      {
        name: 'talent-payroll-structure',
        path: 'structures/:structureId',
        breadcrumb: { title: 'payroll.structure.breadcrumb' },
        componentLoader: () => import('./pages/settings/payroll/structure.js'),
      },
    ],
  },
  {
    // AI 入口 (V1-04): the unified entry's routing table, knowledge scopes and office-suite bots.
    name: 'talent-ai-entry',
    path: '/ai-entry',
    navigation: { title: 'navigation.aiEntry', icon: Sparkles },
    authz: page('talent.aiEntry'),
    componentLoader: () => import('./pages/settings/ai-entry/index.js'),
  },
  {
    // V2-07 招聘设置 (hr.admin): careers page, reminders, approvals, workforce parameters, check-ins, emails, ERP key.
    name: 'talent-recruiting-settings',
    path: '/recruiting',
    navigation: { title: 'recruiting.navigation.settings', icon: UserPlus },
    authz: page('talent.recruitingSettings'),
    componentLoader: () => import('./pages/settings/recruiting/index.js'),
  },
  {
    // V4-13 外部 AI 助手 (hr.admin): clients, tokens, the audit log and the call limit.
    name: 'talent-agent-clients',
    path: '/agent-clients',
    navigation: { title: 'navigation.talentAgentClients', icon: PlugZap },
    authz: page('talent.agentClients'),
    componentLoader: () => import('./pages/settings/agent-clients/index.js'),
  },
]);

const devRoutes: AppClientRouteContribution = defineDevRoutes([
  {
    // 模拟渠道（仅开发环境）(V1-04): send office-suite bot messages as a directory member, without a real bot.
    name: 'talent-im-mock',
    path: '/im-mock',
    authz: 'skip',
    navigation: { title: 'navigation.imMock', icon: RadioTower },
    componentLoader: () => import('./pages/dev/im-mock.js'),
  },
]);

const routes: readonly AppClientRouteContribution[] = [
  appRoutes,
  settingsRoutes,
  devRoutes,
];

export default routes;
