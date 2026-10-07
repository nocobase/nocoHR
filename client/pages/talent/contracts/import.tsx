import type { ReactElement } from 'react';

import { DataImportPage } from '@/components/talent/data-import-page';

/** Route `/talent/contracts/import`: 劳动合同导入 (初始数据导入), history included, created by 合同编号. */
export default function ImportContractsPage(): ReactElement {
  return (
    <DataImportPage
      kind='contracts'
      columns={[
        { key: 'employeeNo', required: true },
        { key: 'contractNo', required: true },
        { key: 'type', required: true },
        { key: 'startDate', required: true },
        { key: 'endDate' },
        { key: 'signedAt' },
        { key: 'probationEndDate' },
        { key: 'note' },
      ]}
    />
  );
}
