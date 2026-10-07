/**
 * The business permission model of the talent platform: which collections
 * participate, which composite business operations exist and what each one
 * reads and writes. Registration happens in the HR provider's boot; seeds and
 * tests import the same references to build grants.
 */
import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

import {
  automationRunItemsRead,
  automationRunsRead,
  automationSettingsWrite,
} from './automation-resources.js';
import { label } from './shared.js';

export const EMPLOYEE_BASE_FIELDS = [
  'id',
  'employeeNo',
  'name',
  'userId',
  'departmentId',
  'positionId',
  'managerEmployeeId',
  'status',
  'hireDate',
  'careerStartDate',
  'positionSince',
  'email',
  'gender',
  'idType',
  'employmentType',
  'workLocation',
  'probationEndDate',
  'regularizedAt',
  'leaveDate',
  'leaveReason',
  'lastImportBatchId',
  'externalProvider',
  'externalUserId',
  'syncLocked',
  'createdAt',
  'updatedAt',
] as const;

/** Only HR administrators and the person may read these. */
export const EMPLOYEE_SENSITIVE_FIELDS = [
  'id',
  'mobile',
  'idNumber',
  'birthDate',
  'address',
  // V1-02 V2 增补: where a departed employee is reached by mail.
  'personalEmail',
] as const;
/** Only HR administrators may read these. */
export const EMPLOYEE_NOTE_FIELDS = ['id', 'note'] as const;

export const EMPLOYEE_WRITE_FIELDS = [
  'id',
  'employeeNo',
  'name',
  'userId',
  'departmentId',
  'positionId',
  'managerEmployeeId',
  'status',
  'hireDate',
  'careerStartDate',
  'positionSince',
  'email',
  'mobile',
  'note',
  'gender',
  'birthDate',
  'idType',
  'idNumber',
  'employmentType',
  'workLocation',
  'probationEndDate',
  'regularizedAt',
  'leaveDate',
  'leaveReason',
  'address',
  'personalEmail',
  'createdAt',
  'updatedAt',
  'lastImportBatchId',
] as const;

const employeeData = defineDatabasePermission((p) =>
  p
    .collection('employees')
    .title(label('collections.employees'))
    .read([...EMPLOYEE_BASE_FIELDS]),
);
const employeeSensitive = defineDatabasePermission((p) =>
  p
    .collection('employees')
    .title(label('collections.employees'))
    .read([...EMPLOYEE_SENSITIVE_FIELDS]),
);
const employeeNotes = defineDatabasePermission((p) =>
  p
    .collection('employees')
    .title(label('collections.employees'))
    .read([...EMPLOYEE_NOTE_FIELDS]),
);
const employeeWrite = defineDatabasePermission((p) =>
  p
    .collection('employees')
    .title(label('collections.employees'))
    .read([...EMPLOYEE_BASE_FIELDS])
    .create([...EMPLOYEE_WRITE_FIELDS])
    .update([...EMPLOYEE_WRITE_FIELDS]),
);

export const employeeResource = defineCompositeResource(
  'talent.employee',
  (r) =>
    r
      .title(label('authz.employee.title'))
      // Reading one's own record (my profile) and browsing the employee list are separate decisions.
      .action('view', (a) =>
        a.title(label('authz.actions.view')).grant('employees', employeeData),
      )
      .action('list', (a) =>
        a.title(label('authz.employee.list')).grant('employees', employeeData),
      )
      .action('viewSensitive', (a) =>
        a
          .title(label('authz.employee.viewSensitive'))
          .grant('employees', employeeSensitive),
      )
      .action('viewNotes', (a) =>
        a
          .title(label('authz.employee.viewNotes'))
          .grant('employees', employeeNotes),
      )
      .action('create', (a) =>
        a
          .title(label('authz.actions.create'))
          .grant('employees', employeeWrite),
      )
      .action('update', (a) =>
        a
          .title(label('authz.actions.update'))
          .grant('employees', employeeWrite),
      )
      .action('import', (a) =>
        a
          .title(label('authz.employee.import'))
          .grant('employees', employeeWrite),
      )
      // Only for an employee without a login account that nothing references: undoing a mistaken import.
      .action('delete', (a) =>
        a
          .title(label('authz.actions.delete'))
          .grant('employees', employeeData.delete()),
      )
      .action('linkUser', (a) =>
        a
          .title(label('authz.employee.linkUser'))
          .grant('employees', employeeData.update(['userId', 'updatedAt'])),
      )
      .action('markLeave', (a) =>
        a
          .title(label('authz.employee.markLeave'))
          .grant(
            'employees',
            employeeData.update([
              'status',
              'leaveDate',
              'leaveReason',
              'updatedAt',
            ]),
          ),
      )
      // 更正任职信息: department, position and status outside the action flow, with a reason (V1-02).
      .action('correctJob', (a) =>
        a
          .title(label('authz.employee.correctJob'))
          .grant(
            'employees',
            employeeData.update([
              'departmentId',
              'positionId',
              'positionSince',
              'status',
              'leaveDate',
              'leaveReason',
              'regularizedAt',
              'updatedAt',
            ]),
          ),
      ),
);

