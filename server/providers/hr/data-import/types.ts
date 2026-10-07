import type { DatabaseManager } from '@nocobase/db';

import type { OrganizationService } from '../organization-service.js';

export interface DataImportDeps {
  readonly database: DatabaseManager;
  readonly organization: () => OrganizationService;
  /** 组织同步's data master: departments are not imported while the directory is. */
  readonly orgMaster: () => Promise<'nocohr' | 'external'>;
  /** Today in the application time zone, `YYYY-MM-DD`. */
  readonly currentDate: () => string;
  /** After contracts were imported: one full 用工合规检查 run, in the background. */
  readonly onContractsImported?: () => void;
}
