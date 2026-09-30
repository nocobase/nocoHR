import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import {
  ClipboardCheckIcon,
  DownloadIcon,
  FileClockIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
  UsersIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';

import { DataTable } from '@/components/data-table';
import { DataTableColumnHeader } from '@/components/data-table-column-header';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { EmployeeStatusBadge } from '@/components/talent/badges';
import {
  displayValue,
  fieldLabel,
  useCustomFieldDefinitions,
} from '@/components/talent/custom-field-model';
import { downloadFile } from '@/components/talent/download';
import { errorMessage } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import type { EmployeeListItem } from '@/components/talent/types';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

import { LatestImportCard, type ImportSummary } from './latest-import.js';
import {
  EMPLOYEE_STATUSES,
  EMPLOYMENT_TYPES,
  type EmployeesOutletContext,
} from './types.js';

interface ListResponse {
  items: EmployeeListItem[];
  can: {
    create: boolean;
    import: boolean;
    export: boolean;
    reviewChanges: boolean;
  };
}

/** 员工 — the employee list. Managers see their departments and below; the server scopes the rows. */
export default function EmployeesPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const location = useLocation();
  // V3-08 导入能力评定 lives under 能力体系; the endpoint checks the same permission.
  const importAssessments = useCan({
    resource: { type: 'composite', id: 'talent.assessment' },
    action: 'import',
  });
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  // 界面追加字段: list columns and filters, passed to the server as `cf.<key>`.
  const { definitions: customDefinitions } =
    useCustomFieldDefinitions('employees');
  const customFilters = Object.fromEntries(
    [...params.entries()].filter(
      ([key, value]) => key.startsWith('cf.') && value,
    ),
  );
  const filters = {
    search: params.get('q') ?? '',
    departmentId: params.get('department') ?? '',
    positionId: params.get('position') ?? '',
    status: params.get('status') ?? '',
    employmentType: params.get('type') ?? '',
    // Links from the HR assistant's report: a set of employees, an import batch, a quick filter.
    ids: params.get('ids') ?? '',
    batch: params.get('batch') ?? '',
    quick: params.get('quick') ?? '',
  };
  const [text, setText] = useState(filters.search);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const list = useRemote<ListResponse>('talent/employees', {
    search: filters.search || undefined,
    departmentId: filters.departmentId || undefined,
    positionId: filters.positionId || undefined,
    status: filters.status || undefined,
    employmentType: filters.employmentType || undefined,
    ids: filters.ids || undefined,
    batch: filters.batch || undefined,
    quick: filters.quick || undefined,
    ...customFilters,
  });
  // Sensitive added fields are listed for HR administrators only (the server sends no values otherwise).
  const listedFields = customDefinitions.filter(
    (d) =>
      d.placements.includes('list') && (!d.sensitive || list.data?.can.import),
  );
  const filterFields = customDefinitions.filter(
    (d) =>
      d.placements.includes('filter') &&
      (!d.sensitive || list.data?.can.import),
  );
  const latestImport = useRemote<ImportSummary | null>(
    list.data?.can.import ? 'talent/employees/imports/latest' : null,
  );
  const changes = useRemote<unknown[]>(
    list.data?.can.reviewChanges ? 'talent/profile-changes' : null,
    { status: 'pending' },
  );
  const [exporting, setExporting] = useState(false);
  const outletContext = useMemo<EmployeesOutletContext>(
    () => ({
      reload: () => {
        list.reload();
        changes.reload();
      },
    }),
    [list, changes],
  );
  const hasFilters =
    Object.values(filters).some(Boolean) ||
    text !== '' ||
    Object.keys(customFilters).length > 0;

  const columns = useMemo<ColumnDef<EmployeeListItem>[]>(
    () => [
      {
        accessorKey: 'employeeNo',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('talent.fields.employeeNo')}
          />
        ),
      },
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('talent.fields.name')}
          />
        ),
        cell: ({ row }) => (
          <Link
            className='font-medium hover:underline'
            to={{
              pathname: `${row.original.id}/profile`,
              search: location.search,
            }}
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'department',
        header: t('talent.fields.department'),
        cell: ({ row }) =>
          lookups.departmentTitle(row.original.departmentId) ||
          row.original.departmentTitle,
      },
      {
        accessorKey: 'positionTitle',
        header: t('talent.fields.position'),
        cell: ({ row }) =>
          row.original.positionTitle ?? (
            <span className='text-muted-foreground'>—</span>
          ),
      },
      {
        accessorKey: 'managerName',
        header: t('talent.fields.manager'),
        cell: ({ row }) =>
          row.original.managerName ?? (
            <span className='text-muted-foreground'>—</span>
          ),
      },
      {
        accessorKey: 'status',
        header: t('talent.fields.status'),
        cell: ({ row }) => <EmployeeStatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'employmentType',
        header: t('talent.fields.employmentType'),
        cell: ({ row }) =>
          t(`talent.employmentType.${row.original.employmentType}`),
      },
      {
        accessorKey: 'hireDate',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('talent.fields.hireDate')}
          />
        ),
        cell: ({ row }) => (
          <span className='tabular-nums'>{row.original.hireDate ?? '—'}</span>
        ),
      },
      {
        accessorKey: 'tenureMonths',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('talent.fields.tenure')}
          />
        ),
        cell: ({ row }) =>
          row.original.tenureMonths === null
            ? '—'
            : t('talent.employees.tenureValue', {
                years: Math.floor(row.original.tenureMonths / 12),
                months: row.original.tenureMonths % 12,
              }),
      },
      {
        accessorKey: 'gapCount',
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('talent.employees.gapCount')}
          />
        ),
        cell: ({ row }) =>
          row.original.gapCount > 0 ? (
            <Badge variant='destructive'>{row.original.gapCount}</Badge>
          ) : (
            <span className='text-muted-foreground'>0</span>
          ),
      },
      ...listedFields.map((definition): ColumnDef<EmployeeListItem> => ({
        id: `cf-${definition.key}`,
        header: fieldLabel(definition, i18n.language),
        cell: ({ row }) =>
          displayValue(
            definition,
            row.original.customFields?.[definition.key],
            t('customFields.yes'),
            t('customFields.no'),
          ) || <span className='text-muted-foreground'>—</span>,
      })),
    ],
    [t, i18n.language, location.search, lookups, listedFields],
  );

  let content: ReactElement;
  if (list.error)
    content = <LoadError error={list.error} onRetry={list.reload} />;
  else if (!list.data) content = <BlockSkeleton rows={6} />;
  else if (!list.data.items.length && !hasFilters)
    content = (
      <EmptyState
        title={t('talent.employees.empty')}
        description={t('talent.employees.emptyDescription')}
      />
    );
  else
    content = (
      <DataTable
        columns={columns}
        data={list.data.items}
        getRowId={(row) => row.id}
        emptyMessage={t('talent.employees.noResults')}
      />
    );

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.employees.title')}
        description={t('talent.employees.description')}
        actions={
          <>
            {list.data?.can.reviewChanges ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link to={{ pathname: 'changes', search: location.search }} />
                }
              >
                <FileClockIcon data-icon='inline-start' />
                {t('talent.employees.pendingChanges', {
                  count: changes.data?.length ?? 0,
                })}
              </Button>
            ) : null}
            {list.data?.can.export ? (
              <Button
                variant='outline'
                disabled={exporting}
                onClick={() => {
                  setExporting(true);
                  downloadFile(api, 'talent/employees/export', 'roster.xlsx', {
                    search: filters.search || undefined,
                    departmentId: filters.departmentId || undefined,
                    positionId: filters.positionId || undefined,
                    status: filters.status || undefined,
                    employmentType: filters.employmentType || undefined,
                    quick: filters.quick || undefined,
                    ...customFilters,
                  })
                    .catch((error: unknown) =>
                      toast.add({
                        type: 'error',
                        title: errorMessage(error, t),
                      }),
                    )
                    .finally(() => setExporting(false));
                }}
              >
                {exporting ? (
                  <Spinner data-icon='inline-start' />
                ) : (
                  <DownloadIcon data-icon='inline-start' />
                )}
                {t('talent.employees.exportRoster')}
              </Button>
            ) : null}
            {list.data?.can.import ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link to={{ pathname: 'import', search: location.search }} />
                }
              >
                <UploadIcon data-icon='inline-start' />
                {t('talent.employees.import')}
              </Button>
            ) : null}
            {importAssessments.can ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to='/talent/competencies/assessments-import' />}
              >
                <ClipboardCheckIcon data-icon='inline-start' />
                {t('talent.employees.importAssessments')}
              </Button>
            ) : null}
            {list.data?.can.create ? (
              <Button
                nativeButton={false}
                render={
                  <Link to={{ pathname: 'new', search: location.search }} />
                }
              >
                <PlusIcon data-icon='inline-start' />
                {t('talent.employees.create')}
              </Button>
            ) : null}
          </>
        }
      />
      <div className='flex flex-wrap items-center gap-2'>
        <InputGroup className='w-full sm:w-64'>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            aria-label={t('talent.employees.search')}
            placeholder={t('talent.employees.search')}
            value={text}
            onChange={(event) => {
              const value = event.target.value;
              setText(value);
              window.clearTimeout(timer.current);
              timer.current = window.setTimeout(
                () => update('q', value.trim()),
                300,
              );
            }}
          />
        </InputGroup>
        <NativeSelect
          aria-label={t('talent.fields.department')}
          value={filters.departmentId}
          onChange={(e) => update('department', e.target.value)}
        >
          <NativeSelectOption value=''>
            {t('talent.employees.allDepartments')}
          </NativeSelectOption>
          {lookups.departments.map((d) => (
            <NativeSelectOption key={d.id} value={d.id}>
              {'  '.repeat(d.depth)}
              {d.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('talent.fields.position')}
          value={filters.positionId}
          onChange={(e) => update('position', e.target.value)}
        >
          <NativeSelectOption value=''>
            {t('talent.employees.allPositions')}
          </NativeSelectOption>
          {lookups.positions.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.title}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('talent.fields.status')}
          value={filters.status}
          onChange={(e) => update('status', e.target.value)}
        >
          <NativeSelectOption value=''>
            {t('talent.employees.allStatuses')}
          </NativeSelectOption>
          {EMPLOYEE_STATUSES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {t(`talent.employeeStatus.${s}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label={t('talent.fields.employmentType')}
          value={filters.employmentType}
          onChange={(e) => update('type', e.target.value)}
        >
          <NativeSelectOption value=''>
            {t('talent.employees.allTypes')}
          </NativeSelectOption>
          {EMPLOYMENT_TYPES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {t(`talent.employmentType.${s}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {filterFields.map((definition) => {
          const param = `cf.${definition.key}`;
          const label = fieldLabel(definition, i18n.language);
          return definition.type === 'select' ||
            definition.type === 'multiSelect' ||
            definition.type === 'boolean' ? (
            <NativeSelect
              key={definition.key}
              aria-label={label}
              value={params.get(param) ?? ''}
              onChange={(e) => update(param, e.target.value)}
            >
              <NativeSelectOption value=''>
                {t('customFields.filterAll', { label })}
              </NativeSelectOption>
              {definition.type === 'boolean'
                ? (['true', 'false'] as const).map((v) => (
                    <NativeSelectOption key={v} value={v}>
                      {t(v === 'true' ? 'customFields.yes' : 'customFields.no')}
                    </NativeSelectOption>
                  ))
                : definition.options.map((o) => (
                    <NativeSelectOption key={o.value} value={o.value}>
                      {o.label}
                    </NativeSelectOption>
                  ))}
            </NativeSelect>
          ) : (
            <Input
              key={definition.key}
              aria-label={label}
              placeholder={label}
              className='w-36'
              defaultValue={params.get(param) ?? ''}
              onBlur={(e) => update(param, e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key === 'Enter')
                  update(param, (e.target as HTMLInputElement).value.trim());
              }}
            />
          );
        })}
        {(['noPosition', 'noManager', 'hasGaps'] as const).map((quick) => (
          <Button
            key={quick}
            variant={filters.quick === quick ? 'secondary' : 'outline'}
            aria-pressed={filters.quick === quick}
            onClick={() =>
              update('quick', filters.quick === quick ? '' : quick)
            }
          >
            {t(`talent.employees.quick.${quick}`)}
          </Button>
        ))}
        {filters.ids ? (
          <Badge variant='secondary'>
            {t('talent.employees.linkedSet', {
              count: filters.ids.split(',').filter(Boolean).length,
            })}
          </Badge>
        ) : null}
        {filters.batch ? (
          <Badge variant='secondary'>
            {t('talent.employees.batchFilter', { batch: filters.batch })}
          </Badge>
        ) : null}
        {hasFilters ? (
          <Button
            variant='ghost'
            onClick={() => {
              window.clearTimeout(timer.current);
              setText('');
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            {t('talent.common.clearFilters')}
          </Button>
        ) : null}
        {list.loading && list.data ? (
          <Spinner aria-label={t('status.loading')} />
        ) : null}
        <span className='ml-auto hidden items-center gap-1 text-sm text-muted-foreground sm:flex'>
          <UsersIcon className='size-4' />
          {t('talent.employees.count', { count: list.data?.items.length ?? 0 })}
        </span>
      </div>
      {latestImport.data ? (
        <LatestImportCard
          summary={latestImport.data}
          onReload={latestImport.reload}
        />
      ) : null}
      {content}
      <Outlet context={outletContext} />
    </PageContainer>
  );
}
