import type { Application } from '@nocobase/app-server/application';
import {
  authorizationToken,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { notificationServiceToken } from '@nocobase/app-plugin-notification';
import { schedulerServiceToken } from '@nocobase/app-plugin-scheduler/server/tokens';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { i18nToken } from '@nocobase/app-server/i18n';
import { loggingToken } from '@nocobase/app-server/logging';
import { databaseManagerToken } from '@nocobase/db';
import { ServiceProvider } from '@nocobase/service-provider';

import { createAIRunner } from './ai-runner.js';
import { workbenchResource } from './workbench-resource.js';
import { createWorkItemStore } from './work-item-store.js';
import { createPersonnelSettingsService } from './personnel-settings.js';
import { createAttendanceSettingsService } from './attendance-settings.js';
import { attendanceSettingsResource } from './attendance-settings-resource.js';
import { createLeaveService } from './leave-service.js';
import { createLeaveRequestService } from './leave-request-service.js';
import { leaveResource } from './leave-resources.js';
import { scheduleResource } from './schedule-resources.js';
import { createScheduleService } from './schedule-service.js';
import { AUTOMATION_COLLECTIONS } from './automation-resources.js';
import { createAutomationTasks } from './automation-tasks.js';
import { createAutomationService } from './automation.js';
import { HR_COLLECTIONS, HR_COMPOSITES } from './authz-resources.js';
import { createHrCoreService, HR_ADMIN_SETTINGS } from './core-service.js';
import { createDemoBatchService } from './demo-batch.js';
import { departmentTitleTranslations } from './department-titles.js';
import {
  CERTIFICATION_SUBJECT,
  createCertificationService,
} from './certification-service.js';
import { EXAM_COLLECTIONS, EXAM_COMPOSITES } from './exam-resources.js';
import { createExamService } from './exam-service.js';
import { createInsightService } from './insight-service.js';
import { createKnowledgeService } from './knowledge-service.js';
import { createLearningService } from './learning-service.js';
import {
  LEARNING_COLLECTIONS,
  LEARNING_COMPOSITES,
} from './learning-resources.js';
import { runDailyMaintenance, runMinuteMaintenance } from './maintenance.js';
import { createOrganizationService } from './organization-service.js';
import { createPathService } from './path-service.js';
import { createPlanService } from './plan-service.js';
import { createPracticeService } from './practice-service.js';
import { createSessionService } from './session-service.js';
import {
  TRAINING_COLLECTIONS,
  TRAINING_COMPOSITES,
} from './training-resources.js';
import { createPlatform, type Notify } from './platform.js';
import { registerRecordAccess } from './record-access.js';
import { label, str } from './shared.js';
import { registerSubjects } from './subjects.js';
import { createTalentService } from './talent-service.js';
import type { TalentConfig } from '../../config/talent.js';
import {
  automationServiceToken,
  automationTasksToken,
  certificationServiceToken,
  demoBatchServiceToken,
  examServiceToken,
  hrCoreServiceToken,
  personnelSettingsToken,
  attendanceSettingsToken,
  leaveServiceToken,
  leaveRequestServiceToken,
  scheduleServiceToken,
  insightServiceToken,
  knowledgeServiceToken,
  learningServiceToken,
  organizationServiceToken,
  pathServiceToken,
  planServiceToken,
  platformToken,
  practiceServiceToken,
  sessionServiceToken,
  talentServiceToken,
} from './tokens.js';

export const DEPARTMENTS_SETTINGS = 'talent.departments';
/** The settings page listing the AI employees' proactive work; each automation is configured through its composite's `configure`. */
export const AI_AUTOMATIONS_SETTINGS = 'talent.aiAutomations';
const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

/**
 * Registers the talent platform: the organisation, framework, employee and
 * core-HR services; the permission model (collections, composites, record
 * access, subject types and settings items); and the daily HR maintenance
 * schedule.
 */
export default class HrProvider extends ServiceProvider<Application> {
  public readonly name: string = 'hr/talent';
  private releaseSubjects?: () => void;

  public override register(): void {
    this.app.container.singleton(leaveServiceToken, () => {
      const platform = this.app.container.resolve(platformToken);
      return createLeaveService(platform.database, platform.currentDate);
    });
    this.app.container.singleton(leaveRequestServiceToken, () => {
      const platform = this.app.container.resolve(platformToken);
      return createLeaveRequestService({
        database: platform.database,
        currentDate: platform.currentDate,
        organization: platform.organization,
        timeZone: platform.timeZone,
      });
    });
    this.app.container.singleton(attendanceSettingsToken, () =>
      createAttendanceSettingsService(
        this.app.container.resolve(databaseManagerToken),
      ),
    );
    this.app.container.singleton(scheduleServiceToken, () => {
      const platform = this.app.container.resolve(platformToken);
      return createScheduleService(platform.database, {
        organization: platform.organization,
        timeZone: platform.timeZone,
      });
    });
    this.app.container.singleton(personnelSettingsToken, () =>
      createPersonnelSettingsService(
        this.app.container.resolve(databaseManagerToken),
      ),
    );
    this.registerLearning();
    this.registerExams();
    this.registerTraining();
    this.registerAutomation();
    this.app.container.singleton(organizationServiceToken, () =>
      createOrganizationService(
        this.app.container.resolve(databaseManagerToken),
        departmentTitleTranslations,
      ),
    );
    this.app.container.singleton(talentServiceToken, () =>
      createTalentService({
        database: this.app.container.resolve(databaseManagerToken),
        authz: this.app.container.resolve(authorizationToken),
        organization: this.app.container.resolve(organizationServiceToken),
        users: this.app.container.resolve(userAdministrationServiceToken),
        onEmployeesImported: () => (batchId) =>
          this.inBackground('hrAssistant.importCheck', () =>
            this.app.container
              .resolve(automationTasksToken)
              .onEmployeesImported(batchId),
          ),
      }),
    );
    this.app.container.singleton(hrCoreServiceToken, () => {
      const container = this.app.container;
      const users = container.resolve(userAdministrationServiceToken);
      return createHrCoreService({
        settings: container.resolve(personnelSettingsToken),
        database: container.resolve(databaseManagerToken),
        authz: container.resolve(authorizationToken),
        organization: container.resolve(organizationServiceToken),
        talent: container.resolve(talentServiceToken),
        users,
        timeZone: this.talentConfig().timeZone,
        createAccount: async (input, connection) =>
          users.withConnection(connection).create(input),
        notify: this.notifier(),
      });
    });
  }

  /**
   * Sends an in-app notification whose text comes from the server locales in
   * the application's default language; recipients carry no stored language.
   * The idempotency key makes a replayed event send nothing new.
   */
  private notifier(): Notify {
    const container = this.app.container;
    return async ({ key, userIds, message, params, path }) => {
      if (!userIds.length || !container.has(notificationServiceToken)) return;
      const notification = container.resolve(notificationServiceToken);
      const recipients = [...new Set(userIds)] as [string, ...string[]];
      const i18n = container.resolve(i18nToken);
      const locale = i18n.getDefaultLocale();
      await i18n.ensureLocaleLoaded(locale);
      const t = i18n.getFixedT('hr', locale);
      const values = {
        ...params,
        type: params.type ? t(`notifications.actionTypes.${params.type}`) : '',
      };
      const taskTypes: Record<string, string> = {
        actionPending: 'approval',
        probationEnding: 'probationReminder',
        contractEnding: 'contractReminder',
        contractExpired: 'contractReminder',
        hrImportCheck: 'importCheck',
        hrImportCheckClean: 'importCheck',
      };
      const taskType = taskTypes[message];
      if (taskType && path) {
        await container
          .resolve(databaseManagerToken)
          .transaction(async (connection) => {
            const approvalId =
              message === 'actionPending' ? path.split('/').at(-1) : undefined;
            if (approvalId) {
              // Notification delivery may race a decision. Do not recreate a task
              // for an approval level that has already been decided.
              const action = await connection
                .repository('personnelActions')
                .findOne({ filter: { id: approvalId, status: 'pending' } });
              const steps = action?.approvals as
                { level: number; status: string }[] | undefined;
              const pending = Array.isArray(steps)
                ? steps.find((step) => step.status === 'pending')
                : undefined;
              if (
                !pending ||
                key !== `action:${approvalId}:level:${pending.level}`
              )
                return;
            }
            const store = createWorkItemStore(connection);
            for (const recipientUserId of recipients)
              await store.put({
                recipientUserId,
                type: approvalId
                  ? `approval:${key.split(':').at(-1)}`
                  : taskType,
                refType: approvalId ? 'personnelAction' : taskType,
                refId: approvalId ?? key,
                title: t(`notifications.${message}.title`, values),
                // Import reports may contain personal data: link to the protected report, never copy its body.
                summary: message.startsWith('hrImportCheck')
                  ? null
                  : t(`notifications.${message}.body`, values),
                link: path,
                sourceKind: approvalId
                  ? 'approval'
                  : message.startsWith('hrImportCheck')
                    ? 'ai'
                    : 'rule',
                aiEmployee: message.startsWith('hrImportCheck')
                  ? 'hrAssistant'
                  : null,
              });
          });
      }
      try {
        await notification.send({
          idempotencyKey: `hr:${key}`,
          source: { type: 'hr', referenceId: key },
          messages: {
            inbox: {
              to: recipients,
              title: t(`notifications.${message}.title`, values),
              body: t(`notifications.${message}.body`, values),
              ...(path ? { target: { type: 'route', path } } : {}),
            },
          },
        });
      } catch (error) {
        container
          .resolve(loggingToken)
          .getLogger('hr')
          .warn({ error, key }, 'HR notification failed');
      }
    };
  }

  private registerLearning(): void {
    const container = this.app.container;
    container.singleton(platformToken, () =>
      createPlatform({
        database: container.resolve(databaseManagerToken),
        authz: container.resolve(authorizationToken),
        organization: container.resolve(organizationServiceToken),
        users: container.resolve(userAdministrationServiceToken),
        notify: this.notifier(),
        timeZone: this.talentConfig().timeZone,
      }),
    );
    container.singleton(knowledgeServiceToken, () => {
      const organization = container.resolve(organizationServiceToken);
      return createKnowledgeService({
        platform: container.resolve(platformToken),
        drive: () => container.resolve(driveManagerToken),
        departmentTitle: async (id) => {
          const department = await organization.getDepartment(id);
          return department ? organization.titleText(department.title) : id;
        },
        basePath: () => this.app.publicBasePath,
        onDocumentParsed:
          () =>
          (documentId, { autoDraftCourse }) => {
            if (autoDraftCourse)
              this.inBackground('contentWriter.draftCourseFromDocument', () =>
                container
                  .resolve(automationTasksToken)
                  .onDocumentReady(documentId),
              );
          },
      });
    });
    container.singleton(learningServiceToken, () =>
      createLearningService({
        platform: container.resolve(platformToken),
        knowledge: container.resolve(knowledgeServiceToken),
        onCourseCompleted: () => this.courseCompletedHandler,
        onCoursePublished: () => (courseId) =>
          this.inBackground('contentWriter.fillCourseQuestions', () =>
            container.resolve(automationTasksToken).onCoursePublished(courseId),
          ),
        basePath: () => this.app.publicBasePath,
      }),
    );
  }

  /** Checks certification requirements when a course completes. */
  private courseCompletedHandler?: (
    employeeId: string,
    courseId: string,
  ) => Promise<void>;

  private talentConfig(): TalentConfig {
    const config = this.app.config.get<Partial<TalentConfig>>('talent') ?? {};
    return {
      timeZone: config.timeZone || DEFAULT_TIME_ZONE,
      dailyCron: config.dailyCron || '0 9 * * *',
      companyName: config.companyName || '',
      examCompetency: {
        minWeight: config.examCompetency?.minWeight ?? 0.2,
        fullRate: config.examCompetency?.fullRate ?? 0.9,
        partialRate: config.examCompetency?.partialRate ?? 0.7,
      },
    };
  }

  /**
   * Runs an automation triggered by a business event in the background, so
   * the request that caused it (a publish, a submission) does not wait for the
   * AI. The automation records its own outcome; this only logs a crash.
   */
  private inBackground(label: string, run: () => Promise<unknown>): void {
    setImmediate(() => {
      void run().catch((error: unknown) => {
        this.app.container
          .resolve(loggingToken)
          .getLogger('hr')
          .warn({ error, automation: label }, 'HR automation failed');
      });
    });
  }

  private registerAutomation(): void {
    const container = this.app.container;
    container.singleton(automationServiceToken, () =>
      createAutomationService({ platform: container.resolve(platformToken) }),
    );
    container.singleton(automationTasksToken, () =>
      createAutomationTasks({
        container,
        automation: container.resolve(automationServiceToken),
        ai: createAIRunner(container),
        platform: container.resolve(platformToken),
        organization: () => container.resolve(organizationServiceToken),
        locale: () => container.resolve(i18nToken).getDefaultLocale(),
      }),
    );
    container.singleton(demoBatchServiceToken, () =>
      createDemoBatchService({ platform: container.resolve(platformToken) }),
    );
  }

  /** V2 step 5: learning paths, offline sessions, practice and learning plans. */
  private registerTraining(): void {
    const container = this.app.container;
    container.singleton(pathServiceToken, () =>
      createPathService({ platform: container.resolve(platformToken) }),
    );
    container.singleton(sessionServiceToken, () => {
      const organization = container.resolve(organizationServiceToken);
      return createSessionService({
        platform: container.resolve(platformToken),
        onCourseCompleted: () => this.courseCompletedHandler,
        departmentTitle: async (id) => {
          const department = await organization.getDepartment(id);
          return department ? organization.titleText(department.title) : id;
        },
      });
    });
    container.singleton(practiceServiceToken, () =>
      createPracticeService({
        platform: container.resolve(platformToken),
        ai: createAIRunner(container),
        onPracticePassed: () => (employeeId) =>
          container.resolve(pathServiceToken).syncEmployee(employeeId),
      }),
    );
    container.singleton(planServiceToken, () =>
      createPlanService({
        platform: container.resolve(platformToken),
        paths: container.resolve(pathServiceToken),
      }),
    );
  }

  private registerExams(): void {
    const container = this.app.container;
    container.singleton(examServiceToken, () =>
      createExamService({
        platform: container.resolve(platformToken),
        learning: container.resolve(learningServiceToken),
        examCompetency: () => this.talentConfig().examCompetency,
        onExamPassed: () => async (employeeId) => {
          await container
            .resolve(certificationServiceToken)
            .evaluate(employeeId);
          await container.resolve(pathServiceToken).syncEmployee(employeeId);
        },
        onRecertificationExhausted: () => (attemptId) =>
          this.inBackground('certificationSteward.remedialLearning', () =>
            container
              .resolve(automationTasksToken)
              .onRecertificationExhausted(attemptId),
          ),
      }),
    );
    container.singleton(certificationServiceToken, () => {
      const i18n = container.resolve(i18nToken);
      return createCertificationService({
        platform: container.resolve(platformToken),
        learning: container.resolve(learningServiceToken),
        companyName: () => this.talentConfig().companyName,
        titleText: (title) => {
          if (typeof title === 'string') {
            try {
              const parsed = JSON.parse(title) as { key?: string; ns?: string };
              if (parsed && typeof parsed.key === 'string')
                return i18n.getFixedT(
                  parsed.ns ?? 'hr',
                  i18n.getDefaultLocale(),
                )(parsed.key);
            } catch {
              return title;
            }
            return title;
          }
          if (title && typeof title === 'object' && 'key' in title) {
            const descriptor = title as { key: string; ns?: string };
            return i18n.getFixedT(
              descriptor.ns ?? 'hr',
              i18n.getDefaultLocale(),
            )(descriptor.key);
          }
          return str(title ?? '');
        },
      });
    });
    container.singleton(insightServiceToken, () => {
      const organization = container.resolve(organizationServiceToken);
      return createInsightService({
        platform: container.resolve(platformToken),
        learning: container.resolve(learningServiceToken),
        departmentTitle: async (id) => {
          const department = await organization.getDepartment(id);
          return department ? organization.titleText(department.title) : id;
        },
      });
    });
    this.courseCompletedHandler = async (employeeId) => {
      await container.resolve(certificationServiceToken).evaluate(employeeId);
      await container.resolve(pathServiceToken).syncEmployee(employeeId);
    };
  }

  public override async boot(): Promise<void> {
    const container = this.app.container;
    const authz: AppAuthorization = container.resolve(authorizationToken);
    const database = container.resolve(databaseManagerToken);
    const organization = container.resolve(organizationServiceToken);

    for (const collection of [
      { name: 'workItems', title: 'workbench.title' },
      { name: 'personnelSettings', title: 'attendance.settings.title' },
      { name: 'shifts', title: 'attendance.settings.shifts' },
      { name: 'attendanceRules', title: 'attendance.settings.rules' },
      { name: 'shiftSchedules', title: 'attendance.settings.schedules' },
      { name: 'leaveTypes', title: 'attendance.leave.types' },
      { name: 'leaveBalances', title: 'attendance.leave.balances' },
      { name: 'leaveRequests', title: 'attendance.leave.requests' },
      { name: 'attendanceRecords', title: 'attendance.records' },
      ...HR_COLLECTIONS,
      ...LEARNING_COLLECTIONS,
      ...EXAM_COLLECTIONS,
      ...TRAINING_COLLECTIONS,
      ...AUTOMATION_COLLECTIONS,
    ]) {
      authz.database.collections.add({
        name: collection.name,
        title: label(collection.title),
      });
    }
    authz.ui.sections.add({
      name: 'talent',
      title: label('authz.section.talent'),
      parent: 'business',
    });
    authz.ui.groups.add({
      name: 'talent.framework',
      title: label('authz.group.framework'),
    });
    authz.ui.groups.add({
      name: 'talent.people',
      title: label('authz.group.people'),
    });
    authz.ui.groups.add({
      name: 'talent.hrCore',
      title: label('authz.group.hrCore'),
    });
    authz.ui.groups.add({
      name: 'talent.learning',
      title: label('authz.group.learning'),
    });
    authz.ui.groups.add({
      name: 'talent.exams',
      title: label('authz.group.exams'),
    });
    authz.ui.groups.add({
      name: 'talent.training',
      title: label('authz.group.training'),
    });
    authz.ui.groups.add({
      name: 'talent.demo',
      title: label('authz.group.demo'),
    });
    const groupOf: Record<string, string> = {
      'talent.employee': 'talent.people',
      'talent.assessment': 'talent.people',
      'talent.profile': 'talent.people',
      'talent.framework': 'talent.framework',
      'talent.competency': 'talent.framework',
      'talent.frameworkAdvisor': 'talent.framework',
      'talent.hrAssistant': 'talent.people',
    };
    for (const resource of [
      ...HR_COMPOSITES,
      workbenchResource,
      attendanceSettingsResource,
      leaveResource,
      scheduleResource,
    ]) {
      // The builders differ in their action maps; register each by its built definition.
      const reference = authz.compositeResources.define(resource.build());
      authz.ui.place(reference, {
        section: 'talent',
        group: groupOf[reference.name] ?? 'talent.hrCore',
      });
    }
    for (const resource of LEARNING_COMPOSITES) {
      const reference = authz.compositeResources.define(resource.build());
      authz.ui.place(reference, {
        section: 'talent',
        group: 'talent.learning',
      });
    }
    for (const resource of EXAM_COMPOSITES) {
      const reference = authz.compositeResources.define(resource.build());
      authz.ui.place(reference, {
        section: 'talent',
        group: reference.name === 'demo.batch' ? 'talent.demo' : 'talent.exams',
      });
    }
    for (const resource of TRAINING_COMPOSITES) {
      const reference = authz.compositeResources.define(resource.build());
      authz.ui.place(reference, {
        section: 'talent',
        group: 'talent.training',
      });
    }
    registerRecordAccess(authz, database, organization);
    const releaseOrganization = registerSubjects(authz, database, organization);
    // 认证即权限: each enabled certification is a flat subject whose members hold a valid or expiring certificate.
    const certifications = container.resolve(certificationServiceToken);
    const releaseCertification = authz.subjects.add(CERTIFICATION_SUBJECT, {
      resolveFor: async (principal) =>
        principal.type === 'user'
          ? certifications.heldCertificationIds(String(principal.id))
          : [],
      filterActive: (ids, transaction) =>
        certifications.activeCertificationIds(ids, transaction as never),
      administration: {
        title: label('certifications.subjectTitle'),
        selection: {
          type: 'collection',
          list: (query) => certifications.subjectOptions(query),
          resolve: (ids) => certifications.resolveSubjects(ids),
        },
      },
    });
    this.releaseSubjects = () => {
      releaseOrganization();
      releaseCertification();
    };

    authz.ui.sections.add({
      name: 'talent.admin',
      title: label('authz.section.talentAdmin'),
      parent: 'administration',
    });
    authz.settings.add({
      id: DEPARTMENTS_SETTINGS,
      title: label('departments.settingsTitle'),
      actions: [
        { name: 'read', title: label('authz.actions.read') },
        { name: 'update', title: label('authz.actions.update') },
      ],
    });
    authz.ui.place(
      { type: 'settings', id: DEPARTMENTS_SETTINGS },
      { section: 'talent.admin' },
    );
    authz.settings.add({
      id: AI_AUTOMATIONS_SETTINGS,
      title: label('aiAutomations.settingsTitle'),
      actions: [{ name: 'read', title: label('authz.actions.read') }],
    });
    authz.ui.place(
      { type: 'settings', id: AI_AUTOMATIONS_SETTINGS },
      { section: 'talent.admin' },
    );
    authz.settings.add({
      id: HR_ADMIN_SETTINGS,
      title: label('authz.hrAdmin.title'),
      actions: [
        { name: 'administer', title: label('authz.hrAdmin.administer') },
      ],
    });
    authz.ui.place(
      { type: 'settings', id: HR_ADMIN_SETTINGS },
      { section: 'talent.admin' },
    );

    if (container.has(schedulerServiceToken)) {
      const scheduler = container.resolve(schedulerServiceToken);
      const logger = container.resolve(loggingToken).getLogger('hr');
      scheduler.registerTarget({
        type: 'app.hr-daily',
        title: 'HR daily maintenance',
        validate: (config) =>
          config !== null &&
          typeof config === 'object' &&
          !Array.isArray(config)
            ? { valid: true }
            : { valid: false, reason: 'config-must-be-an-object' },
        start: async (_config, context) => {
          const report = await runDailyMaintenance(container);
          logger.info(
            { ...report, occurrenceId: context.occurrenceId },
            'HR daily maintenance',
          );
          return {
            state: 'completed',
            outcome: 'succeeded',
            result: { ...report },
          };
        },
      });
      scheduler.registerTarget({
        type: 'app.hr-minutely',
        title: 'HR background work',
        validate: (config) =>
          config !== null &&
          typeof config === 'object' &&
          !Array.isArray(config)
            ? { valid: true }
            : { valid: false, reason: 'config-must-be-an-object' },
        start: async () => {
          const report = await runMinuteMaintenance(container);
          return {
            state: 'completed',
            outcome: 'succeeded',
            result: { ...report },
          };
        },
      });
      scheduler.registerTarget({
        type: 'app.hr-ai-automations',
        title: 'AI employees: scheduled proactive work',
        validate: (config) =>
          config !== null &&
          typeof config === 'object' &&
          !Array.isArray(config)
            ? { valid: true }
            : { valid: false, reason: 'config-must-be-an-object' },
        start: async () => {
          const report = await container
            .resolve(automationTasksToken)
            .runDue(new Date());
          return {
            state: 'completed',
            outcome: 'succeeded',
            result: { ...report },
          };
        },
      });
      // Hourly: each automation's own run time, switch and owner live in its settings, which administrators edit.
      scheduler.defineSchedule({
        key: 'hr.ai-automations',
        title:
          'AI employees: scheduled proactive work (position drafting, dictionary review, knowledge gap report, weekly brief)',
        schedule: { cron: '0 * * * *', timezone: this.talentConfig().timeZone },
        target: { type: 'app.hr-ai-automations', config: {} },
      });
      scheduler.defineSchedule({
        key: 'hr.minute-maintenance',
        title:
          'HR background work: document extraction, timed-out exam attempts, finished training sessions and idle practices',
        schedule: { cron: '* * * * *', timezone: this.talentConfig().timeZone },
        target: { type: 'app.hr-minutely', config: {} },
      });
      scheduler.defineSchedule({
        key: 'hr.daily-maintenance',
        title:
          'HR daily maintenance: personnel actions, probation, contracts, learning and certificates',
        schedule: {
          cron: this.talentConfig().dailyCron,
          timezone: this.talentConfig().timeZone,
        },
        target: { type: 'app.hr-daily', config: {} },
      });
    }
  }

  public override shutdown(): Promise<void> {
    this.releaseSubjects?.();
    return Promise.resolve();
  }
}

export {
  hrCoreServiceToken,
  knowledgeServiceToken,
  learningServiceToken,
  organizationServiceToken,
  talentServiceToken,
};
