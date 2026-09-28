import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { useOutletContext } from 'react-router';

import { ContractTable } from '@/components/talent/contract-table';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import type { Contract } from '@/components/talent/types';
import { useRemote } from '@/components/talent/use-remote';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { DetailOutletContext } from './types.js';

/** Tab "合同": the employee's contracts; managing them happens on the contracts page. */
export default function EmployeeContractsTab(): ReactElement {
  const { t } = useTranslation();
  const { detail } = useOutletContext<DetailOutletContext>();
  const contracts = useRemote<{ items: Contract[] }>('talent/contracts', {
    employeeId: detail.employee.id,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talent.detail.tabs.contracts')}</CardTitle>
      </CardHeader>
      <CardContent>
        {contracts.error ? (
          <LoadError error={contracts.error} onRetry={contracts.reload} />
        ) : !contracts.data ? (
          <BlockSkeleton rows={2} />
        ) : (
          <ContractTable rows={contracts.data.items} />
        )}
      </CardContent>
    </Card>
  );
}
