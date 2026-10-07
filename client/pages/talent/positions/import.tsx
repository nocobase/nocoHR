import type { ReactElement } from 'react';

import { DataImportPage } from '@/components/talent/data-import-page';

/** Route `/talent/positions/import`: 岗位导入 (初始数据导入), created or updated by 岗位编码. */
export default function ImportPositionsPage(): ReactElement {
  return (
    <DataImportPage
      kind='positions'
      columns={[
        { key: 'code', required: true },
        { key: 'title', required: true },
        { key: 'family', required: true },
        { key: 'grade' },
        { key: 'departmentCode' },
      ]}
    />
  );
}
