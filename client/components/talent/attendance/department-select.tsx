import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

import { useLookups } from '../use-lookups.js';

/** The department tree as an indented native select; the empty option is "all" or "choose". */
export function DepartmentSelect({
  id,
  value,
  onChange,
  emptyLabel,
  className,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  emptyLabel: string;
  className?: string;
}): ReactElement {
  const { t } = useTranslation();
  const lookups = useLookups();
  return (
    <NativeSelect
      id={id}
      className={className}
      aria-label={id ? undefined : t('attendance.filters.department')}
      value={value}
      disabled={lookups.loading && !lookups.departments.length}
      onChange={(event) => onChange(event.target.value)}
    >
      <NativeSelectOption value=''>{emptyLabel}</NativeSelectOption>
      {lookups.departments
        // Only the departments this user works with: a head saw all twelve, with empty data behind the rest.
        .filter((d) => (d.active && lookups.inScope(d.id)) || d.id === value)
        .map((d) => (
          <NativeSelectOption key={d.id} value={d.id}>
            {`${'　'.repeat(d.depth)}${d.label}`}
          </NativeSelectOption>
        ))}
    </NativeSelect>
  );
}
