/**
 * 制造业 (manufacturing), the first industry content pack, demonstrated by the
 * 启衡精密 case: 设备开工登记 on work order MO-24031 (prod.cncOperator, assigned
 * to the CNC 岗位上岗证) and 叉车出库登记 on dispatch note CK-24031
 * (equip.forkliftOperator, assigned to the 叉车证). Both pages and their
 * records are demo-batch.ts; the route, resource and table names keep the
 * names of the earlier batch record demo (AGENTS.md).
 *
 * The permission set definitions repeat the grants the seeds once wrote
 * (database/seed-data/permission-sets.ts `cncOperator`, seed
 * 202610120101 for the forklift set), so turning the pack on recreates a set
 * an installation dropped (seed 202610210102) exactly as the demo has it.
 */
import { definePermissionSet } from '@nocobase/authorization/permission-sets';

import { SELF_SCOPE } from '../authz-resources.js';
import { demoBatchResource } from '../exam-resources.js';
import { forkliftResource } from '../licensed/resources.js';
import type { IndustryPackDefinition } from './types.js';

const ALL = 'allRecords';
const page = (id: string) => ({
  resource: { type: 'page', id },
  actions: [{ action: 'access' }],
});

export const MANUFACTURING_PACK = 'manufacturing';
export const MACHINE_START = 'machineStart';
export const FORKLIFT_DISPATCH = 'forkliftDispatch';
export const CNC_OPERATOR_SET = 'prod.cncOperator';
export const FORKLIFT_OPERATOR_SET = 'equip.forkliftOperator';

export const manufacturingPack: IndustryPackDefinition = {
  key: MANUFACTURING_PACK,
  titleKey: 'industryPacks.manufacturing.title',
  descriptionKey: 'industryPacks.manufacturing.description',
  operations: [
    {
      kind: MACHINE_START,
      page: 'demo.batchRecord',
      path: '/demo/batch-record',
      titleKey: 'industryPacks.manufacturing.operations.machineStart',
      resource: 'demo.batch',
      action: 'signFilling',
      permissionSet: CNC_OPERATOR_SET,
      permissionSetDefinition: () =>
        definePermissionSet(CNC_OPERATOR_SET)
          .title({ key: 'permissionSets.cncOperator', ns: 'hr' })
          .grant(
            page('demo.batchRecord'),
            demoBatchResource.reference().grant({
              view: { demoBatchSignoffs: ALL },
              signFilling: { employees: SELF_SCOPE, demoBatchSignoffs: ALL },
            }),
          )
          .build(),
    },
    {
      kind: FORKLIFT_DISPATCH,
      page: 'demo.forkliftDispatch',
      path: '/demo/forklift-dispatch',
      titleKey: 'industryPacks.manufacturing.operations.forkliftDispatch',
      resource: 'demo.forklift',
      action: 'dispatch',
      permissionSet: FORKLIFT_OPERATOR_SET,
      permissionSetDefinition: () =>
        definePermissionSet(FORKLIFT_OPERATOR_SET)
          .title({ key: 'permissionSets.forkliftOperator', ns: 'hr' })
          .grant(
            page('demo.forkliftDispatch'),
            forkliftResource.reference().grant({
              view: { demoBatchSignoffs: ALL },
              dispatch: { employees: SELF_SCOPE, demoBatchSignoffs: ALL },
            }),
          )
          .build(),
    },
  ],
};
