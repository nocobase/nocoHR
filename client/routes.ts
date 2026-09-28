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
  Target,
  Users,
  Workflow,
  Layers,
  SlidersHorizontal,
} from 'lucide-react';
import {
  defineAppRoutes,
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
  {
    // 人才发展：一级菜单（总纲“界面约定”，第八步起），内含能力体系、学习与培训、考试与认证三个子分组。
    name: 'talent-development',
    navigation: { title: 'navigation.talentDevelopment', icon: GraduationCap },
    children: [
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
        ],
      },
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
]);

const routes: readonly AppClientRouteContribution[] = [
  appRoutes,
  settingsRoutes,
];

export default routes;
