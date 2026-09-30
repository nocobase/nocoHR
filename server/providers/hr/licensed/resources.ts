/**
 * V4-14 行业方案 · 持证上岗: the business operations of this step.
 *
 * - `talent.licensedOperationSettings` · manage: the 设置 / 持证上岗 page's
 *   switch, certification-only permission sets and the two checks (hr.admin).
 * - `talent.shift` · manageRequiredCertifications: a shift's 要求的认证
 *   (hr.admin), kept apart from the V2-05 shift definition so a shift already
 *   in use can gain or lose a requirement.
 * - `demo.forklift` · view / dispatch: 叉车出库登记, granted only through
 *   equip.forkliftOperator, which is assigned to the 叉车证 certification
 *   subject (demonstration only; the page and its records exist only where
 *   the demo seed ran).
 *
 * `talent.audit` gains exportStartTrace and exportPermissionChanges in
 * profile/resources.ts (the composite is defined once, there).
 */
import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

import { label } from '../shared.js';

export const LICENSED_SETTINGS = 'talent.licensedOperationSettings';
export const SHIFT_RESOURCE = 'talent.shift';
export const FORKLIFT_RESOURCE = 'demo.forklift';

const SETTINGS_FIELDS = [
  'id',
  'value',
  'revision',
  'updatedBy',
  'createdAt',
  'updatedAt',
];
export const START_LOG_FIELDS = [
  'id',
  'kind',
  'batchNo',
  'step',
  'machineNo',
  'employeeId',
  'userId',
  'signedAt',
  'certificateId',
  'certificateNo',
  'certificateStatus',
  'createdAt',
  'updatedAt',
] as const;

export const licensedSettingsResource = defineCompositeResource(
  LICENSED_SETTINGS,
  (r) =>
    r.title(label('licensed.authz.settings')).action('manage', (a) =>
      a.title(label('licensed.authz.manage')).grant(
        'configuration',
        defineDatabasePermission((p) =>
          p
            .collection('personnelSettings')
            .title(label('licensed.authz.configuration'))
            .read(SETTINGS_FIELDS)
            .create(SETTINGS_FIELDS)
            .update(['value', 'revision', 'updatedBy', 'updatedAt']),
        ),
      ),
    ),
);

export const shiftRequirementResource = defineCompositeResource(
  SHIFT_RESOURCE,
  (r) =>
    r
      .title(label('licensed.authz.shift'))
      .action('manageRequiredCertifications', (a) =>
        a.title(label('licensed.authz.manageRequiredCertifications')).grant(
          'shifts',
          defineDatabasePermission((p) =>
            p
              .collection('shifts')
              .title(label('licensed.authz.shifts'))
              .read(['id', 'code', 'title', 'requiredCertificationIds'])
              .update(['requiredCertificationIds', 'updatedAt']),
          ),
        ),
      ),
);

export const forkliftResource = defineCompositeResource(
  FORKLIFT_RESOURCE,
  (r) =>
    r
      .title(label('licensed.authz.forklift'))
      .action('view', (a) =>
        a.title(label('licensed.authz.view')).grant(
          'demoBatchSignoffs',
          defineDatabasePermission((p) =>
            p
              .collection('demoBatchSignoffs')
              .title(label('collections.demoBatchSignoffs'))
              .read([...START_LOG_FIELDS]),
          ),
        ),
      )
      .action('dispatch', (a) =>
        a
          .title(label('licensed.authz.dispatch'))
          .grant(
            'employees',
            defineDatabasePermission((p) =>
              p
                .collection('employees')
                .title(label('collections.employees'))
                .read(['id', 'name', 'userId']),
            ),
          )
          .grant(
            'demoBatchSignoffs',
            defineDatabasePermission((p) =>
              p
                .collection('demoBatchSignoffs')
                .title(label('collections.demoBatchSignoffs'))
                .read([...START_LOG_FIELDS])
                .create([...START_LOG_FIELDS]),
            ),
          ),
      ),
);

export const LICENSED_COMPOSITES = [
  licensedSettingsResource,
  shiftRequirementResource,
  forkliftResource,
] as const;
