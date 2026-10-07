import type { ReactElement } from 'react';

import { DataImportPage } from '@/components/talent/data-import-page';

/** Route `/talent/leave/balances/import`: 期初假期余额导入 (初始数据导入), each row a 期初导入 adjustment. */
export default function ImportLeaveBalancesPage(): ReactElement {
  return (
    <DataImportPage
      kind='leaveBalances'
      columns={[
        { key: 'employeeNo', required: true },
        { key: 'leaveType', required: true },
        { key: 'year', required: true },
        { key: 'opening', required: true },
        { key: 'used' },
        { key: 'note' },
      ]}
    />
  );
}
