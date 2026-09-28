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
  'importBatchId',
  'active',
  'sortOrder',
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
      ),
);

const ACTION_FIELDS = [
  'id',
  'actionType',
  'employeeId',
  'candidate',
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
          .grant('personnelActions', actionData.create([...ACTION_FIELDS])),
      )
      .action('approve', (a) =>
        a
          .title(label('authz.personnelAction.approve'))
          .grant(
            'personnelActions',
            actionData.update([
              'status',
              'approvals',
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
            actionData.update(['status', 'approvals', 'updatedAt']),
          ),
      ),
);

const CHANGE_FIELDS = [
  'id',
  'employeeId',
  'changes',
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
        a
          .title(label('authz.profileChange.review'))
          .grant(
            'profileChangeRequests',
            changeData.update([
              'status',
              'reviewerUserId',
              'reviewedAt',
              'comment',
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
  { name: 'profileChangeRequests', title: 'collections.profileChangeRequests' },
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
] as const;