const ASSESSMENT_FIELDS = [
  'id',
  'employeeId',
  'competencyId',
  'level',
  'source',
  'evidence',
  'assessedBy',
  'assessedAt',
  'createdAt',
  'updatedAt',
] as const;
const assessmentData = defineDatabasePermission((p) =>
  p
    .collection('employeeCompetencies')
    .title(label('collections.employeeCompetencies'))
    .read([...ASSESSMENT_FIELDS]),
);

export const assessmentResource = defineCompositeResource(
  'talent.assessment',
  (r) =>
    r
      .title(label('authz.assessment.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('employeeCompetencies', assessmentData),
      )
      .action('create', (a) =>
        a
          .title(label('authz.actions.create'))
          .grant(
            'employeeCompetencies',
            assessmentData.create([...ASSESSMENT_FIELDS]),
          ),
      )
      // V3-08: 导入能力评定 from Excel (hr.admin only).
      .action('import', (a) =>
        a
          .title(label('authz.assessment.import'))
          .grant(
            'employeeCompetencies',
            assessmentData.create([...ASSESSMENT_FIELDS]),
          ),
      ),
);

const JOB_FAMILY_FIELDS = [
  'id',
  'code',
  'title',
  'description',
  'active',
  'sortOrder',
  'createdAt',
  'updatedAt',
] as const;
const POSITION_FIELDS = [
  'id',
  'code',
  'title',
  'jobFamilyId',
  'grade',
  'responsibilities',
  'aiDraftedAt',
  // V3-08: the 岗位说明书 and its extracted text.
  'jdFileId',
  'jdFilename',
  'jdText',
  'jdStatus',
  'jdError',
  'importBatchId',
  'active',
  'sortOrder',
  // 界面追加字段 (202610210001): the framework service hides sensitive ones from readers.
  'customFields',
  // 初始数据导入 (202610270001): the department the position belongs to.
  'departmentId',
  'createdAt',
  'updatedAt',
] as const;
const REQUIREMENT_FIELDS = [
  'id',
  'positionId',
  'competencyId',
  'requiredLevel',
  'mandatory',
  'source',
  'reviewStatus',
  // V3-08: the job-description clauses a drafted requirement comes from (migration 202610240001).
  'sourceClauses',
  'createdAt',
  'updatedAt',
] as const;

const jobFamilyData = defineDatabasePermission((p) =>
  p
    .collection('jobFamilies')
    .title(label('collections.jobFamilies'))
    .read([...JOB_FAMILY_FIELDS]),
);
const positionData = defineDatabasePermission((p) =>
  p
    .collection('positions')
    .title(label('collections.positions'))
    .read([...POSITION_FIELDS]),
);
const requirementData = defineDatabasePermission((p) =>
  p
    .collection('positionRequirements')
    .title(label('collections.positionRequirements'))
    .read([...REQUIREMENT_FIELDS]),
);

export const frameworkResource = defineCompositeResource(
  'talent.framework',
  (r) =>
    r
      .title(label('authz.framework.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('jobFamilies', jobFamilyData)
          .grant('positions', positionData)
          .grant('positionRequirements', requirementData),
      )
      .action('manage', (a) =>
        a
          .title(label('authz.actions.manage'))
          .grant(
            'jobFamilies',
            jobFamilyData
              .create([...JOB_FAMILY_FIELDS])
              .update([...JOB_FAMILY_FIELDS]),
          )
          .grant(
            'positions',
            positionData
              .create([...POSITION_FIELDS])
              .update([...POSITION_FIELDS]),
          )
          .grant(
            'positionRequirements',
            requirementData
              .create([...REQUIREMENT_FIELDS])
              .update([...REQUIREMENT_FIELDS])
              .delete(),
          ),
      )
      .action('confirm', (a) =>
        a
          .title(label('authz.actions.confirm'))
          .grant(
            'positionRequirements',
            requirementData.update(['reviewStatus', 'updatedAt']).delete(),
          ),
      )
      // 初始数据导入: positions (and the job families they name) from Excel (hr.admin, seed 202610270101).
      .action('import', (a) =>
        a
          .title(label('authz.employee.import'))
          .grant(
            'jobFamilies',
            jobFamilyData
              .create([...JOB_FAMILY_FIELDS])
              .update([...JOB_FAMILY_FIELDS]),
          )
          .grant(
            'positions',
            positionData
              .create([...POSITION_FIELDS])
              .update([...POSITION_FIELDS]),
          ),
      ),
);

const COMPETENCY_FIELDS = [
  'id',
  'code',
  'title',
  'category',
  'description',
  'maxLevel',
  'source',
  'reviewStatus',
  'active',
  'createdAt',
  'updatedAt',
] as const;
const LEVEL_FIELDS = [
  'id',
  'competencyId',
  'level',
  'title',
  'behaviors',
  'createdAt',
  'updatedAt',
] as const;
const competencyData = defineDatabasePermission((p) =>
  p
    .collection('competencies')
    .title(label('collections.competencies'))
    .read([...COMPETENCY_FIELDS]),
);
const levelData = defineDatabasePermission((p) =>
  p
    .collection('competencyLevels')
    .title(label('collections.competencyLevels'))
    .read([...LEVEL_FIELDS]),
);

export const competencyResource = defineCompositeResource(
  'talent.competency',
  (r) =>
    r
      .title(label('authz.competency.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('competencies', competencyData)
          .grant('competencyLevels', levelData),
      )
      .action('manage', (a) =>
        a
          .title(label('authz.actions.manage'))
          .grant(
            'competencies',
            competencyData
              .create([...COMPETENCY_FIELDS])
              .update([...COMPETENCY_FIELDS]),
          )
          .grant(
            'competencyLevels',
            levelData
              .create([...LEVEL_FIELDS])
              .update([...LEVEL_FIELDS])
              .delete(),
          ),
      )
      .action('confirm', (a) =>
        a
          .title(label('authz.actions.confirm'))
          .grant(
            'competencies',
            competencyData.update(['reviewStatus', 'updatedAt']).delete(),
          )
          .grant('competencyLevels', levelData.delete()),
      ),
);

export const frameworkAdvisorResource = defineCompositeResource(
  'talent.frameworkAdvisor',
  (r) =>
    r
      .title(label('authz.frameworkAdvisor.title'))
      .action('use', (a) =>
        a
          .title(label('authz.frameworkAdvisor.use'))
          .grant('positions', positionData)
          .grant('competencies', competencyData),
      )
      .action('configure', (a) =>
        a
          .title(label('authz.actions.configure'))
          .grant('aiAutomationSettings', automationSettingsWrite)
          .grant('aiTaskRuns', automationRunsRead)
          .grant('aiTaskRunItems', automationRunItemsRead),
      ),
);

// V3-08 发展目标岗位 (拟任人员): view the targets in scope; manage sets and cancels them.
const DEVELOPMENT_TARGET_FIELDS = [
  'id',
  'employeeId',
  'targetPositionId',
  'reason',
  'status',
  'createdBy',
  'achievedAt',
  'cancelledAt',
  'cancelledBy',
  'decisionActionId',
  'createdAt',
  'updatedAt',
] as const;
const developmentTargetData = defineDatabasePermission((p) =>
  p
    .collection('developmentTargets')
    .title(label('collections.developmentTargets'))
    .read([...DEVELOPMENT_TARGET_FIELDS]),
);
export const developmentTargetResource = defineCompositeResource(
  'talent.developmentTarget',
  (r) =>
    r
      .title(label('authz.developmentTarget.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('developmentTargets', developmentTargetData),
      )
      .action('manage', (a) =>
        a
          .title(label('authz.actions.manage'))
          .grant(
            'developmentTargets',
            developmentTargetData
              .create([...DEVELOPMENT_TARGET_FIELDS])
              .update([...DEVELOPMENT_TARGET_FIELDS]),
          ),
      ),
);

/**
 * The HR assistant (V1 step 1): `configure` switches its proactive work,
 * picks the owner, edits parameters and reads or retries its runs. Step 2
 * adds `use` and `extract`.
 */
export const hrAssistantResource = defineCompositeResource(
  'talent.hrAssistant',
  (r) =>
    r
      .title(label('authz.hrAssistant.title'))
      .action('configure', (a) =>
        a
          .title(label('authz.actions.configure'))
          .grant('aiAutomationSettings', automationSettingsWrite)
          .grant('aiTaskRuns', automationRunsRead)
          .grant('aiTaskRunItems', automationRunItemsRead),
      )
      // Step 2: ask the assistant about one's own record; the tool reads only the caller's own data.
      .action('use', (a) =>
        a
          .title(label('authz.hrAssistant.use'))
          .grant('employees', employeeData),
      )
      // Step 2: read an uploaded ID, diploma or contract scan and propose profile changes for HR to review.
      .action('extract', (a) =>
        a
          .title(label('authz.hrAssistant.extract'))
          .grant('employees', employeeData),
      ),
);

// ---- Step 2: core HR ----

const EDUCATION_FIELDS = [
  'id',
  'employeeId',
  'school',
  'degree',
  'major',
  'startDate',
  'endDate',
  'createdAt',
  'updatedAt',
] as const;
const EXPERIENCE_FIELDS = [
  'id',
  'employeeId',
  'company',
  'title',
  'startDate',
  'endDate',
  'description',
  'createdAt',
  'updatedAt',
] as const;
const CONTACT_FIELDS = [
  'id',
  'employeeId',
  'name',
  'relation',
  'phone',
  'createdAt',
  'updatedAt',
] as const;
const ATTACHMENT_FIELDS = [
  'id',
  'employeeId',
  'fileId',
  'category',
  'title',
  'createdAt',
  'updatedAt',
] as const;

const educationData = defineDatabasePermission((p) =>
  p
    .collection('employeeEducations')
    .title(label('collections.employeeEducations'))
    .read([...EDUCATION_FIELDS]),
);
const experienceData = defineDatabasePermission((p) =>
  p
    .collection('employeeExperiences')
    .title(label('collections.employeeExperiences'))
    .read([...EXPERIENCE_FIELDS]),
);
const contactData = defineDatabasePermission((p) =>
  p
    .collection('employeeEmergencyContacts')
    .title(label('collections.employeeEmergencyContacts'))
    .read([...CONTACT_FIELDS]),
);
const attachmentData = defineDatabasePermission((p) =>
  p
    .collection('employeeAttachments')
    .title(label('collections.employeeAttachments'))
    .read([...ATTACHMENT_FIELDS]),
);

export const profileResource = defineCompositeResource('talent.profile', (r) =>
  r
    .title(label('authz.profile.title'))
    .action('view', (a) =>
      a
        .title(label('authz.actions.view'))
        .grant('employeeEducations', educationData)
        .grant('employeeExperiences', experienceData),
    )
    .action('viewContacts', (a) =>
      a
        .title(label('authz.profile.viewContacts'))
        .grant('employeeEmergencyContacts', contactData)
        .grant('employeeAttachments', attachmentData),
    )
    .action('manage', (a) =>
      a
        .title(label('authz.actions.manage'))
        .grant(
          'employeeEducations',
          educationData
            .create([...EDUCATION_FIELDS])
            .update([...EDUCATION_FIELDS])
            .delete(),
        )
        .grant(
          'employeeExperiences',
          experienceData
            .create([...EXPERIENCE_FIELDS])
            .update([...EXPERIENCE_FIELDS])
            .delete(),
        )
        .grant(
          'employeeEmergencyContacts',
          contactData
            .create([...CONTACT_FIELDS])
            .update([...CONTACT_FIELDS])
            .delete(),
        )
        .grant(
          'employeeAttachments',
          attachmentData
            .create([...ATTACHMENT_FIELDS])
            .update([...ATTACHMENT_FIELDS])
            .delete(),
        ),
    ),
);

const CONTRACT_FIELDS = [
  'id',
  'employeeId',
  'contractNo',
  'type',
  'startDate',
  'endDate',
  'signedAt',
  'status',
  'previousContractId',
  'fileId',
  'note',
  'createdAt',
  'updatedAt',
] as const;
const contractData = defineDatabasePermission((p) =>
  p
    .collection('employmentContracts')
    .title(label('collections.employmentContracts'))
    .read([...CONTRACT_FIELDS]),
);

export const contractResource = defineCompositeResource(
  'talent.contract',
  (r) =>
    r
      .title(label('authz.contract.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('employmentContracts', contractData),
      )
      .action('manage', (a) =>
        a
          .title(label('authz.actions.manage'))
          .grant(
            'employmentContracts',
            contractData
              .create([...CONTRACT_FIELDS])
              .update([...CONTRACT_FIELDS]),
          ),
      )
      // 初始数据导入: contracts and their history from Excel (hr.admin, seed 202610270101).
      .action('import', (a) =>
        a
          .title(label('authz.employee.import'))
          .grant(
            'employmentContracts',
            contractData
              .create([...CONTRACT_FIELDS])
              .update([...CONTRACT_FIELDS]),
          ),
      ),
);

const ACTION_FIELDS = [
  'id',
  'actionType',
  'employeeId',
  'candidate',
  'fromDepartmentId',
  'fromPositionId',
  'approvalDepartmentId',
  'currentApproverUserIds',
  'toDepartmentId',
  'toPositionId',
  'effectiveDate',
  'reason',
  'leaveReason',
  'status',
  'applicantUserId',
  'approvals',
  'effectiveAt',
  'createdAt',
  'updatedAt',
] as const;
const actionData = defineDatabasePermission((p) =>
  p
    .collection('personnelActions')
    .title(label('collections.personnelActions'))
    .read([...ACTION_FIELDS]),
);

export const personnelActionResource = defineCompositeResource(
  'talent.personnelAction',
  (r) =>
    r
      .title(label('authz.personnelAction.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('personnelActions', actionData),
      )
      .action('create', (a) =>
        a
          .title(label('authz.actions.create'))
          .grant(
            'personnelActions',
            // personalEmail (V1-02 V2 增补) is written with a 离职单 but never read through the action.
            actionData.create([...ACTION_FIELDS, 'personalEmail']),
          ),
      )
      .action('approve', (a) =>
        a
          .title(label('authz.personnelAction.approve'))
          .grant(
            'personnelActions',
            actionData.update([
              'status',
              'approvals',
              'currentApproverUserIds',
              'effectiveAt',
              'employeeId',
              'updatedAt',
            ]),
          ),
      )
      .action('cancel', (a) =>
        a
          .title(label('authz.personnelAction.cancel'))
          .grant(
            'personnelActions',
            actionData.update([
              'status',
              'approvals',
              'currentApproverUserIds',
              'updatedAt',
            ]),
          ),
      ),
);

const JOB_EVENT_FIELDS = [
  'id',
  'employeeId',
  'eventType',
  'fromDepartmentId',
  'toDepartmentId',
  'fromPositionId',
  'toPositionId',
  'effectiveDate',
  'source',
  'actionId',
  'note',
  'processedAt',
  'syncRunId',
  'processError',
  'createdAt',
  'updatedAt',
] as const;

/** The employee's job history. Read only: events are appended by the services and never edited or deleted. */
const jobEventData = defineDatabasePermission((p) =>
  p
    .collection('jobEvents')
    .title(label('collections.jobEvents'))
    .read([...JOB_EVENT_FIELDS]),
);

export const jobEventResource = defineCompositeResource(
  'talent.jobEvent',
  (r) =>
    r
      .title(label('authz.jobEvent.title'))
      .action('view', (a) =>
        a.title(label('authz.actions.view')).grant('jobEvents', jobEventData),
      )
      // V1-03: hand a failed event to its handlers again.
      .action('retry', (a) =>
        a.title(label('authz.jobEvent.retry')).grant('jobEvents', jobEventData),
      ),
);

const syncRunData = defineDatabasePermission((p) =>
  p
    .collection('orgSyncRuns')
    .title(label('collections.orgSyncRuns'))
    .read([
      'id',
      'provider',
      'mode',
      'orgMaster',
      'triggeredBy',
      'startedAt',
      'finishedAt',
      'status',
      'stats',
      'issues',
      'error',
      'createdAt',
      'updatedAt',
    ]),
);

/** 组织同步 (V1-03): settings, runs, switching the data master, and working through pending items. */
export const orgSyncResource = defineCompositeResource('talent.orgSync', (r) =>
  r
    .title(label('authz.orgSync.title'))
    .action('view', (a) =>
      a.title(label('authz.actions.view')).grant('orgSyncRuns', syncRunData),
    )
    .action('configure', (a) =>
      a
        .title(label('authz.actions.configure'))
        .grant('orgSyncRuns', syncRunData),
    )
    .action('run', (a) =>
      a.title(label('authz.orgSync.run')).grant('orgSyncRuns', syncRunData),
    )
    .action('switchMaster', (a) =>
      a
        .title(label('authz.orgSync.switchMaster'))
        .grant('orgSyncRuns', syncRunData),
    )
    .action('resolveIssues', (a) =>
      a
        .title(label('authz.orgSync.resolveIssues'))
        .grant('orgSyncRuns', syncRunData),
    ),
);

const aliasData = defineDatabasePermission((p) =>
  p
    .collection('positionAliases')
    .title(label('collections.positionAliases'))
    .read([
      'id',
      'provider',
      'externalTitle',
      'positionId',
      'source',
      'reviewStatus',
      'draftReason',
      'confirmedBy',
      'confirmedAt',
      'createdAt',
      'updatedAt',
    ]),
);

/** 统一 AI 入口 (V1-04): use the entry; configure its routing table, knowledge scopes and bots. */
export const aiAssistantResource = defineCompositeResource(
  'talent.aiAssistant',
  (r) =>
    r
      .title(label('authz.aiAssistant.title'))
      .action('use', (a) =>
        a.title(label('authz.actions.use')).grant('employees', employeeData),
      )
      .action('configure', (a) =>
        a
          .title(label('authz.actions.configure'))
          .grant('employees', employeeData),
      ),
);

/** 职务映射 (V1-03): confirm is for the HR assistant's drafts. */
export const positionAliasResource = defineCompositeResource(
  'talent.positionAlias',
  (r) =>
    r
      .title(label('authz.positionAlias.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('positionAliases', aliasData),
      )
      .action('manage', (a) =>
        a
          .title(label('authz.actions.manage'))
          .grant('positionAliases', aliasData),
      )
      .action('confirm', (a) =>
        a
          .title(label('authz.actions.confirm'))
          .grant('positionAliases', aliasData),
      ),
);

const CHANGE_FIELDS = [
  'id',
  'employeeId',
  'changes',
  'source',
  'attachmentFileId',
  'confidence',
  'status',
  'reviewerUserId',
  'reviewedAt',
  'comment',
  'createdAt',
  'updatedAt',
] as const;
const changeData = defineDatabasePermission((p) =>
  p
    .collection('profileChangeRequests')
    .title(label('collections.profileChangeRequests'))
    .read([...CHANGE_FIELDS]),
);

export const profileChangeResource = defineCompositeResource(
  'talent.profileChange',
  (r) =>
    r
      .title(label('authz.profileChange.title'))
      .action('request', (a) =>
        a
          .title(label('authz.profileChange.request'))
          .grant(
            'profileChangeRequests',
            changeData.create([...CHANGE_FIELDS]),
          ),
      )
      .action('review', (a) =>
        a.title(label('authz.profileChange.review')).grant(
          'profileChangeRequests',
          changeData.update([
            'status',
            'reviewerUserId',
            'reviewedAt',
            'comment',
            // An assistant suggestion keeps what HR finally wrote.
            'changes',
            'updatedAt',
          ]),
        ),
      ),
);

export const rosterResource = defineCompositeResource('talent.roster', (r) =>
  r
    .title(label('authz.roster.title'))
    .action('export', (a) =>
      a.title(label('authz.roster.export')).grant('employees', employeeData),
    ),
);

export const hrReportResource = defineCompositeResource(
  'talent.hrReport',
  (r) =>
    r
      .title(label('authz.hrReport.title'))
      .action('view', (a) =>
        a.title(label('authz.actions.view')).grant('employees', employeeData),
      ),
);

const DEPARTMENT_PUBLIC_FIELDS = [
  'id',
  'code',
  'title',
  'parentId',
  'managerId',
  'active',
  'sortOrder',
] as const;
const departmentPublic = defineDatabasePermission((p) =>
  p
    .collection('departments')
    .title(label('collections.departments'))
    .read([...DEPARTMENT_PUBLIC_FIELDS]),
);
const employeePublic = defineDatabasePermission((p) =>
  p
    .collection('employees')
    .title(label('collections.employees'))
    .read(['id', 'name', 'departmentId', 'positionId', 'status']),
);

export const orgChartResource = defineCompositeResource(
  'talent.orgChart',
  (r) =>
    r
      .title(label('authz.orgChart.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('departments', departmentPublic)
          .grant('employees', employeePublic),
      ),
);

export const HR_COLLECTIONS: readonly { name: string; title: string }[] = [
  { name: 'departments', title: 'collections.departments' },
  { name: 'departmentMembers', title: 'collections.departmentMembers' },
  { name: 'employees', title: 'collections.employees' },
  { name: 'employeeCompetencies', title: 'collections.employeeCompetencies' },
  { name: 'jobFamilies', title: 'collections.jobFamilies' },
  { name: 'positions', title: 'collections.positions' },
  { name: 'competencies', title: 'collections.competencies' },
  { name: 'competencyLevels', title: 'collections.competencyLevels' },
  { name: 'positionRequirements', title: 'collections.positionRequirements' },
  { name: 'employeeEducations', title: 'collections.employeeEducations' },
  { name: 'employeeExperiences', title: 'collections.employeeExperiences' },
  {
    name: 'employeeEmergencyContacts',
    title: 'collections.employeeEmergencyContacts',
  },
  { name: 'employeeAttachments', title: 'collections.employeeAttachments' },
  { name: 'employmentContracts', title: 'collections.employmentContracts' },
  { name: 'personnelActions', title: 'collections.personnelActions' },
  { name: 'jobEvents', title: 'collections.jobEvents' },
  { name: 'orgSyncRuns', title: 'collections.orgSyncRuns' },
  { name: 'positionAliases', title: 'collections.positionAliases' },
  { name: 'profileChangeRequests', title: 'collections.profileChangeRequests' },
  // V3-08
  { name: 'developmentTargets', title: 'collections.developmentTargets' },
];

/** Every composite this application registers, in workspace order. */
export const HR_COMPOSITES = [
  employeeResource,
  assessmentResource,
  frameworkResource,
  competencyResource,
  frameworkAdvisorResource,
  hrAssistantResource,
  profileResource,
  contractResource,
  personnelActionResource,
  profileChangeResource,
  rosterResource,
  hrReportResource,
  orgChartResource,
  jobEventResource,
  orgSyncResource,
  positionAliasResource,
  aiAssistantResource,
  // V3-08
  developmentTargetResource,
] as const;

/** Record access keys the grants above may select. */
export const MANAGED_DEPARTMENTS_SCOPE = 'talent.managedDepartments';
export const SELF_SCOPE = 'talent.self';

/** Collections whose records belong to one employee through `employeeId`. */
export const EMPLOYEE_CHILD_COLLECTIONS = [
  'employeeCompetencies',
  'employeeEducations',
  'employeeExperiences',
  'employeeEmergencyContacts',
  'employeeAttachments',
  'employmentContracts',
  'personnelActions',
  'jobEvents',
  'profileChangeRequests',
  // V3-08: the managed scope also reaches targets whose position is held in a managed department (record-access.ts).
  'developmentTargets',
] as const;
