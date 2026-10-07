/**
 * 初始数据导入 (上线准备): departments, positions, labour contracts and
 * opening leave balances from Excel, so a new customer loads its existing
 * data in the browser. Routes: `server/routes/hr/data-import.ts`.
 *
 * Each importer authorizes its own import action:
 * - departments: the departments settings item's `import`;
 * - positions: `talent.framework` `import`;
 * - contracts: `talent.contract` `import`;
 * - leave balances: `talent.leaveRequest` `importBalances`.
 * hr.admin gets them from seed 202610270101.
 */
import type { AuthorizationContext } from '@nocobase/app-plugin-authorization/server';

import { authorizeAction } from '../authorize.js';
import { createContractImport } from './contracts.js';
import { createDepartmentImport } from './departments.js';
import { createLeaveBalanceImport } from './leave-balances.js';
import { createPositionImport } from './positions.js';
import {
  lastImportedAt,
  type ImportKind,
  type ImportStatus,
} from './shared.js';
import type { DataImportDeps } from './types.js';

export type { DataImportDeps } from './types.js';
export type { ImportKind } from './shared.js';

export const IMPORT_PERMISSIONS: Record<
  ImportKind,
  { type: 'settings' | 'composite'; id: string; action: string }
> = {
  // DEPARTMENTS_SETTINGS in ../index.ts, which this module cannot import.
  departments: { type: 'settings', id: 'talent.departments', action: 'import' },
  positions: { type: 'composite', id: 'talent.framework', action: 'import' },
  contracts: { type: 'composite', id: 'talent.contract', action: 'import' },
  leaveBalances: {
    type: 'composite',
    id: 'talent.leaveRequest',
    action: 'importBalances',
  },
};

export function createDataImportService(deps: DataImportDeps) {
  const importers = {
    departments: createDepartmentImport(deps),
    positions: createPositionImport(deps),
    contracts: createContractImport(deps),
    leaveBalances: createLeaveBalanceImport(deps),
  };
  return {
    ...importers,

    /** Throws a 403 unless the caller may import this kind. */
    async authorize(authz: AuthorizationContext, kind: ImportKind) {
      const permission = IMPORT_PERMISSIONS[kind];
      if (permission.type === 'settings') {
        await authz.require({
          resource: { type: 'settings', id: permission.id },
          action: permission.action,
        });
        return;
      }
      await authorizeAction(authz, permission.id, permission.action);
    },

    async status(kind: ImportKind): Promise<ImportStatus> {
      const [count, last] = await Promise.all([
        importers[kind].count(),
        lastImportedAt(deps.database, kind),
      ]);
      return { count, lastImportedAt: last };
    },
  };
}

export type DataImportService = ReturnType<typeof createDataImportService>;
