import type { EmployeeDetail } from '@/components/talent/types';

export interface DetailOutletContext {
  readonly detail: EmployeeDetail;
  readonly departmentTitle: string;
  /** Reloads the record and the list behind it. */
  readonly reload: () => void;
}
