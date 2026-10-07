import type { ReactElement } from 'react';

import { DataImportPage } from '@/components/talent/data-import-page';

/** Route `/settings/departments/import`: 部门导入 (初始数据导入), created or updated by 部门编码. */
export default function ImportDepartmentsPage(): ReactElement {
  return (
    <DataImportPage
      kind='departments'
      columns={[
        { key: 'code', required: true },
        { key: 'title', required: true },
        { key: 'parentCode' },
        { key: 'managerNo' },
        { key: 'sortOrder' },
      ]}
    />
  );
}
