import type { ReactElement } from 'react';
import { useOutletContext } from 'react-router';

import { EmployeePerformanceTab } from '@/components/talent/performance-results';

import type { DetailOutletContext } from './types.js';

/** Tab "绩效" (V4-12): the employee's review results; the endpoint enforces scope. */
export default function EmployeePerformanceRoute(): ReactElement {
  const { detail } = useOutletContext<DetailOutletContext>();
  return <EmployeePerformanceTab employeeId={detail.employee.id} />;
}
