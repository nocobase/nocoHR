import { useTranslation } from '@nocobase/i18n/client';
import { SearchIcon } from 'lucide-react';
import { useId, useState, type ReactElement } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

export interface CheckOption {
  readonly value: string;
  readonly label: string;
  /** Indentation level, for tree-shaped options such as departments. */
  readonly depth?: number;
  readonly hint?: string;
}

/**
 * A searchable list of checkboxes for picking several items, such as
 * competencies, departments or people. The selection is shown as a count.
 */
export function MultiCheckList({
  options,
  value,
  onChange,
  label,
  height = 'h-44',
  searchable = true,
}: {
  options: readonly CheckOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  label: string;
  height?: string;
  searchable?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const baseId = useId();
  const selected = new Set(value);
  const q = query.trim().toLowerCase();
  const visible = q
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.hint?.toLowerCase().includes(q),
      )
    : options;
  const toggle = (option: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) next.add(option);
    else next.delete(option);
    onChange([...next]);
  };
  return (
    <div className='rounded-md border' role='group' aria-label={label}>
      {searchable ? (
        <div className='border-b p-2'>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('talent.common.search')}
              aria-label={t('talent.common.search')}
            />
          </InputGroup>
        </div>
      ) : null}
      <ul className={cn('space-y-0.5 overflow-y-auto p-1', height)}>
        {visible.map((option) => {
          const id = `${baseId}-${option.value}`;
          return (
            <li key={option.value}>
              <label
                htmlFor={id}
                className='flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted'
                style={{ paddingLeft: `${0.5 + (option.depth ?? 0) * 1}rem` }}
              >
                <Checkbox
                  id={id}
                  checked={selected.has(option.value)}
                  onCheckedChange={(checked) =>
                    toggle(option.value, checked === true)
                  }
                />
                <span className='min-w-0 flex-1 truncate'>{option.label}</span>
                {option.hint ? (
                  <span className='shrink-0 text-xs text-muted-foreground'>
                    {option.hint}
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
        {!visible.length ? (
          <li className='px-2 py-3 text-center text-sm text-muted-foreground'>
            {t('talent.common.noMatches')}
          </li>
        ) : null}
      </ul>
      <div className='border-t px-3 py-1.5 text-xs text-muted-foreground'>
        {t('talent.common.selectedCount', { count: value.length })}
      </div>
    </div>
  );
}
