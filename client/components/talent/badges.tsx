import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';

type Variant = 'default' | 'secondary' | 'outline' | 'destructive';

function StatusBadge({
  group,
  value,
  variants,
}: {
  group: string;
  value: string;
  variants: Record<string, Variant>;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge variant={variants[value] ?? 'outline'}>
      {t(`talent.${group}.${value}`)}
    </Badge>
  );
}

export function EmployeeStatusBadge({
  status,
}: {
  status: string;
}): ReactElement {
  return (
    <StatusBadge
      group='employeeStatus'
      value={status}
      variants={{
        active: 'secondary',
        probation: 'outline',
        pending: 'outline',
        leave: 'destructive',
      }}
    />
  );
}

export function ReviewStatusBadge({
  status,
}: {
  status: string;
}): ReactElement {
  return (
    <StatusBadge
      group='reviewStatus'
      value={status}
      variants={{ draft: 'outline', confirmed: 'secondary' }}
    />
  );
}

export function ActionStatusBadge({
  status,
}: {
  status: string;
}): ReactElement {
  return (
    <StatusBadge
      group='actionStatus'
      value={status}
      variants={{
        pending: 'outline',
        approved: 'default',
        effective: 'secondary',
        rejected: 'destructive',
        cancelled: 'outline',
        draft: 'outline',
      }}
    />
  );
}

export function ContractStatusBadge({
  status,
}: {
  status: string;
}): ReactElement {
  return (
    <StatusBadge
      group='contractStatus'
      value={status}
      variants={{
        active: 'secondary',
        expired: 'destructive',
        renewed: 'outline',
        terminated: 'outline',
      }}
    />
  );
}

export function CategoryBadge({
  category,
}: {
  category: string;
}): ReactElement {
  return (
    <StatusBadge
      group='category'
      value={category}
      variants={{
        skill: 'outline',
        quality: 'outline',
        qualification: 'outline',
      }}
    />
  );
}

export function AssignmentStatusBadge({
  status,
}: {
  status: string;
}): ReactElement {
  return (
    <StatusBadge
      group='assignmentStatus'
      value={status}
      variants={{
        notStarted: 'outline',
        inProgress: 'default',
        overdue: 'destructive',
        completed: 'secondary',
        cancelled: 'outline',
        locked: 'outline',
      }}
    />
  );
}

export function CourseStatusBadge({
  status,
}: {
  status: string;
}): ReactElement {
  return (
    <StatusBadge
      group='courseStatus'
      value={status}
      variants={{
        draft: 'outline',
        confirmed: 'default',
        published: 'secondary',
        inactive: 'outline',
      }}
    />
  );
}

export function ParseStatusBadge({ status }: { status: string }): ReactElement {
  return (
    <StatusBadge
      group='parseStatus'
      value={status}
      variants={{
        pending: 'outline',
        ready: 'secondary',
        failed: 'destructive',
      }}
    />
  );
}
