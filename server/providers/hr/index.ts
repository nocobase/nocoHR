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
import { documentConflictResource } from './content-resources.js';
import { createWorkItemStore, workItemText } from './work-item-store.js';
import { createCustomFieldService } from './custom-fields.js';
import { createPersonnelSettingsService } from './personnel-settings.js';
import { createJobEventProcessor } from './job-events.js';
import path from 'node:path';
import { DEMO_DIRECTORY } from '../../../database/seed-data/org-sync-mock.js';
import { createAliasService } from './org-sync/alias-service.js';
import { createMockSource } from './org-sync/source.js';
import { createFeishuSource } from './org-sync/feishu-source.js';
import { scheduleChecklistProvider } from './schedule-checklist.js';
import { createFeishuApi, type FeishuApi } from './feishu/api.js';
import { createFeishuTransport } from './feishu/transport.js';
import { startFeishuLongConnection } from './feishu/long-connection.js';
import { createOrgSyncService } from './org-sync/sync-service.js';
import { createAiEntryService } from './ai-entry-service.js';
import { createImChannel } from './im-channel.js';
import { createAttendanceSettingsService } from './attendance-settings.js';
import { attendanceSettingsResource } from './attendance-settings-resource.js';
import { createLeaveService } from './leave-service.js';
import { createLeaveRequestService } from './leave-request-service.js';
import { leaveResource } from './leave-resources.js';
import { scheduleResource } from './schedule-resources.js';
import { createScheduleService } from './schedule-service.js';
import { createAttendanceEngine } from './attendance-engine.js';
import { createAttendanceService } from './attendance-service.js';
import { createAdjustmentService } from './adjustment-service.js';
import {
  registerAttendanceCards,
  sendInvitationCards,
} from './attendance-cards.js';
import { runAttendanceTask } from './attendance-tasks.js';
import {
  adjustmentResource,
  attendanceRecordResource,
} from './attendance-resources.js';
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
// V3-10
import { createExamSettingsService } from './exam-settings.js';
import { registerCertificateHooks } from './certificate-hooks.js';
import { createInsightService } from './insight-service.js';
import { createKnowledgeService } from './knowledge-service.js';
import { createLearningService } from './learning-service.js';
import {
  LEARNING_COLLECTIONS,
  LEARNING_COMPOSITES,
} from './learning-resources.js';
import {
  dailyRunDue,
  runDailyMaintenance,
  runScheduledOrgSync,
  runMinuteMaintenance,
} from './maintenance.js';
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
import { addDays, label, str, today } from './shared.js';
import { createAccessExplainer } from './access-explain.js';
import { createChecklistService } from './change-checklists.js';
import { createSettingsDraftService } from './settings-drafts.js';
import { createComplianceService } from './compliance.js';
import type { ActorContext } from './framework-service.js';
import { registerSubjects } from './subjects.js';
import { createTalentService } from './talent-service.js';
// V3-08
import { createCompetencyService } from './competency-service.js';
import { onRequirementsFirstConfirmed } from './framework-service.js';
import { competencyServiceToken } from './tokens.js';
// V3-08 end
// V3-09
import { createLearningJobEvents } from './learning-job-events.js';
import { createLearningSettings } from './learning-settings.js';
import { learningJobEventsToken, learningSettingsToken } from './tokens.js';
// V3-09 end
// V3-11
import { createProfileServices } from './profile/index.js';
import {
  PROFILE_COLLECTIONS,
  PROFILE_COMPOSITES,
} from './profile/resources.js';
import { createRevisionService } from './revision-service.js';
import { profileServicesToken, revisionServiceToken } from './tokens.js';
import type { TalentProfileConfig } from '../../config/talent-profile.js';
// V3-11 end
// V2-06
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { salaryChecklistProvider } from './payroll/events.js';
import { createPayrollServices } from './payroll/index.js';
import {
  PAYROLL_COLLECTIONS,
  PAYROLL_COMPOSITES,
} from './payroll/resources.js';
import { payrollServicesToken } from './tokens.js';
// V2-06 邮件往来
import type { MailConfig } from '../../config/mail.js';
import { createBillingMailHandler } from './mail/billing.js';
import { createAuditMail } from './mail/audit.js';
import { createRecruitingMailHandler } from './mail/recruiting.js';
import { extractResumeText, readIdentity } from './recruiting/resume-text.js';
import { createMailService } from './mail/service.js';
import { createMailSettingsService } from './mail/settings.js';
import {
  billingMailToken,
  recruitingMailToken,
  auditMailToken,
  mailServiceToken,
  mailSettingsToken,
} from './tokens.js';
// V2-06 end
// V2-07
import { createRecruitingServices } from './recruiting/index.js';
import {
  RECRUITING_COLLECTIONS,
  RECRUITING_COMPOSITES,
} from './recruiting/resources.js';
import { recruitingServicesToken } from './tokens.js';
// V2-07 end
// V4-12
import { createPerformanceServices } from './performance/index.js';
import {
  PERFORMANCE_COLLECTIONS,
  PERFORMANCE_COMPOSITES,
} from './performance/resources.js';
import { registerPerformanceRecordAccess } from './performance/record-access.js';
import { performanceServicesToken } from './tokens.js';
// V4-12 end
// V4-13
import { createTalentReviewServices } from './talent-review/index.js';
import {
  TALENT_REVIEW_COLLECTIONS,
  TALENT_REVIEW_COMPOSITES,
} from './talent-review/resources.js';
import { registerTalentReviewRecordAccess } from './talent-review/record-access.js';
import { talentReviewServicesToken } from './tokens.js';
// V4-14
import { createLicensedServices } from './licensed/index.js';
import { LICENSED_COMPOSITES } from './licensed/resources.js';
import { licensedServicesToken } from './tokens.js';
// V4-14 end
// V4-13 end
import type { TalentConfig } from '../../config/talent.js';
import type { FeishuConfig } from '../../config/feishu.js';
import {
  automationServiceToken,
  automationTasksToken,
  certificationServiceToken,
  demoBatchServiceToken,
  examServiceToken,
  // V3-10
  examSettingsToken,
  hrCoreServiceToken,
  accessExplainerToken,
  checklistServiceToken,
  settingsDraftServiceToken,
  complianceServiceToken,
  customFieldServiceToken,
  personnelSettingsToken,
  attendanceSettingsToken,
  leaveServiceToken,
  leaveRequestServiceToken,
  scheduleServiceToken,
  attendanceEngineToken,
  attendanceServiceToken,
  adjustmentServiceToken,
  insightServiceToken,
  jobEventProcessorToken,
  aiEntryServiceToken,
  imChannelToken,
  orgSyncServiceToken,
  positionAliasServiceToken,
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
    this.app.container.singleton(attendanceEngineToken, () => {
      const platform = this.app.container.resolve(platformToken);
      return createAttendanceEngine({
        timeZone: platform.timeZone,
        departments: (connection) => platform.organization.listTree(connection),
      });
    });
    this.app.container.singleton(leaveRequestServiceToken, () => {
      const platform = this.app.container.resolve(platformToken);
      return createLeaveRequestService({
        database: platform.database,
        currentDate: platform.currentDate,
        organization: platform.organization,
        timeZone: platform.timeZone,
        engine: () => this.app.container.resolve(attendanceEngineToken),
        onLeaveConflict: () => (input) => this.onLeaveConflict(input),
        // V2-05 (realigned): approvers are told of each pending level (an 审批卡片 in Feishu).
        notify: this.notifier(),
        hrRecipients: () =>
          this.app.container.resolve(hrCoreServiceToken).hrAdministrators(),
        customFields: () => this.app.container.resolve(customFieldServiceToken),
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
        notify: this.notifier(),
        engine: () => this.app.container.resolve(attendanceEngineToken),
        // V2-05 (realigned): 发出顶班邀请 sends 顶班邀请 cards (attendance-cards.ts).
        inviteCards: () => (input) =>
          sendInvitationCards(this.app.container, input),
      });
    });
    this.app.container.singleton(attendanceServiceToken, () =>
      createAttendanceService({
        platform: this.app.container.resolve(platformToken),
        engine: this.app.container.resolve(attendanceEngineToken),
        hrRecipients: () =>
          this.app.container.resolve(hrCoreServiceToken).hrAdministrators(),
      }),
    );
    this.app.container.singleton(adjustmentServiceToken, () =>
      createAdjustmentService({
        platform: this.app.container.resolve(platformToken),
        engine: this.app.container.resolve(attendanceEngineToken),
        hrRecipients: () =>
          this.app.container.resolve(hrCoreServiceToken).hrAdministrators(),
        validateCells: (connection, cells) =>
          this.app.container
            .resolve(scheduleServiceToken)
            .validateTrusted(connection, cells),
        customFields: () => this.app.container.resolve(customFieldServiceToken),
      }),
    );
    this.app.container.singleton(personnelSettingsToken, () =>
      createPersonnelSettingsService(
        this.app.container.resolve(databaseManagerToken),
      ),
    );
    this.app.container.singleton(customFieldServiceToken, () =>
      createCustomFieldService(
        this.app.container.resolve(databaseManagerToken),
      ),
    );
    this.registerChangeChecklists();
    this.registerAssistantConfig();
    this.registerOrgSync();
    this.app.container.singleton(imChannelToken, () =>
      createImChannel({
        platform: this.app.container.resolve(platformToken),
        entry: () => this.app.container.resolve(aiEntryServiceToken),
        ai: createAIRunner(this.app.container),
        // Absolute once an origin is known: a Feishu message has no base URL.
        publicUrl: (path) => this.feishuLink(path),
        // The configured Feishu app replaces the development mock channel.
        ...(this.feishuApp()
          ? {
              transport: createFeishuTransport({
                api: this.feishuApp()!.api,
                link: (path) => this.feishuLink(path),
                messages: {
                  get: async (cardId) => {
                    const row = await this.app.container
                      .resolve(databaseManagerToken)
                      .query()
                      .selectFrom('imCards')
                      .select(['externalMessageId'])
                      .where('id', '=', cardId)
                      .executeTakeFirst();
                    return row?.externalMessageId
                      ? str(row.externalMessageId)
                      : null;
                  },
                  set: async (cardId, messageId) => {
                    await this.app.container
                      .resolve(databaseManagerToken)
                      .query()
                      .updateTable('imCards')
                      .set({ externalMessageId: messageId })
                      .where('id', '=', cardId)
                      .execute();
                  },
                },
              }),
            }
          : {}),
        // V1-04 飞书卡片与推送: the card kinds call the core service; texts come from the server locales.
        core: () => this.app.container.resolve(hrCoreServiceToken),
        translate: async () => {
          const i18n = this.app.container.resolve(i18nToken);
          const locale = i18n.getDefaultLocale();
          await i18n.ensureLocaleLoaded(locale);
          const t = i18n.getFixedT('hr', locale);
          return (key, values) => String(t(key, values));
        },
        warn: (detail, message) =>
          this.app.container
            .resolve(loggingToken)
            .getLogger('hr')
            .warn(detail, message),
        production: process.env.NODE_ENV === 'production',
      }),
    );
    this.app.container.singleton(aiEntryServiceToken, () => {
      const container = this.app.container;
      const authz = container.resolve(authorizationToken);
      return createAiEntryService({
        database: container.resolve(databaseManagerToken),
        ai: createAIRunner(container),
        timeZone: this.talentConfig().timeZone,
        holdersOf: (key) =>
          container.resolve(hrCoreServiceToken).holdersOf(key),
        permissionSetKeys: async () =>
          (await authz.permissionSets.list()).map((set) => set.key),
        // The AI employees registered in server/ai/index.ts.
        employees: () =>
          Promise.resolve([
            'knowledgeAssistant',
            'hrAssistant',
            'frameworkAdvisor',
            'contentWriter',
            'certificationSteward',
            'learningCoach',
            'practiceCoach',
            // V3-10
            'examiner',
            // V3-11
            'talentAnalyst',
            // V2-07
            'recruitingAssistant',
            // V4-12
            'performanceAssistant',
          ]),
      });
    });
    this.app.container.singleton(jobEventProcessorToken, () =>
      createJobEventProcessor({
        database: this.app.container.resolve(databaseManagerToken),
        onError: (error, event, handler) =>
          this.app.container
            .resolve(loggingToken)
            .getLogger('hr')
            .warn(
              { error, eventId: event.id, handler },
              'Job event handler failed; the daily run retries it',
            ),
      }),
    );
    this.registerLearning();
    this.registerExams();
    this.registerTraining();
    this.registerAutomation();
    // V3-08
    this.registerCompetency();
    // V3-08 end
    // V3-11
    this.registerProfile();
    // V3-11 end
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
        settings: this.app.container.resolve(personnelSettingsToken),
        customFields: this.app.container.resolve(customFieldServiceToken),
        jobEvents: () => this.app.container.resolve(jobEventProcessorToken),
        orgMaster: async () =>
          (await this.app.container.resolve(orgSyncServiceToken).readSettings())
            .value.orgMaster,
        onEmployeesImported: () => (batchId) =>
          this.inBackground('hrAssistant.importCheck', () =>
            this.app.container
              .resolve(automationTasksToken)
              .onEmployeesImported(batchId),
          ),
        onAssessmentRecorded: () => (employeeId) =>
          this.inBackground('competency.assessmentRecorded', () =>
            this.app.container
              .resolve(automationTasksToken)
              .onAssessmentRecorded(employeeId),
          ),
      }),
    );
    this.app.container.singleton(hrCoreServiceToken, () => {
      const container = this.app.container;
      const users = container.resolve(userAdministrationServiceToken);
      return createHrCoreService({
        settings: container.resolve(personnelSettingsToken),
        customFields: container.resolve(customFieldServiceToken),
        jobEvents: () => container.resolve(jobEventProcessorToken),
        orgMaster: async () =>
          (await container.resolve(orgSyncServiceToken).readSettings()).value
            .orgMaster,
        syncIssues: () => container.resolve(orgSyncServiceToken),
        database: container.resolve(databaseManagerToken),
        authz: container.resolve(authorizationToken),
        organization: container.resolve(organizationServiceToken),
        talent: container.resolve(talentServiceToken),
        users,
        timeZone: this.talentConfig().timeZone,
        onActionChanged: () => (actionId) => this.syncChecklist(actionId),
        onContractChanged: () => (employeeId) =>
          this.inBackground('hrAssistant.compliance', () =>
            container
              .resolve(automationTasksToken)
              .onComplianceTrigger(employeeId),
          ),
        onAttachmentUploaded: () => (input) =>
          this.inBackground('hrAssistant.extractAttachment', () =>
            container.resolve(automationTasksToken).onAttachmentUploaded(input),
          ),
        createAccount: async (input, connection) =>
          users.withConnection(connection).create(input),
        notify: this.notifier(),
      });
    });
    // V2-06 薪酬与社保
    this.registerPayroll();
    // V2-06 end
    // V2-06 邮件往来 (总纲 邮件约定)
    this.registerMail();
    this.registerRecruitingMail();
    this.registerAuditMail();
    // V2-06 邮件往来 end
    // V2-07 用工计划与招聘入职
    this.registerRecruiting();
    // V2-07 end
    // V4-12 绩效
    this.registerPerformance();
    // V4-12 end
    // V4-13 人才盘点与其他
    this.registerTalentReview();
    // V4-13 end
    // V4-14 行业方案 · 持证上岗
    this.registerLicensed();
    // V4-14 end
  }

  /**
   * V2-06 邮件往来 (mail/): the business mailboxes' store, the 设置 / 邮件
   * data and the billing mailbox's handler. Handlers are attached in boot();
   * later steps register theirs the same way.
   */
  private registerMail(): void {
    const container = this.app.container;
    const production = process.env.NODE_ENV === 'production';
    container.singleton(mailSettingsToken, () =>
      createMailSettingsService(container.resolve(databaseManagerToken)),
    );
    container.singleton(mailServiceToken, () =>
      createMailService({
        database: container.resolve(databaseManagerToken),
        settings: container.resolve(mailSettingsToken),
        config: () => this.mailConfig(),
        storageDir: () => this.app.paths.storage(),
        drive: () => container.resolve(driveManagerToken),
        production,
        sendEmail: async (input) => {
          if (!container.has(notificationServiceToken))
            return 'channelNotConfigured';
          try {
            await container.resolve(notificationServiceToken).send({
              idempotencyKey: input.idempotencyKey,
              source: { type: 'hr.mail', referenceId: input.idempotencyKey },
              messages: {
                [input.channel]: {
                  to: input.to,
                  replyTo: input.replyTo,
                  subject: input.subject,
                  text: input.text,
                },
              },
            });
            return 'sent';
          } catch (error) {
            const code = str(
              (error as { code?: unknown }).code ??
                (error as Error).message ??
                '',
            );
            return /CHANNEL|UNKNOWN|DISABLED|NOT_FOUND/iu.test(code)
              ? 'channelNotConfigured'
              : 'failed';
          }
        },
        notify: this.notifier(),
        log: (fields, message) =>
          container.resolve(loggingToken).getLogger('hr').warn(fields, message),
      }),
    );
    container.singleton(billingMailToken, () => {
      const database = container.resolve(databaseManagerToken);
      const platform = container.resolve(platformToken);
      return createBillingMailHandler({
        mail: container.resolve(mailServiceToken),
        settings: container.resolve(mailSettingsToken),
        bills: () => container.resolve(payrollServicesToken).bills,
        payrollUsers: () =>
          container.resolve(hrCoreServiceToken).holdersOf('hr.payroll'),
        today: () => platform.currentDate(),
        run: (key, options, work) =>
          container
            .resolve(automationServiceToken)
            .run(key, 'event', options, work),
        setSourceMail: async (billId, mailId) => {
          await database
            .query()
            .updateTable('laborVendorBills')
            .set({ sourceMailId: mailId })
            .where('id', '=', billId)
            .execute();
        },
        billSourceMail: async (billId) => {
          const bill = await database
            .query()
            .selectFrom('laborVendorBills')
            .select(['sourceMailId'])
            .where('id', '=', billId)
            .executeTakeFirst();
          if (!bill?.sourceMailId) return null;
          // The latest message from the vendor in that thread: a correction is answered in turn.
          const source = await database
            .query()
            .selectFrom('mailMessages')
            .select(['id', 'threadKey'])
            .where('id', '=', str(bill.sourceMailId))
            .executeTakeFirst();
          if (!source) return null;
          const latest = await database
            .query()
            .selectFrom('mailMessages')
            .select(['id'])
            .where('threadKey', '=', String(source.threadKey))
            .where('direction', '=', 'inbound')
            .orderBy('createdAt', 'desc')
            .executeTakeFirst();
          return latest ? String(latest.id) : String(source.id);
        },
        billFor: async (vendorName, month) => {
          const bill = await database
            .query()
            .selectFrom('laborVendorBills')
            .select(['id'])
            .where('vendorName', '=', vendorName)
            .where('month', '=', month)
            .executeTakeFirst();
          return bill ? String(bill.id) : null;
        },
        notify: this.notifier(),
      });
    });
  }

  /**
   * V2-07 招聘邮箱: resumes by mail go through the recruiting intake, and a
   * candidate's replies come back to the application (mail/recruiting.ts).
   */
  private registerRecruitingMail(): void {
    const container = this.app.container;
    container.singleton(recruitingMailToken, () => {
      const database = container.resolve(databaseManagerToken);
      const recruiting = () => container.resolve(recruitingServicesToken);
      const recruiterOf = async (postingId: string) => {
        const posting = await recruiting().postings.get(postingId);
        const requisition = await recruiting().requisitions.get(
          posting.requisitionId,
        );
        return requisition.recruiterUserId ?? null;
      };
      return createRecruitingMailHandler({
        mail: container.resolve(mailServiceToken),
        settings: container.resolve(mailSettingsToken),
        run: (key, options, work) =>
          container
            .resolve(automationServiceToken)
            .run(key, 'event', options, work),
        publishedPostings: async () =>
          (
            await database
              .query()
              .selectFrom('jobPostings')
              .select(['id', 'title', 'requisitionId'])
              .where('status', '=', 'published')
              .execute()
          ).map((r) => ({
            id: String(r.id),
            title: String(r.title),
            requisitionId: String(r.requisitionId),
          })),
        recruiterOf,
        recruiters: () =>
          container.resolve(hrCoreServiceToken).holdersOf('hr.recruiter'),
        applicationForAddress: async (address) => {
          const found = await database
            .query()
            .selectFrom('applications')
            .innerJoin(
              'candidates',
              'candidates.id',
              'applications.candidateId',
            )
            .select(['applications.id as id'])
            .where('candidates.email', '=', address.trim().toLowerCase())
            .where('candidates.anonymizedAt', 'is', null)
            .where('applications.stage', 'not in', [
              'hired',
              'rejected',
              'withdrawn',
            ])
            .orderBy('applications.updatedAt', 'desc')
            .executeTakeFirst();
          return found ? String(found.id) : null;
        },
        intake: async (input) => {
          const services = recruiting();
          const posting = await services.postings.get(input.postingId);
          const mimeType = await services.candidates.validateResume(
            input.file,
            false,
          );
          const text = await extractResumeText(
            input.file.bytes,
            input.file.name,
            mimeType,
          );
          const identity = text
            ? readIdentity(text)
            : { name: null, phone: null, email: null };
          // The resume's own contact details first: a job site forwards from its own address.
          const email = identity.email ?? input.fromAddress;
          const outcome = await services.candidates.intake({
            posting,
            name:
              identity.name ??
              input.fromName ??
              input.file.name.replace(/\.[^.]+$/u, ''),
            phone: identity.phone,
            email,
            file: { ...input.file, mimeType },
            sourceChannel: 'email',
            consentBy: 'email',
            knockoutAnswers: [],
            customFields: {},
            by: input.by,
          });
          const candidate = await services.candidates.candidateRow(
            outcome.candidateId,
          );
          return {
            applicationId: outcome.applicationId,
            candidateName: candidate.name,
            created: outcome.created,
            email: candidate.email,
          };
        },
        application: async (id) => {
          const services = recruiting();
          const application = await services.candidates
            .applicationRow(id)
            .catch(() => null);
          if (!application) return null;
          const candidate = await services.candidates.candidateRow(
            application.candidateId,
          );
          const posting = await services.postings.get(application.postingId);
          return {
            id,
            postingId: posting.id,
            postingTitle: posting.title,
            candidateName: candidate.name,
            stage: application.stage,
          };
        },
        retentionMonths: async () =>
          (await recruiting().context.settings()).retention.months,
        sendEmail: (input) => recruiting().context.sendEmail(input),
        receiptSince: async (address, since) =>
          Boolean(
            await database
              .query()
              .selectFrom('mailMessages')
              .select(['id'])
              .where('mailbox', '=', 'recruiting')
              .where(
                'messageId',
                'like',
                `<recruiting:receipt:${address.toLowerCase()}:%`,
              )
              .where('createdAt', '>=', since)
              .executeTakeFirst(),
          ),
        now: () => new Date(),
        notify: this.notifier(),
      });
    });
  }

  /**
   * V3-11 审核邮箱与审核请求: a customer's request for audit material by mail,
   * the confirmed scope's pack and the share link (mail/audit.ts).
   */
  private registerAuditMail(): void {
    const container = this.app.container;
    container.singleton(auditMailToken, () => {
      const database = container.resolve(databaseManagerToken);
      const platform = container.resolve(platformToken);
      const profile = () => container.resolve(profileServicesToken);
      return createAuditMail({
        database,
        mail: container.resolve(mailServiceToken),
        settings: container.resolve(mailSettingsToken),
        run: (key, options, work) =>
          container
            .resolve(automationServiceToken)
            .run(key, 'event', options, work),
        audit: () => profile().audit,
        storePack: (pack) => profile().storeAuditPack(pack),
        readPack: async (fileId) => {
          const file = await profile().reads.readFile(
            container.resolve(driveManagerToken),
            fileId,
          );
          return file && file.filename.startsWith('audit-pack')
            ? { bytes: file.bytes, filename: file.filename }
            : null;
        },
        reviewers: async () => {
          const core = container.resolve(hrCoreServiceToken);
          return [
            ...new Set([
              ...(await core.holdersOf('hr.admin')),
              ...(await core.holdersOf('hr.auditor')),
            ]),
          ];
        },
        // A workshop named the same in several plants is shown with its plant (苏州工厂 · 机加工车间).
        departmentTitle: async (id) => {
          const organization = platform.organization;
          const department = await organization.getDepartment(id);
          if (!department) return id;
          const title = organization.titleText(department.title);
          const parent = department.parentId
            ? await organization.getDepartment(department.parentId)
            : null;
          if (!parent) return title;
          const plant = organization.titleText(parent.title);
          const prefix = plant.replace(/工厂$/u, '');
          return prefix && prefix !== plant && !title.startsWith(prefix)
            ? `${plant}${title}`
            : title;
        },
        positionTitle: async (id) => {
          const position = await database
            .query()
            .selectFrom('positions')
            .select(['title'])
            .where('id', '=', id)
            .executeTakeFirst();
          return position ? str(position.title) : id;
        },
        publicUrl: (path) =>
          `${String(this.app.config.get<{ publicOrigin?: string }>('app')?.publicOrigin ?? '').replace(/\/$/u, '')}${this.app.publicBasePath.replace(/\/$/u, '')}${path}`,
        companyName: () => this.talentConfig().companyName,
        today: () => platform.currentDate(),
        now: () => new Date(),
        notify: this.notifier(),
      });
    });
  }

  private mailConfig(): MailConfig {
    const raw = this.app.config.get<Partial<MailConfig>>('mail') ?? {};
    const fallback = (purpose: string) => ({
      adapter: 'mock' as const,
      address: `${purpose}@qiheng.test`,
      imapHost: '',
      imapPort: 993,
      imapSecure: true,
      imapUser: '',
      imapPassword: '',
    });
    return {
      billing: { ...fallback('billing'), ...raw.billing },
      recruiting: { ...fallback('recruiting'), ...raw.recruiting },
      audit: { ...fallback('audit'), ...raw.audit },
      hr: { ...fallback('hr'), ...raw.hr },
    };
  }

  /**
   * V4-14 行业方案 · 持证上岗 (licensed/): the industry pack's settings, the
   * certification-only protection, 排班资质校验 inputs, 调岗资质检查, the
   * audit exports and the steward's tools. The demonstration pages stay in
   * demo-batch.ts.
   */
  private registerLicensed(): void {
    const container = this.app.container;
    container.singleton(licensedServicesToken, () => {
      const i18n = container.resolve(i18nToken);
      // An untranslated title (e.g. the plugin's built-in sets, whose names only the client ships)
      // yields '' so callers fall back to the set's key rather than a raw i18n path.
      const translate = (key: string, ns?: string) => {
        const text = i18n.getFixedT(ns ?? 'hr', i18n.getDefaultLocale())(key);
        return text === key ? '' : text;
      };
      return createLicensedServices({
        platform: container.resolve(platformToken),
        demoBatch: () => container.resolve(demoBatchServiceToken),
        automation: () => container.resolve(automationServiceToken),
        ai: createAIRunner(container),
        titleText: (title) => {
          if (title && typeof title === 'object' && 'key' in title) {
            const descriptor = title as { key: string; ns?: string };
            return translate(descriptor.key, descriptor.ns);
          }
          if (typeof title === 'string') {
            try {
              const parsed = JSON.parse(title) as { key?: string; ns?: string };
              if (parsed && typeof parsed.key === 'string')
                return translate(parsed.key, parsed.ns);
            } catch {
              return title;
            }
            return title;
          }
          return str(title ?? '');
        },
        audit: (event) =>
          container
            .resolve(loggingToken)
            .getLogger('hr-audit')
            .info(event, 'HR audit'),
        qualificationCover: () => (scheduleId, dedupeKey) =>
          container
            .resolve(automationTasksToken)
            .onQualificationConflict(scheduleId, dedupeKey),
      });
    });
  }

  /**
   * V4-13 人才盘点与其他 (talent-review/). The services authorize the caller's
   * talent.* action and check the record scope before reading or writing; the
   * AI employees' runs start in the background after the request answers.
   */
  private registerTalentReview(): void {
    const container = this.app.container;
    container.singleton(talentReviewServicesToken, () =>
      createTalentReviewServices({
        platform: container.resolve(platformToken),
        ai: createAIRunner(container),
        automation: () => container.resolve(automationServiceToken),
        plans: () => container.resolve(planServiceToken),
        certifications: () => container.resolve(certificationServiceToken),
        knowledge: () => container.resolve(knowledgeServiceToken),
        customFields: () => container.resolve(customFieldServiceToken),
        drive: () => container.resolve(driveManagerToken),
        hrAdministrators: () =>
          container.resolve(hrCoreServiceToken).hrAdministrators(),
        background: (label, run) => this.inBackground(label, run),
      }),
    );
  }

  /**
   * V4-12 绩效 (performance/). The services authorize the caller's talent.*
   * performance action and check the reviewer relation before reading or
   * writing; the performance assistant's runs start in the background after
   * the request answers.
   */
  private registerPerformance(): void {
    const container = this.app.container;
    container.singleton(performanceServicesToken, () =>
      createPerformanceServices({
        platform: container.resolve(platformToken),
        ai: createAIRunner(container),
        automation: () => container.resolve(automationServiceToken),
        plans: () => container.resolve(planServiceToken),
        customFields: () => container.resolve(customFieldServiceToken),
        holdersOf: (key) =>
          container.resolve(hrCoreServiceToken).holdersOf(key),
        hrAdministrators: () =>
          container.resolve(hrCoreServiceToken).hrAdministrators(),
        background: (label, run) => this.inBackground(label, run),
      }),
    );
  }

  /**
   * V2-07 用工计划与招聘入职 (recruiting/). The services authorize the caller's
   * talent.* recruiting action and check the record relation before reading
   * or writing; the assistants' runs start in the background after the
   * request answers. Candidate emails go through the notification channel set
   * in 招聘设置 (none is configured by default: their delivery is recorded as
   * channelNotConfigured).
   */
  private registerRecruiting(): void {
    const container = this.app.container;
    container.singleton(recruitingServicesToken, () =>
      createRecruitingServices({
        container,
        platform: container.resolve(platformToken),
        ai: createAIRunner(container),
        background: (label, run) => this.inBackground(label, run),
        production: process.env.NODE_ENV === 'production',
        // Candidate emails need an absolute link: config.app.publicOrigin (APP_PUBLIC_ORIGIN) and the base path.
        publicUrl: (path) =>
          `${String(this.app.config.get<{ publicOrigin?: string }>('app')?.publicOrigin ?? '').replace(/\/$/u, '')}${this.app.publicBasePath.replace(/\/$/u, '')}${path}`,
        companyName: () => this.talentConfig().companyName,
      }),
    );
  }

  /**
   * V2-06 薪酬与社保 (payroll/). The services read and write only after the
   * caller's talent.* payroll action is authorized; the HR assistant's check
   * and the vendor-bill run start in the background after a calculation or an
   * upload. Payslip verification checks the user's own password through the
   * authentication plugin (no second factor is configured).
   */
  private registerPayroll(): void {
    const container = this.app.container;
    container.singleton(payrollServicesToken, () =>
      createPayrollServices({
        platform: container.resolve(platformToken),
        holdersOf: (key) =>
          container.resolve(hrCoreServiceToken).holdersOf(key),
        drive: () => container.resolve(driveManagerToken),
        verifyPassword: async (userId, password) => {
          // The Better Auth context the authentication plugin's administration service uses; typed by hand
          // because the plugin types it through a private field. Only the credential check is used.
          const context = (await container
            .resolve(authenticationToken)
            .administrationContext()) as unknown as {
            internalAdapter: {
              findCredentialAccount(
                id: string,
              ): Promise<{ password?: string | null } | null | undefined>;
            };
            password: {
              verify(input: {
                hash: string;
                password: string;
              }): Promise<boolean>;
            };
          };
          const account =
            await context.internalAdapter.findCredentialAccount(userId);
          if (!account?.password) return false;
          return context.password.verify({ hash: account.password, password });
        },
        onCalculated: (cycleId, calculationId) =>
          this.inBackground('hrAssistant.payrollCheck', () =>
            container
              .resolve(payrollServicesToken)
              .assistant.check(cycleId, calculationId),
          ),
        onBillUploaded: (billId) =>
          this.inBackground('vendorReconciler.billReview', () =>
            container
              .resolve(payrollServicesToken)
              .assistant.review(billId, new Date().toISOString()),
          ),
        // V2-06 邮件往来: a bill that came by mail gets its reply drafted once reconciled.
        onBillReviewed: (billId) =>
          this.inBackground('hrAssistant.mailReplyBilling', () =>
            container.resolve(billingMailToken).draftForBill(billId),
          ),
        onAdjustmentDecided: (actionId) => this.syncChecklist(actionId),
        // V4-12: perf.coefficient, the bonus cycle and the review result an adjustment links to.
        performance: () => container.resolve(performanceServicesToken).payroll,
        audit: (event) =>
          container
            .resolve(loggingToken)
            .getLogger('hr-audit')
            .info(event, 'HR audit'),
        automation: () => container.resolve(automationServiceToken),
        ai: createAIRunner(container),
      }),
    );
  }

  /**
   * V1-02 变动影响清单 and 用工合规检查. Checklists are owned by the owner of the
   * HR assistant's checklist task (every HR administrator when unset); the
   * assistant rewrites a checklist's notes in the background whenever its
   * items change.
   */
  private registerChangeChecklists(): void {
    const container = this.app.container;
    const database = () => container.resolve(databaseManagerToken);
    const isHrAdmin = (ctx: ActorContext) =>
      ctx.authz.can({
        resource: { type: 'settings', id: HR_ADMIN_SETTINGS },
        action: 'administer',
      });
    const ownerOf = async (key: string): Promise<string[]> => {
      const row = await database()
        .query()
        .selectFrom('aiAutomationSettings')
        .select(['ownerUserId'])
        .where('id', '=', key)
        .executeTakeFirst();
      if (row?.ownerUserId) return [str(row.ownerUserId)];
      return container.resolve(hrCoreServiceToken).hrAdministrators();
    };
    container.singleton(checklistServiceToken, () =>
      createChecklistService({
        database: database(),
        organization: container.resolve(organizationServiceToken),
        customFields: container.resolve(customFieldServiceToken),
        notify: this.notifier(),
        timeZone: this.talentConfig().timeZone,
        owners: () => ownerOf('hrAssistant.checklistNotes'),
        isHrAdmin,
        onItemsChanged: () => (id) =>
          this.inBackground('hrAssistant.checklistNotes', () =>
            container.resolve(automationTasksToken).onChecklistChanged(id),
          ),
        setManager: async (ctx, employeeId, managerId) => {
          await container
            .resolve(talentServiceToken)
            .updateEmployee(ctx, employeeId, { managerEmployeeId: managerId });
        },
      }),
    );
    container.singleton(complianceServiceToken, () =>
      createComplianceService({
        database: database(),
        currentDate: () => today(this.talentConfig().timeZone),
        isHrAdmin,
        settings: async () => {
          const settings = container.resolve(personnelSettingsToken);
          return {
            compliance: (await settings.read('compliance')).value,
            reminderWindowDays: Math.max(
              ...(await settings.read('reminders')).value.contractDays,
            ),
          };
        },
      }),
    );
  }

  /** V1-02 一句话改配置 and 权限说明, used by the HR assistant's conversation tools. */
  private registerAssistantConfig(): void {
    const container = this.app.container;
    const isHrAdmin = (ctx: ActorContext) =>
      ctx.authz.can({
        resource: { type: 'settings', id: HR_ADMIN_SETTINGS },
        action: 'administer',
      });
    container.singleton(settingsDraftServiceToken, () =>
      createSettingsDraftService({
        database: container.resolve(databaseManagerToken),
        settings: container.resolve(personnelSettingsToken),
        customFields: container.resolve(customFieldServiceToken),
        organization: container.resolve(organizationServiceToken),
        core: () => container.resolve(hrCoreServiceToken),
        userName: async (id) =>
          (
            await container
              .resolve(userAdministrationServiceToken)
              .get(id)
              .catch(() => undefined)
          )?.name ?? null,
      }),
    );
    container.singleton(accessExplainerToken, () =>
      createAccessExplainer({
        database: container.resolve(databaseManagerToken),
        authz: container.resolve(authorizationToken),
        organization: container.resolve(organizationServiceToken),
        talent: () => container.resolve(talentServiceToken),
        isHrAdmin,
      }),
    );
  }

  /** Brings an action's change checklist in line with the action, in the background. */
  private syncChecklist(actionId: string): void {
    this.inBackground('changeChecklists.sync', async () => {
      const settings = (
        await this.app.container
          .resolve(personnelSettingsToken)
          .read('checklists')
      ).value;
      await this.app.container
        .resolve(checklistServiceToken)
        .syncAction(actionId, settings);
    });
  }

  /**
   * V1-03 组织同步. No office-suite sync plugin is installed: outside production
   * the directory is the mock file (模拟数据源，仅开发环境), created from the
   * demo directory on first use. `ORG_SYNC_MOCK_FILE` points elsewhere (tests);
   * `ORG_SYNC_CALLBACK_SECRET` signs directory callbacks — unset, every
   * callback is refused. With a Feishu self-built app configured (`feishu`
   * config, FEISHU_APP_ID / FEISHU_APP_SECRET) the real tenant replaces the
   * mock; there is no office-suite plugin to hold those credentials instead.
   */
  private registerOrgSync(): void {
    const container = this.app.container;
    container.singleton(positionAliasServiceToken, () =>
      createAliasService(container.resolve(databaseManagerToken)),
    );
    const feishu = this.feishuApp();
    const live = feishu ? createFeishuSource({ api: feishu.api }) : undefined;
    const mock =
      process.env.NODE_ENV === 'production'
        ? undefined
        : createMockSource(
            process.env.ORG_SYNC_MOCK_FILE ||
              path.resolve(
                process.cwd(),
                'storage',
                'org-sync',
                'feishu-mock.json',
              ),
            DEMO_DIRECTORY,
          );
    container.singleton(orgSyncServiceToken, () => {
      const users = container.resolve(userAdministrationServiceToken);
      const platform = container.resolve(platformToken);
      return createOrgSyncService({
        database: container.resolve(databaseManagerToken),
        organization: container.resolve(organizationServiceToken),
        talent: () => container.resolve(talentServiceToken),
        personnel: container.resolve(personnelSettingsToken),
        jobEvents: () => container.resolve(jobEventProcessorToken),
        source: (provider) =>
          provider === 'feishu' ? (live ?? mock) : undefined,
        createAccount: async (input, connection) =>
          users.withConnection(connection).create(input),
        notify: this.notifier(),
        hrRecipients: async () => {
          const owner = await container
            .resolve(databaseManagerToken)
            .query()
            .selectFrom('aiAutomationSettings')
            .select(['ownerUserId'])
            .where('id', '=', 'hrAssistant.syncExplain')
            .executeTakeFirst();
          return owner?.ownerUserId
            ? [str(owner.ownerUserId)]
            : container.resolve(hrCoreServiceToken).hrAdministrators();
        },
        onRunFinished: () => (run) =>
          this.inBackground('hrAssistant.syncExplain', () =>
            container.resolve(automationTasksToken).onOrgSyncFinished(run),
          ),
        callbackSecret: () => process.env.ORG_SYNC_CALLBACK_SECRET || undefined,
        currentDate: () => platform.currentDate(),
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
        hrProbationPrep: 'probationPrep',
        hrRenewalPrep: 'renewalPrep',
        // V1-02: change checklists and compliance prompts.
        hrChangeChecklist: 'changeChecklist',
        hrChangeChecklistOverdue: 'changeChecklist',
        hrCompliance: 'compliance',
        hrAttachmentExtracted: 'attachmentExtracted',
        // V1-04: the knowledge base's and the sync's items reach the workbench too.
        hrSyncExplained: 'syncIssue',
        automationGapReport: 'gapDigest',
        documentConflictFound: 'docConflict',
        documentReviewDue: 'docReview',
        documentReviewOverdue: 'docReview',
        // V2-05: attendance to-dos.
        scheduleLeaveConflict: 'scheduleConflict',
        replacementSuggested: 'scheduleConflict',
        replacementNone: 'scheduleConflict',
        adjustmentPending: 'attendanceApproval',
        shiftSwapConsent: 'attendanceApproval',
        // V2-05 (realigned): leave approvals, 考勤异常追问 reminders, 顶班邀请 accepted.
        leavePending: 'attendanceApproval',
        attendanceInquiryHead: 'attendanceReminder',
        attendanceInquiryOverdue: 'attendanceReminder',
        replacementAccepted: 'scheduleConflict',
        attendanceSummaryReady: 'attendanceSummary',
        attendanceMissingSelf: 'attendanceReminder',
        attendanceMissingHead: 'attendanceReminder',
        attendanceOvertimeNear: 'attendanceReminder',
        attendanceMonthCheck: 'attendanceCheck',
        // V3-08: the framework advisor's drafts reach the workbench (the monthly review links to settings, so inbox only).
        automationPositionDrafted: 'frameworkDraft',
        // V3-09: a learning plan waiting for its reviewer (closed by plan-service when decided or expired).
        learningPlanDrafted: 'learningPlan',
        // V2-06: payroll to-dos (never an amount in the title or body).
        payrollOnboard: 'payrollFile',
        payrollOffboard: 'payrollInsurance',
        payrollTransfer: 'payrollFile',
        payrollAdjustmentPending: 'payrollApproval',
        payrollCyclePending: 'payrollApproval',
        payrollAnomalies: 'payrollCheck',
        payrollAnomaliesClean: 'payrollCheck',
        payrollInsuranceMonthly: 'payrollInsurance',
        payrollBaseAdjust: 'payrollInsurance',
        payrollVendorBillReviewed: 'payrollVendorBill',
        payrollVendorBillUploaded: 'payrollVendorBill',
        // V2-06 邮件往来: messages to sort and reply drafts to send.
        mailUnmatched: 'mailSort',
        mailReplyReceived: 'mailReply',
        mailDraftReady: 'mailReply',
        // V2-07 招聘邮箱: a resume taken in, a candidate's reply with its drafted answer.
        mailResumeReceived: 'mailSort',
        mailCandidateReplied: 'mailReply',
        // V3-11 审核邮箱: a customer's request to prepare, the reply drafted after the pack.
        mailAuditRequest: 'mailSort',
        mailAuditDraftReady: 'mailReply',
        // V3-11: the talent analyst's suggestions, rule drafts and failed write-backs; the writer's revisions.
        competencySuggestionDrafted: 'aiDecision',
        trainingRecommendationPending: 'aiDecision',
        trainingRecommendationNeedsContent: 'aiDecision',
        signalRuleDrafted: 'signalRule',
        recommendationWritebackFailed: 'signalWriteback',
        revisionReady: 'contentRevision',
        questionQualityFound: 'contentRevision',
        // V2-07: recruiting to-dos (titles carry no candidate name; the office suite gets the title and link only).
        recruitingWorkforceGap: 'workforcePlan',
        recruitingTransferCoordination: 'workforceTransfer',
        recruitingRequisitionDrafted: 'requisition',
        recruitingRequisitionPending: 'requisitionApproval',
        recruitingPostingDrafted: 'postingDraft',
        recruitingPoolSuggested: 'poolReuse',
        recruitingInterviewScheduled: 'interview',
        recruitingInterviewQuestions: 'interview',
        recruitingInterviewSummary: 'interviewSummary',
        recruitingOfferPending: 'offerApproval',
        recruitingOnboardDraft: 'onboardDraft',
        recruitingPayrollPrefill: 'payrollFile',
        recruitingArrivalUnconfirmed: 'preboarding',
        recruitingPreboardingTemplate: 'preboarding',
        recruitingPreboardingExtracted: 'preboarding',
        recruitingNewHireIssue: 'newHireIssue',
        recruitingCheckInFaceToFace: 'newHireIssue',
        recruitingStaleApplications: 'candidateStale',
        recruitingDigest: 'recruitingDigest',
        // V4-12: performance to-dos (never a rating in the title or body).
        performanceGoalSetting: 'performanceTask',
        performanceGoalDrafts: 'performanceTask',
        performanceGoalsSubmitted: 'performanceApproval',
        performanceSelfReview: 'performanceTask',
        performancePeerReview: 'performanceTask',
        performancePeersNominated: 'performanceApproval',
        performanceDraftsReady: 'performanceTask',
        performanceReviewHints: 'performanceTask',
        performanceDeadline: 'performanceTask',
        performanceUrge: 'performanceTask',
        performanceCalibrationStarted: 'performanceCalibration',
        performanceCalibrationPack: 'performanceCalibration',
        performanceAppealSubmitted: 'performanceAppeal',
        performanceLowResult: 'performanceFollowUp',
        // V4-13: talent review, succession, practicals, evaluations, knowledge drafts, translations.
        talentReviewPotential: 'talentReviewTask',
        talentReviewPreplaced: 'talentReviewTask',
        successionRecommended: 'successionAlert',
        successionRisk: 'successionAlert',
        practicalWitness: 'practicalWitness',
        trainingEvaluationL1: 'trainingEvaluation',
        trainingEvaluationL3: 'trainingEvaluation',
        trainingEvaluationDue: 'trainingEvaluation',
        trainingEffectReport: 'trainingReport',
        knowledgeFaqDrafted: 'knowledgeDraft',
        translationDrafted: 'translationReview',
      };
      // The HR assistant's own work: shown in the workbench as coming from it.
      const fromHrAssistant =
        message.startsWith('hrImportCheck') ||
        message === 'hrProbationPrep' ||
        message === 'hrRenewalPrep' ||
        message === 'hrAttachmentExtracted' ||
        message === 'hrSyncExplained' ||
        message === 'hrChangeChecklist' ||
        message === 'hrChangeChecklistOverdue' ||
        message === 'hrCompliance' ||
        message === 'replacementSuggested' ||
        message === 'replacementNone' ||
        message.startsWith('attendanceMissing') ||
        message === 'attendanceOvertimeNear' ||
        message === 'attendanceMonthCheck' ||
        message.startsWith('attendanceInquiry') ||
        // V2-06: 算薪异常检查 and 业务邮件分拣.
        message.startsWith('payrollAnomalies') ||
        (message.startsWith('mail') &&
          message !== 'mailResumeReceived' &&
          message !== 'mailCandidateReplied' &&
          message !== 'mailAuditRequest' &&
          message !== 'mailAuditDraftReady');
      const aiEmployeeOf: Record<string, string> = {
        automationGapReport: 'knowledgeAssistant',
        documentConflictFound: 'knowledgeAssistant',
        // V3-08
        automationPositionDrafted: 'frameworkAdvisor',
        // V3-09
        learningPlanDrafted: 'learningCoach',
        // V2-07
        recruitingWorkforceGap: 'hrAssistant',
        recruitingPostingDrafted: 'recruitingAssistant',
        recruitingPoolSuggested: 'recruitingAssistant',
        recruitingInterviewQuestions: 'recruitingAssistant',
        recruitingInterviewSummary: 'recruitingAssistant',
        mailResumeReceived: 'recruitingAssistant',
        mailCandidateReplied: 'recruitingAssistant',
        mailAuditRequest: 'certificationSteward',
        mailAuditDraftReady: 'certificationSteward',
        recruitingDigest: 'recruitingAssistant',
        recruitingNewHireIssue: 'hrAssistant',
        recruitingPreboardingExtracted: 'hrAssistant',
        recruitingArrivalUnconfirmed: 'hrAssistant',
        // V3-11
        competencySuggestionDrafted: 'talentAnalyst',
        trainingRecommendationPending: 'talentAnalyst',
        trainingRecommendationNeedsContent: 'learningCoach',
        signalRuleDrafted: 'talentAnalyst',
        talentMonthlyReport: 'talentAnalyst',
        talentMonthlyReportCompany: 'talentAnalyst',
        revisionReady: 'contentWriter',
        questionQualityFound: 'contentWriter',
        // V4-12
        performanceGoalDrafts: 'performanceAssistant',
        performanceDraftsReady: 'performanceAssistant',
        performanceReviewHints: 'performanceAssistant',
        performanceCalibrationPack: 'performanceAssistant',
        performanceLowResult: 'learningCoach',
        // V4-13
        talentReviewPreplaced: 'talentAnalyst',
        successionRecommended: 'talentAnalyst',
        successionRisk: 'talentAnalyst',
        trainingEffectReport: 'talentAnalyst',
        knowledgeFaqDrafted: 'knowledgeAssistant',
        translationDrafted: 'contentWriter',
      };
      // V2-05: a leave or attendance request moving on (next level, decided) closes
      // the to-dos its earlier levels left on the workbench.
      const request = /^(leave|adjustment)(?:Decided)?:([^:]+)/u.exec(key);
      if (
        request &&
        [
          'leavePending',
          'leaveApproved',
          'leaveRejected',
          'adjustmentPending',
          'shiftSwapConsent',
          'adjustmentApproved',
          'adjustmentRejected',
        ].includes(message)
      ) {
        const stamp = new Date();
        await container
          .resolve(databaseManagerToken)
          .query()
          .updateTable('workItems')
          .set({ status: 'done', doneAt: stamp, updatedAt: stamp })
          .where('type', '=', 'attendanceApproval')
          .where('status', '=', 'open')
          .where('refId', 'like', `${request[1]}:${request[2]}:%`)
          .where('refId', '!=', key)
          .execute()
          .catch(() => undefined);
      }
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
                // An AI employee's material goes to this recipient only, like the inbox message carrying it:
                // the card shows its first lines and expands to the full text (工作台 · AI 员工备好的材料).
                ...(fromHrAssistant
                  ? workItemText(t(`notifications.${message}.body`, values))
                  : { summary: t(`notifications.${message}.body`, values) }),
                link: path,
                sourceKind: approvalId
                  ? 'approval'
                  : fromHrAssistant || aiEmployeeOf[message]
                    ? 'ai'
                    : 'rule',
                aiEmployee: fromHrAssistant
                  ? 'hrAssistant'
                  : (aiEmployeeOf[message] ?? null),
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
      // V1-04 通知推送 (im-cards/push.ts): the same notification also reaches each recipient's bound
      // Feishu unless they turned it off; a pending approval ('actionPending') goes there as an 审批卡片.
      // The push writes pushedAt / pushError on the to-do above and never affects the inbox.
      try {
        const approvalRef =
          message === 'actionPending' ? path?.split('/').at(-1) : undefined;
        await container.resolve(imChannelToken).push.push({
          key,
          message,
          userIds: recipients,
          title: t(`notifications.${message}.title`, values),
          // V2-07: recruiting notices reach the office suite as a title and a NocoHR link only (no candidate data).
          summary:
            fromHrAssistant ||
            message.startsWith('recruiting') ||
            // V4-12: performance notices reach the office suite as a to-do title and a link only.
            message.startsWith('performance') ||
            // V4-13: talent review and succession notices too (sensitive data).
            message.startsWith('talentReview') ||
            message.startsWith('succession')
              ? null
              : t(`notifications.${message}.body`, values),
          path,
          workItem:
            taskType && path
              ? approvalRef
                ? {
                    type: `approval:${key.split(':').at(-1)}`,
                    refType: 'personnelAction',
                    refId: approvalRef,
                  }
                : { type: taskType, refType: taskType, refId: key }
              : null,
        });
      } catch (error) {
        container
          .resolve(loggingToken)
          .getLogger('hr')
          .warn({ error, key }, 'HR office-suite push failed');
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
        knowledgeScope: (employee) =>
          container.resolve(aiEntryServiceToken).scopeFor(employee),
        reviewConfig: async () =>
          (await container.resolve(personnelSettingsToken).read('knowledge'))
            .value,
        drive: () => container.resolve(driveManagerToken),
        departmentTitle: async (id) => {
          const department = await organization.getDepartment(id);
          return department ? organization.titleText(department.title) : id;
        },
        basePath: () => this.app.publicBasePath,
        onDocumentParsed:
          () =>
          (documentId, { autoDraftCourse, newVersion }) => {
            // V1-04: every new document or version that becomes ready is checked for conflicts once.
            this.inBackground('knowledgeAssistant.conflictCheck', () =>
              container
                .resolve(automationTasksToken)
                .onDocumentReadyForConflicts(documentId),
            );
            if (autoDraftCourse)
              this.inBackground('contentWriter.draftCourseFromDocument', () =>
                container
                  .resolve(automationTasksToken)
                  .onDocumentReady(documentId),
              );
            // V3-11 升版修订: a new version, once per version (the automation dedupes on the document).
            if (newVersion)
              this.inBackground('contentWriter.versionRevision', () =>
                container
                  .resolve(profileServicesToken)
                  .analyst.onVersionReady(documentId),
              );
            // V3-11 end
          },
      });
    });
    container.singleton(learningServiceToken, () =>
      createLearningService({
        platform: container.resolve(platformToken),
        knowledge: container.resolve(knowledgeServiceToken),
        onCourseCompleted: () => this.courseCompletedHandler,
        onCoursePublished: () => (courseId) => {
          this.inBackground('contentWriter.fillCourseQuestions', () =>
            container.resolve(automationTasksToken).onCoursePublished(courseId),
          );
          // V3-11: a published change brief is assigned to the affected people.
          this.inBackground('revision.briefPublished', () =>
            container.resolve(revisionServiceToken).onBriefPublished(courseId),
          );
          // V3-11 end
        },
        basePath: () => this.app.publicBasePath,
        // V3-09: due-soon days and the default watch share are the administrator's 学习规则.
        rules: () => container.resolve(learningSettingsToken).read(),
      }),
    );
  }

  // V3-08 能力体系: gaps, development targets, assessment to-dos and import, job descriptions.
  private registerCompetency(): void {
    const container = this.app.container;
    container.singleton(competencyServiceToken, () => {
      const i18n = container.resolve(i18nToken);
      return createCompetencyService({
        platform: container.resolve(platformToken),
        drive: () => container.resolve(driveManagerToken),
        translate: async (key, params) => {
          const locale = i18n.getDefaultLocale();
          await i18n.ensureLocaleLoaded(locale);
          return i18n.getFixedT('hr', locale)(key, params);
        },
        createAssessment: (ctx, employeeId, input) =>
          container
            .resolve(talentServiceToken)
            .createAssessment(ctx, employeeId, input),
        background: (label, run) => this.inBackground(label, run),
      });
    });
  }
  // V3-08 end

  /** Checks certification requirements when a course completes. */
  private courseCompletedHandler?: (
    employeeId: string,
    courseId: string,
  ) => Promise<void>;

  private feishuState?: { api: FeishuApi; config: FeishuConfig } | null;

  /**
   * The configured Feishu self-built app (FEISHU_APP_ID / FEISHU_APP_SECRET),
   * shared by the directory sync, the bot transport and the long connection.
   * Never under Vitest: a developer's `.env.local` credentials must not make a
   * test read or message the real tenant.
   */
  private feishuApp(): { api: FeishuApi; config: FeishuConfig } | undefined {
    if (this.feishuState === undefined) {
      const raw = this.app.config.get<Partial<FeishuConfig>>('feishu') ?? {};
      const config: FeishuConfig = {
        appId: raw.appId ?? '',
        appSecret: raw.appSecret ?? '',
        encryptKey: raw.encryptKey ?? '',
        verificationToken: raw.verificationToken ?? '',
        baseUrl: raw.baseUrl || 'https://open.feishu.cn',
        longConnection: raw.longConnection !== false,
        linkOrigin: raw.linkOrigin ?? '',
      };
      this.feishuState =
        config.appId && config.appSecret && !process.env.VITEST
          ? {
              config,
              api: createFeishuApi({
                appId: config.appId,
                appSecret: config.appSecret,
                baseUrl: config.baseUrl,
              }),
            }
          : null;
    }
    return this.feishuState ?? undefined;
  }

  /** An app path as a link: absolute when an origin is known. */
  private feishuLink(path: string): string {
    const configured =
      this.feishuApp()?.config.linkOrigin ||
      this.app.config.get<{ publicOrigin?: string }>('app')?.publicOrigin ||
      '';
    const port = this.app.config.get<{ port?: number }>('server')?.port;
    const origin =
      configured ||
      (process.env.NODE_ENV !== 'production' && this.feishuApp() && port
        ? `http://localhost:${port}`
        : '');
    return `${origin.replace(/\/$/u, '')}${this.app.publicBasePath.replace(/\/$/u, '')}${path}`;
  }

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
  /**
   * 请假生效 with a published-schedule conflict: the scheduler (the
   * department's head) is told at once and the HR assistant suggests cover for
   * each cell, without waiting for the 09:00 check.
   */
  private onLeaveConflict(input: {
    requestId: string;
    scheduleIds: string[];
  }): void {
    this.inBackground('hrAssistant.replacementSuggest', async () => {
      const container = this.app.container;
      const database = container.resolve(databaseManagerToken);
      const organization = container.resolve(organizationServiceToken);
      for (const scheduleId of input.scheduleIds) {
        const cell = await database
          .query()
          .selectFrom('shiftSchedules')
          .innerJoin('employees', 'employees.id', 'shiftSchedules.employeeId')
          .select([
            'shiftSchedules.date as date',
            'employees.name as name',
            'employees.departmentId as departmentId',
          ])
          .where('shiftSchedules.id', '=', scheduleId)
          .executeTakeFirst();
        if (!cell) continue;
        const date = str(cell.date).slice(0, 10);
        const head = await organization.resolveHead(str(cell.departmentId));
        if (head)
          await this.notifier()({
            key: `leaveConflict:${scheduleId}:${input.requestId}`,
            userIds: [head.userId],
            message: 'scheduleLeaveConflict',
            params: { name: str(cell.name), date },
            path: `/talent/schedules?department=${str(cell.departmentId)}&from=${date}`,
          });
        await container
          .resolve(automationTasksToken)
          .onLeaveConflict(scheduleId);
      }
    });
  }

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

  // V3-11 画像、联动与内容维护: business data, suggestions, profiles, audit exports and revisions.
  private registerProfile(): void {
    const container = this.app.container;
    container.singleton(revisionServiceToken, () =>
      createRevisionService({ platform: container.resolve(platformToken) }),
    );
    container.singleton(profileServicesToken, () => {
      const organization = container.resolve(organizationServiceToken);
      return createProfileServices({
        container,
        platform: container.resolve(platformToken),
        ai: createAIRunner(container),
        drive: () => container.resolve(driveManagerToken),
        users: () => container.resolve(userAdministrationServiceToken),
        customFields: () => container.resolve(customFieldServiceToken),
        competency: () => container.resolve(competencyServiceToken),
        automation: () => container.resolve(automationServiceToken),
        revisions: () => container.resolve(revisionServiceToken),
        insights: () => container.resolve(insightServiceToken),
        departmentTitle: async (id) => {
          const department = await organization.getDepartment(id);
          return department ? organization.titleText(department.title) : id;
        },
        config: () => {
          const profile =
            this.app.config.get<Partial<TalentProfileConfig>>(
              'talentProfile',
            ) ?? {};
          const app =
            this.app.config.get<{ publicOrigin?: string }>('app') ?? {};
          return {
            writebackUrl: profile.writebackUrl ?? '',
            writebackSecret: profile.writebackSecret ?? '',
            publicOrigin: (app.publicOrigin ?? '').replace(/\/$/u, ''),
            basePath: this.app.publicBasePath,
          };
        },
        background: (label, run) => this.inBackground(label, run),
        warn: (detail, message) =>
          container.resolve(loggingToken).getLogger('hr').info(detail, message),
      });
    });
  }
  // V3-11 end

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
        // V3-09: the check-in window is the administrator's 学习规则.
        checkInOpensMinutes: async () =>
          (await container.resolve(learningSettingsToken).read())
            .checkInOpensMinutes,
      });
    });
    container.singleton(practiceServiceToken, () =>
      createPracticeService({
        platform: container.resolve(platformToken),
        ai: createAIRunner(container),
        onPracticePassed: () => async (employeeId) => {
          await container.resolve(pathServiceToken).syncEmployee(employeeId);
          // V3-11: the practice may finish a training recommendation.
          await container
            .resolve(profileServicesToken)
            .onTaskCompleted(employeeId);
        },
      }),
    );
    container.singleton(planServiceToken, () =>
      createPlanService({
        platform: container.resolve(platformToken),
        paths: container.resolve(pathServiceToken),
        // V3-09: the plan expiry is the administrator's 学习规则.
        expiryDays: async () =>
          (await container.resolve(learningSettingsToken).read())
            .planExpiryDays,
      }),
    );
    // V3-09: 学习规则 and the job-event learning rules.
    container.singleton(learningSettingsToken, () =>
      createLearningSettings(container.resolve(databaseManagerToken)),
    );
    container.singleton(learningJobEventsToken, () =>
      createLearningJobEvents({
        platform: container.resolve(platformToken),
        paths: () => container.resolve(pathServiceToken),
        owner: async () => {
          const row = await container
            .resolve(databaseManagerToken)
            .query()
            .selectFrom('aiAutomationSettings')
            .select(['ownerUserId'])
            .where('id', '=', 'learningCoach.jobEventPlans')
            .executeTakeFirst();
          return row?.ownerUserId ? str(row.ownerUserId) : null;
        },
        backfillDays: async () =>
          (await container.resolve(learningSettingsToken).read())
            .onboardingBackfillDays,
      }),
    );
    // V3-09 end
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
          // V3-11: the exam may finish a training recommendation.
          await container
            .resolve(profileServicesToken)
            .onTaskCompleted(employeeId);
        },
        onRecertificationExhausted: () => (attemptId) =>
          this.inBackground('certificationSteward.remedialLearning', () =>
            container
              .resolve(automationTasksToken)
              .onRecertificationExhausted(attemptId),
          ),
        // V3-10: the administrator's exam → competency rule; the examiner and the learning coach after a submission.
        examRules: () => container.resolve(examSettingsToken).rules(),
        onGradingRequested: () => (attemptId) => {
          this.inBackground('examiner.gradingSuggestion', () =>
            container
              .resolve(automationTasksToken)
              .onAttemptAwaitingGrading(attemptId),
          );
          return true;
        },
        onExamFailed: () => (attemptId) =>
          this.inBackground('learningCoach.examFailedPlan', () =>
            container.resolve(automationTasksToken).onExamFailed(attemptId),
          ),
        // V3-10 end
        // V4-13: an English candidate's paper shows the confirmed translations.
        translatedQuestions: (ids, locale) =>
          container
            .resolve(talentReviewServicesToken)
            .translations.questionTexts(ids, locale),
      }),
    );
    // V3-10: the exam → competency rule and the V4-14 industry pack switch.
    container.singleton(examSettingsToken, () =>
      createExamSettingsService({
        database: container.resolve(databaseManagerToken),
        defaultRules: () => this.talentConfig().examCompetency,
        onLicensedOperationChanged: async () => {
          // V4-14: a switch change through this V3-10 endpoint reaches the audit log too (设置 / 持证上岗 keeps its own list).
          container.resolve(loggingToken).getLogger('hr-audit').info(
            {
              event: 'licensedOperation.settingsChanged',
              via: 'exam-settings',
            },
            'HR audit',
          );
          const authz = container.resolve(authorizationToken);
          const holders = await container
            .resolve(databaseManagerToken)
            .query()
            .selectFrom('employeeCertificates')
            .innerJoin(
              'employees',
              'employees.id',
              'employeeCertificates.employeeId',
            )
            .select(['employees.userId as userId'])
            .where('employeeCertificates.status', 'in', ['valid', 'expiring'])
            .execute();
          for (const userId of new Set(holders.map((h) => h.userId)))
            if (userId)
              await authz.permissionSets.notifyAssignmentsChanged({
                type: 'user',
                id: str(userId),
              });
        },
      }),
    );
    // V3-10 end
    container.singleton(certificationServiceToken, () => {
      const i18n = container.resolve(i18nToken);
      return createCertificationService({
        platform: container.resolve(platformToken),
        learning: container.resolve(learningServiceToken),
        companyName: () => this.talentConfig().companyName,
        // V3-10: permissions follow certificates only with the industry pack on; qualification material.
        licensed: async () =>
          (await container.resolve(examSettingsToken).licensedOperation())
            .enabled,
        onQualified: () => (certificateId) =>
          this.inBackground('certificationSteward.qualificationPrep', () =>
            container
              .resolve(automationTasksToken)
              .onCertificateQualified(certificateId),
          ),
        // V3-10 end
        // V4-13: 实操考核 required by the certification (发证与复审续发).
        practicalGate: () => (employeeId, certificationId, mode) =>
          container
            .resolve(talentReviewServicesToken)
            .practicals.practicalGate(employeeId, certificationId, mode),
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
    this.courseCompletedHandler = async (employeeId, courseId) => {
      // V3-11: the completed assignment keeps the course version and source; recommendations are checked.
      await container
        .resolve(profileServicesToken)
        .onCourseCompleted(employeeId, courseId);
      // V3-11 end
      await container.resolve(certificationServiceToken).evaluate(employeeId);
      await container.resolve(pathServiceToken).syncEmployee(employeeId);
      // V4-13: 课程任务完成、线下签到 → the learner's l1 questionnaire.
      await container
        .resolve(talentReviewServicesToken)
        .onCourseCompleted(employeeId, courseId);
    };
  }

  public override async boot(): Promise<void> {
    const container = this.app.container;
    const authz: AppAuthorization = container.resolve(authorizationToken);
    // V2-06 邮件往来: each purpose's handler (later steps add theirs here).
    container
      .resolve(mailServiceToken)
      .registerHandler('billing', container.resolve(billingMailToken).handler);
    container
      .resolve(mailServiceToken)
      .registerHandler(
        'recruiting',
        container.resolve(recruitingMailToken).handler,
      );
    container
      .resolve(mailServiceToken)
      .registerHandler('audit', container.resolve(auditMailToken).handler);
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
      {
        name: 'attendanceAdjustments',
        title: 'attendance.adjustmentActions.title',
      },
      {
        name: 'attendanceMonthlySummaries',
        title: 'attendance.recordActions.summaries',
      },
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
      // V3-08
      'talent.developmentTarget': 'talent.people',
      'talent.hrAssistant': 'talent.people',
    };
    // V1-04: document conflicts (the other content-maintenance resources belong to later steps).
    authz.database.collections.add({
      name: 'documentConflicts',
      title: label('collections.documentConflicts'),
    });
    for (const resource of [
      ...HR_COMPOSITES,
      documentConflictResource,
      workbenchResource,
      attendanceSettingsResource,
      leaveResource,
      scheduleResource,
      attendanceRecordResource,
      adjustmentResource,
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
    // V4-14 行业方案 · 持证上岗: settings, 班次要求的认证, 叉车出库登记 (licensed/resources.ts).
    for (const resource of LICENSED_COMPOSITES) {
      const reference = authz.compositeResources.define(resource.build());
      authz.ui.place(reference, {
        section: 'talent',
        group:
          reference.name === 'demo.forklift' ? 'talent.demo' : 'talent.exams',
      });
    }
    // V4-14 end
    for (const resource of TRAINING_COMPOSITES) {
      const reference = authz.compositeResources.define(resource.build());
      authz.ui.place(reference, {
        section: 'talent',
        group: 'talent.training',
      });
    }
    // V2-06 薪酬与社保: the payroll tables and business operations (see payroll/resources.ts).
    for (const collection of PAYROLL_COLLECTIONS)
      authz.database.collections.add({
        name: collection.name,
        title: label(collection.title),
      });
    authz.ui.groups.add({
      name: 'talent.payroll',
      title: label('payroll.authz.group'),
    });
    for (const resource of PAYROLL_COMPOSITES) {
      const reference = authz.compositeResources.define(resource.build());
      authz.ui.place(reference, { section: 'talent', group: 'talent.payroll' });
    }
    // V2-06 end
    // V2-07 用工计划与招聘入职: the recruiting tables and business operations (see recruiting/resources.ts).
    for (const collection of RECRUITING_COLLECTIONS)
      authz.database.collections.add({
        name: collection.name,
        title: label(collection.title),
      });
    authz.ui.groups.add({
      name: 'talent.recruiting',
      title: label('recruiting.authz.group'),
    });
    for (const resource of RECRUITING_COMPOSITES) {
      const reference = authz.compositeResources.define(resource.build());
      authz.ui.place(reference, {
        section: 'talent',
        group: 'talent.recruiting',
      });
    }
    // 新员工回访: a bound employee's reply to the bot's question goes to the HR assistant (recruiting/checkins.ts).
    container
      .resolve(imChannelToken)
      .addHook(container.resolve(recruitingServicesToken).checkInHook);
    // V2-07 end
    // V3-11: business data, suggestions, recommendations, profiles, audit exports; content revisions.
    for (const collection of PROFILE_COLLECTIONS)
      authz.database.collections.add({
        name: collection.name,
        title: label(collection.title),
      });
    authz.ui.groups.add({
      name: 'talent.profileInsights',
      title: label('authz.group.profileInsights'),
    });
    for (const resource of PROFILE_COMPOSITES) {
      const reference = authz.compositeResources.define(resource.build());
      authz.ui.place(reference, {
        section: 'talent',
        group:
          reference.name === 'talent.revision'
            ? 'talent.learning'
            : 'talent.profileInsights',
      });
    }
    // V3-11 end
    // V4-12 绩效: the performance tables, business operations and record scopes (performance/resources.ts).
    for (const collection of PERFORMANCE_COLLECTIONS)
      authz.database.collections.add({
        name: collection.name,
        title: label(collection.title),
      });
    authz.ui.groups.add({
      name: 'talent.performance',
      title: label('performance.authz.group'),
    });
    for (const resource of PERFORMANCE_COMPOSITES) {
      const reference = authz.compositeResources.define(resource.build());
      authz.ui.place(reference, {
        section: 'talent',
        group: 'talent.performance',
      });
    }
    registerPerformanceRecordAccess(authz, database, organization);
    // V4-12 end
    // V4-13 人才盘点与其他: the tables, business operations and record scopes (talent-review/resources.ts).
    for (const collection of TALENT_REVIEW_COLLECTIONS)
      authz.database.collections.add({
        name: collection.name,
        title: label(collection.title),
      });
    authz.ui.groups.add({
      name: 'talent.talentReview',
      title: label('talentReview.authz.group'),
    });
    for (const resource of TALENT_REVIEW_COMPOSITES) {
      const reference = authz.compositeResources.define(resource.build());
      authz.ui.place(reference, {
        section: 'talent',
        group: 'talent.talentReview',
      });
    }
    registerTalentReviewRecordAccess(authz, database, organization);
    // V4-13 end
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
    // V4-14: a certification subject's assignment change is recorded (权限变化记录); the certification-only
    // protection and the history baseline are applied once the database is ready.
    const licensed = container.resolve(licensedServicesToken);
    const releaseGrantListener = authz.onGrantsChanged(async (subject) => {
      await licensed.onGrantsChanged(subject).catch(() => undefined);
    });
    this.inBackground('licensed.start', () => licensed.start());
    // V4-14 end
    // Real Feishu bot: messages and card button presses over the long connection.
    const feishu = this.feishuApp();
    if (feishu?.config.longConnection) {
      const channel = container.resolve(imChannelToken);
      const logger = container.resolve(loggingToken).getLogger('hr');
      this.feishuConnection = startFeishuLongConnection({
        appId: feishu.config.appId,
        appSecret: feishu.config.appSecret,
        baseUrl: feishu.config.baseUrl,
        transport: channel.transport,
        link: (path) => this.feishuLink(path),
        handleMessage: (message) => channel.handle(message),
        handleCardAction: (callback) => channel.cards.handleCallback(callback),
        textOnly: async () => (await channel.translate())('imBot.textOnly'),
        log: {
          info: (detail, message) => logger.info(detail, message),
          warn: (detail, message) => logger.warn(detail, message),
        },
      });
    }
    this.releaseSubjects = () => {
      releaseOrganization();
      releaseCertification();
      // V4-14
      releaseGrantListener();
      licensed.settings.release();
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

    this.registerJobEventHandlers();
    // V2-05 (realigned): 考勤与假期的飞书卡片、推送路由与追问回复 (attendance-cards.ts).
    registerAttendanceCards(container);

    if (container.has(schedulerServiceToken)) {
      const scheduler = container.resolve(schedulerServiceToken);
      const logger = container.resolve(loggingToken).getLogger('hr');
      // V2-06 邮件往来: every minute, the mailboxes are read once 设置 / 邮件's interval has passed.
      let lastMailPoll = 0;
      scheduler.registerTarget({
        type: 'app.hr-mail-poll',
        title: 'Business mail: read the mailboxes',
        validate: (config) =>
          config !== null &&
          typeof config === 'object' &&
          !Array.isArray(config)
            ? { valid: true }
            : { valid: false, reason: 'config-must-be-an-object' },
        start: async () => {
          const settings = (await container.resolve(mailSettingsToken).read())
            .value;
          if (Date.now() - lastMailPoll < settings.pollMinutes * 60_000 - 5_000)
            return { state: 'completed', outcome: 'succeeded', result: {} };
          lastMailPoll = Date.now();
          const counts = await container.resolve(mailServiceToken).poll();
          return { state: 'completed', outcome: 'succeeded', result: counts };
        },
      });
      scheduler.defineSchedule({
        key: 'hr.mail-poll',
        title: 'Business mail: read the mailboxes',
        schedule: { cron: '* * * * *', timezone: this.talentConfig().timeZone },
        target: { type: 'app.hr-mail-poll', config: {} },
      });
      scheduler.registerTarget({
        type: 'app.hr-mail-retention',
        title: 'Business mail: clear bodies past retention',
        validate: (config) =>
          config !== null &&
          typeof config === 'object' &&
          !Array.isArray(config)
            ? { valid: true }
            : { valid: false, reason: 'config-must-be-an-object' },
        start: async () => {
          const result = await container
            .resolve(mailServiceToken)
            .sweepRetention(container.resolve(platformToken).currentDate());
          return { state: 'completed', outcome: 'succeeded', result };
        },
      });
      scheduler.defineSchedule({
        key: 'hr.mail-retention',
        title: 'Business mail: clear bodies past retention',
        schedule: { cron: '0 3 * * *', timezone: this.talentConfig().timeZone },
        target: { type: 'app.hr-mail-retention', config: {} },
      });
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
          // V1-03: the daily full sync at 组织同步's fullSyncTime, on the same 15-minute check.
          await runScheduledOrgSync(
            container,
            this.talentConfig().timeZone,
          ).catch((error: unknown) =>
            logger.warn({ error }, 'Scheduled organisation sync failed'),
          );
          // Runs every 15 minutes; does the day's work once, at the time set in 人事设置 · 提醒.
          const due = await dailyRunDue(
            container,
            this.talentConfig().timeZone,
          );
          if (!due)
            return {
              state: 'completed',
              outcome: 'succeeded',
              result: { skipped: 1 },
            };
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
        type: 'app.hr-attendance',
        title:
          'Attendance: punches, daily records, monthly summaries, yearly balances',
        validate: (config) =>
          config !== null &&
          typeof config === 'object' &&
          !Array.isArray(config) &&
          ['pull', 'compute', 'monthly', 'yearly'].includes(
            String((config as { task?: unknown }).task),
          )
            ? { valid: true }
            : { valid: false, reason: 'config-task-required' },
        start: async (config) => {
          const task = String((config as { task: string }).task) as
            'pull' | 'compute' | 'monthly' | 'yearly';
          const result = await runAttendanceTask(container, task);
          logger.info({ task, ...result }, 'HR attendance task');
          return {
            state: 'completed',
            outcome: 'succeeded',
            result: JSON.parse(JSON.stringify(result)) as Record<string, never>,
          };
        },
      });
      for (const [key, cron, task, title] of [
        [
          'hr.attendance-pull',
          '*/30 * * * *',
          'pull',
          'Attendance: pull office-suite punches',
        ],
        [
          'hr.attendance-compute',
          '0 4 * * *',
          'compute',
          "Attendance: compute the previous day's records",
        ],
        [
          'hr.attendance-monthly',
          '0 4 1 * *',
          'monthly',
          "Attendance: last month's summaries and the month-end check",
        ],
        [
          'hr.attendance-yearly',
          '0 0 1 1 *',
          'yearly',
          "Attendance: the year's leave balances and carryover expiry",
        ],
      ] as const)
        scheduler.defineSchedule({
          key,
          title,
          schedule: { cron, timezone: this.talentConfig().timeZone },
          target: { type: 'app.hr-attendance', config: { task } },
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
      // V3-11: 09:00 — undecided level suggestions (30 days) and training recommendations (14 days) expire.
      scheduler.registerTarget({
        type: 'app.hr-profile-daily',
        title: 'Talent profile: expire undecided suggestions',
        validate: (config) =>
          config !== null &&
          typeof config === 'object' &&
          !Array.isArray(config)
            ? { valid: true }
            : { valid: false, reason: 'config-must-be-an-object' },
        start: async () => {
          const result = await container
            .resolve(profileServicesToken)
            .runDaily();
          return {
            state: 'completed',
            outcome: 'succeeded',
            result: { ...result },
          };
        },
      });
      scheduler.defineSchedule({
        key: 'hr.profile-daily',
        title:
          'Talent profile: expire undecided suggestions and recommendations',
        schedule: { cron: '0 9 * * *', timezone: this.talentConfig().timeZone },
        target: { type: 'app.hr-profile-daily', config: {} },
      });
      // V3-11 end
      // V4-12: 09:00 — deadline reminders (3 and 1 days before), auto-advance, 7-day acknowledgement.
      scheduler.registerTarget({
        type: 'app.hr-performance-daily',
        title: 'Performance: reminders, auto-advance and acknowledgement',
        validate: (config) =>
          config !== null &&
          typeof config === 'object' &&
          !Array.isArray(config)
            ? { valid: true }
            : { valid: false, reason: 'config-must-be-an-object' },
        start: async () => {
          const result = await container
            .resolve(performanceServicesToken)
            .tasks.runDaily();
          return {
            state: 'completed',
            outcome: 'succeeded',
            result: { ...result },
          };
        },
      });
      scheduler.defineSchedule({
        key: 'hr.performance-daily',
        title:
          'Performance: stage deadline reminders, auto-advance and acknowledgement',
        schedule: { cron: '0 9 * * *', timezone: this.talentConfig().timeZone },
        target: { type: 'app.hr-performance-daily', config: {} },
      });
      // V4-12 end
      // V4-13: hourly — outdated translations are redrafted; 09:00 — evaluation tasks, reminders, expiry, versions.
      scheduler.registerTarget({
        type: 'app.hr-talent-review',
        title:
          'Talent review: evaluation tasks, translations and model versions',
        validate: (config) =>
          config !== null &&
          typeof config === 'object' &&
          !Array.isArray(config)
            ? { valid: true }
            : { valid: false, reason: 'config-must-be-an-object' },
        start: async () => {
          const services = container.resolve(talentReviewServicesToken);
          const hour = Number(
            new Intl.DateTimeFormat('en-GB', {
              timeZone: this.talentConfig().timeZone,
              hour: 'numeric',
              hourCycle: 'h23',
            }).format(new Date()),
          );
          const result: Record<string, unknown> = {
            hourly: await services.runHourly(),
          };
          if (hour === 9) result.daily = await services.runDaily();
          return {
            state: 'completed',
            outcome: 'succeeded',
            result: JSON.parse(JSON.stringify(result)) as Record<string, never>,
          };
        },
      });
      scheduler.defineSchedule({
        key: 'hr.talent-review-hourly',
        title:
          'Talent review: hourly scan (09:00 evaluation tasks and version reconciliation)',
        schedule: {
          cron: '10 * * * *',
          timezone: this.talentConfig().timeZone,
        },
        target: { type: 'app.hr-talent-review', config: {} },
      });
      // V4-13 end
      // V2-06: 每月 5 日增减员提醒; 年度社保基数调整 (checked on the 1st of each month, acts in the configured month).
      scheduler.registerTarget({
        type: 'app.hr-payroll',
        title:
          'Payroll: monthly insurance changes and the yearly base adjustment',
        validate: (config) =>
          config !== null &&
          typeof config === 'object' &&
          ['monthly', 'yearly'].includes(
            String((config as { task?: unknown }).task),
          )
            ? { valid: true }
            : { valid: false, reason: 'config-task-required' },
        start: async (config) => {
          const task = String((config as { task: string }).task) as
            'monthly' | 'yearly';
          const result = await container
            .resolve(payrollServicesToken)
            .runTask(task, { trigger: 'schedule' });
          return {
            state: 'completed',
            outcome: 'succeeded',
            result: JSON.parse(JSON.stringify(result)) as Record<string, never>,
          };
        },
      });
      for (const [key, cron, task, title] of [
        [
          'hr.payroll-monthly',
          '0 9 5 * *',
          'monthly',
          "Payroll: last month's insurance changes",
        ],
        [
          'hr.payroll-yearly',
          '0 9 1 * *',
          'yearly',
          'Payroll: yearly social insurance base adjustment',
        ],
      ] as const)
        scheduler.defineSchedule({
          key,
          title,
          schedule: { cron, timezone: this.talentConfig().timeZone },
          target: { type: 'app.hr-payroll', config: { task } },
        });
      // V2-06 end
      // V2-07: hourly — interview questions within 24 h; 09:00 stage reminders, expired offers, anonymization;
      // 18:00 self-booking reminders. The AI employees' daily work runs through hr.ai-automations.
      scheduler.registerTarget({
        type: 'app.hr-recruiting',
        title:
          'Recruiting: interview questions, reminders, offer expiry, anonymization',
        validate: (config) =>
          config !== null &&
          typeof config === 'object' &&
          !Array.isArray(config)
            ? { valid: true }
            : { valid: false, reason: 'config-must-be-an-object' },
        start: async () => {
          const recruiting = container.resolve(recruitingServicesToken);
          const hour = Number(
            new Intl.DateTimeFormat('en-GB', {
              timeZone: this.talentConfig().timeZone,
              hour: 'numeric',
              hourCycle: 'h23',
            }).format(new Date()),
          );
          const result: Record<string, unknown> = {
            hourly: await recruiting.tasks.run('hourly'),
          };
          if (hour === 9) result.daily = await recruiting.tasks.run('daily');
          if (hour === 18)
            result.evening = await recruiting.tasks.run('evening');
          return {
            state: 'completed',
            outcome: 'succeeded',
            result: JSON.parse(JSON.stringify(result)) as Record<string, never>,
          };
        },
      });
      scheduler.defineSchedule({
        key: 'hr.recruiting-hourly',
        title: 'Recruiting: hourly scan (09:00 daily rules, 18:00 reminders)',
        schedule: { cron: '5 * * * *', timezone: this.talentConfig().timeZone },
        target: { type: 'app.hr-recruiting', config: {} },
      });
      // V2-07 end
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
        // The time of day is the administrator's setting; config.talent.dailyCron now only sets how often it is checked.
        schedule: {
          cron:
            this.talentConfig().dailyCron === '0 9 * * *'
              ? '*/15 * * * *'
              : this.talentConfig().dailyCron,
          timezone: this.talentConfig().timeZone,
        },
        target: { type: 'app.hr-daily', config: {} },
      });
    }
  }

  /**
   * The job-event handler's rules (V1-02 岗位变动事件处理器). Later steps
   * register their own here: sync events (step 3), learning (step 9),
   * qualification checks (step 14). Each rule is idempotent.
   */
  private registerJobEventHandlers(): void {
    const container = this.app.container;
    const processor = container.resolve(jobEventProcessorToken);
    const database = container.resolve(databaseManagerToken);
    const authz = container.resolve(authorizationToken);
    const releases = [
      // V1-02 变动影响清单: an action's checklist follows its event; a sync-produced change opens its own.
      processor.register({
        key: 'changeChecklists.sync',
        handle: async (event) => {
          const settings = (
            await container.resolve(personnelSettingsToken).read('checklists')
          ).value;
          await container
            .resolve(checklistServiceToken)
            .onJobEvent(event, settings);
          // A new employee is checked for a written contract from day one.
          if (event.eventType === 'onboard')
            this.inBackground('hrAssistant.compliance', () =>
              container
                .resolve(automationTasksToken)
                .onComplianceTrigger(event.employeeId),
            );
        },
      }),
      // Department and position subjects take effect on the employee's next request.
      processor.register({
        key: 'session.refresh',
        handle: async (event) => {
          const row = await database
            .query()
            .selectFrom('employees')
            .select(['userId'])
            .where('id', '=', event.employeeId)
            .executeTakeFirst();
          if (row?.userId)
            await authz.permissionSets.notifyAssignmentsChanged({
              type: 'user',
              id: str(row.userId),
            });
        },
      }),
    ];
    releases.push(...this.registerAttendanceEventHandlers());
    // V2-06: onboard / offboard / transfer reach payroll; the checklist's `salary` items.
    releases.push(
      processor.register({
        key: 'payroll.jobEvents',
        handle: (event) =>
          container.resolve(payrollServicesToken).onJobEvent(event),
      }),
      container
        .resolve(checklistServiceToken)
        .register(salaryChecklistProvider()),
      // V2-05: the change checklist's 排班 item (scope before, revalidation result after).
      container
        .resolve(checklistServiceToken)
        .register(scheduleChecklistProvider()),
    );
    // V2-06 end
    // V3-08: targets achieved on a position change; the change checklist's 能力差距 items; to-dos on first confirmation.
    {
      const competency = container.resolve(competencyServiceToken);
      releases.push(
        processor.register({
          key: 'competency.targets',
          handle: (event) => competency.onJobEvent(event),
        }),
        container
          .resolve(checklistServiceToken)
          .register(competency.checklistProvider()),
        onRequirementsFirstConfirmed(async (positionIds) => {
          await competency.onRequirementsFirstConfirmed(positionIds);
        }),
      );
    }
    // V3-08 end
    // V3-09 岗位变动触发学习: onboard / transfer / promote assign the new position's onboarding path, a transfer or
    // promotion cancels the old one's, offboard cancels unfinished learning (replaces the V2 offboard-only handler).
    // Idempotent per event through assignments.jobEventId. The learning coach's plan for what the path leaves
    // uncovered starts once the event is stamped processed, outside the handler, and at most once per event.
    {
      const learning = container.resolve(learningJobEventsToken);
      releases.push(
        processor.register({
          key: 'learning.jobEvent',
          handle: async (event) => {
            const result = await learning.handle(event);
            if (event.eventType === 'regularize') return;
            // The checklist was refreshed before this handler ran; refresh it with what learning did.
            if (result.assigned || result.cancelled) {
              const settings = (
                await container
                  .resolve(personnelSettingsToken)
                  .read('checklists')
              ).value;
              await container
                .resolve(checklistServiceToken)
                .onJobEvent(event, settings);
            }
            if (
              event.eventType === 'onboard' ||
              event.eventType === 'transfer' ||
              event.eventType === 'promote'
            )
              this.inBackground('learningCoach.jobEventPlans', async () => {
                // After processedAt is written; a failed event is retried and triggers this again.
                for (let i = 0; i < 50; i += 1) {
                  const row = await database
                    .query()
                    .selectFrom('jobEvents')
                    .select(['processedAt', 'processError'])
                    .where('id', '=', event.id)
                    .executeTakeFirst();
                  if (row?.processedAt)
                    return container
                      .resolve(automationTasksToken)
                      .onJobEventProcessed(event.id);
                  if (!row) return undefined;
                  await new Promise((resolve) => setTimeout(resolve, 200));
                }
                return undefined;
              });
          },
        }),
        container
          .resolve(checklistServiceToken)
          .register(learning.checklistProvider()),
      );
    }
    // V3-09 end
    // V3-10: the change checklist's 证书 items; a promotion decided on a qualification links the achieved target.
    releases.push(
      ...registerCertificateHooks({
        database,
        processor,
        checklists: container.resolve(checklistServiceToken),
      }),
    );
    // V3-10 end
    // V2-07 入职生效: resume and consent to the record, 待建档 from the offer, hiredCount (recruiting/onboarding.ts).
    releases.push(
      processor.register({
        key: 'recruiting.onboard',
        handle: (event) =>
          container.resolve(recruitingServicesToken).onboarding.handle(event),
      }),
    );
    // V2-07 end
    // V4-12: an offboard event closes the employee's unpublished review results and cancels open tasks.
    releases.push(
      processor.register({
        key: 'performance.offboard',
        handle: (event) =>
          container.resolve(performanceServicesToken).onJobEvent(event),
      }),
    );
    // V4-12 end
    // V4-13: a leaving incumbent or successor candidate: 继任风险提醒, the candidate marked left.
    releases.push(
      processor.register({
        key: 'talentReview.succession',
        handle: (event) =>
          container.resolve(talentReviewServicesToken).onJobEvent(event),
      }),
    );
    // V4-13 end
    // V4-14 调岗资质检查: after a transfer or promotion is processed, the certification steward's notice; the change
    // checklist's 操作权限 items (provider `grants`).
    {
      const licensed = container.resolve(licensedServicesToken);
      releases.push(
        processor.register({
          key: 'licensed.transferCheck',
          handle: (event) =>
            licensed.onJobEvent(event, (label, run) =>
              this.inBackground(label, run),
            ),
        }),
        container
          .resolve(checklistServiceToken)
          .register(licensed.transfer.checklistProvider()),
      );
    }
    // V4-14 end
    const previous = this.releaseSubjects;
    this.releaseSubjects = () => {
      previous?.();
      for (const release of releases) release();
    };
  }

  /**
   * V2-05 与岗位变动事件衔接 (only from jobEvents; each rule idempotent):
   * onboard initializes the year's balances; transfer / promote re-checks the
   * cells after the effective date and tells both departments' schedulers of
   * any now blocked by department scope; offboard removes the cells after the
   * leaving date, tells the scheduler, and cancels open requests (the year's
   * balances freeze with the employee's status).
   */
  private registerAttendanceEventHandlers(): (() => void)[] {
    const container = this.app.container;
    const processor = container.resolve(jobEventProcessorToken);
    const database = container.resolve(databaseManagerToken);
    const organization = container.resolve(organizationServiceToken);
    const notify = this.notifier();
    const headOf = async (departmentId: string | null) =>
      departmentId
        ? ((await organization.resolveHead(departmentId))?.userId ?? null)
        : null;
    const nameOf = async (employeeId: string) =>
      str(
        (
          await database
            .query()
            .selectFrom('employees')
            .select(['name'])
            .where('id', '=', employeeId)
            .executeTakeFirst()
        )?.name ?? '',
      );
    return [
      processor.register({
        key: 'attendance.onboardBalances',
        handle: async (event) => {
          if (event.eventType !== 'onboard') return;
          const date = event.effectiveDate.slice(0, 10);
          await container.resolve(leaveServiceToken).initializeTrusted({
            year: Number(date.slice(0, 4)),
            asOf: date,
            employeeIds: [event.employeeId],
          });
        },
      }),
      processor.register({
        key: 'attendance.transferRevalidate',
        handle: async (event) => {
          if (event.eventType !== 'transfer' && event.eventType !== 'promote')
            return;
          if (event.fromDepartmentId === event.toDepartmentId) return;
          const from = event.effectiveDate.slice(0, 10);
          const blocked = await container
            .resolve(scheduleServiceToken)
            .revalidate({
              from,
              to: addDays(from, 60),
              employeeIds: [event.employeeId],
            });
          const dates = blocked
            .filter((c) => c.blocked.includes('departmentScope'))
            .map((c) => c.date)
            .sort();
          if (!dates.length) return;
          const heads = [
            await headOf(event.fromDepartmentId),
            await headOf(event.toDepartmentId),
          ].filter((u): u is string => Boolean(u));
          await notify({
            key: `transferSchedule:${event.id}`,
            userIds: heads,
            message: 'scheduleTransferBlocked',
            params: {
              name: await nameOf(event.employeeId),
              from: dates[0],
              to: dates.at(-1)!,
              count: String(dates.length),
            },
            path: `/talent/schedules?department=${event.fromDepartmentId ?? ''}&from=${dates[0]}`,
          });
        },
      }),
      processor.register({
        key: 'attendance.offboard',
        handle: async (event) => {
          if (event.eventType !== 'offboard') return;
          const date = event.effectiveDate.slice(0, 10);
          const removed = await database.transaction(async (connection) => {
            const dates = await container
              .resolve(scheduleServiceToken)
              .clearAfter(connection, event.employeeId, date);
            await container
              .resolve(leaveRequestServiceToken)
              .cancelOpenFor(connection, event.employeeId);
            await container
              .resolve(adjustmentServiceToken)
              .cancelOpenFor(connection, event.employeeId);
            return dates;
          });
          if (!removed.length) return;
          const head = await headOf(event.fromDepartmentId);
          if (head)
            await notify({
              key: `offboardSchedule:${event.id}`,
              userIds: [head],
              message: 'scheduleOffboardCleared',
              params: {
                name: await nameOf(event.employeeId),
                date,
                count: String(removed.length),
              },
              path: `/talent/schedules?department=${event.fromDepartmentId ?? ''}&from=${removed.sort()[0]}`,
            });
        },
      }),
    ];
  }

  private feishuConnection?: { close(): void };

  public override shutdown(): Promise<void> {
    this.feishuConnection?.close();
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
