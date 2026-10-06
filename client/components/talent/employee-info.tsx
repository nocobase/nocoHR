import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement, ReactNode } from 'react';

import { EmployeeStatusBadge } from './badges.js';
import type { EmployeeDetail } from './types.js';

function Item({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className='min-w-0 space-y-1'>
      <dt className='text-xs text-muted-foreground'>{label}</dt>
      <dd className='truncate text-sm'>
        {children || <span className='text-muted-foreground'>—</span>}
      </dd>
    </div>
  );
}

/** Masks all but the first three and last four characters of an ID number. */
function maskId(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 7) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}${'*'.repeat(value.length - 7)}${value.slice(-4)}`;
}

/** The basic information of an employee, as a definition grid. */
export function EmployeeBasics({
  detail,
  departmentTitle,
  full = false,
}: {
  detail: EmployeeDetail;
  departmentTitle: string;
  full?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const e = detail.employee;
  return (
    <dl className='grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 lg:grid-cols-4'>
      <Item label={t('talent.fields.name')}>{e.name}</Item>
      <Item label={t('talent.fields.employeeNo')}>{e.employeeNo}</Item>
      <Item label={t('talent.fields.department')}>{departmentTitle}</Item>
      <Item label={t('talent.fields.position')}>{detail.positionTitle}</Item>
      <Item label={t('talent.fields.manager')}>{detail.managerName}</Item>
      <Item label={t('talent.fields.hireDate')}>{e.hireDate}</Item>
      <Item label={t('talent.fields.status')}>
        <EmployeeStatusBadge status={e.status} />
      </Item>
      {full ? (
        <>
          <Item label={t('talent.fields.employmentType')}>
            {t(`talent.employmentType.${e.employmentType}`)}
          </Item>
          <Item label={t('talent.fields.email')}>{e.email}</Item>
          {'mobile' in e ? (
            <Item label={t('talent.fields.mobile')}>{e.mobile}</Item>
          ) : null}
          <Item label={t('talent.fields.gender')}>
            {e.gender ? t(`talent.gender.${e.gender}`) : ''}
          </Item>
          {'birthDate' in e ? (
            <Item label={t('talent.fields.birthDate')}>{e.birthDate}</Item>
          ) : null}
          {'idNumber' in e ? (
            <Item label={t('talent.fields.idNumber')}>
              {e.idType ? `${t(`talent.idType.${e.idType}`)} ` : ''}
              {maskId(e.idNumber)}
            </Item>
          ) : null}
          {'address' in e ? (
            <Item label={t('talent.fields.address')}>{e.address}</Item>
          ) : null}
          {'personalEmail' in e ? (
            <Item label={t('talent.fields.personalEmail')}>
              {e.personalEmail}
            </Item>
          ) : null}
          <Item label={t('talent.fields.workLocation')}>{e.workLocation}</Item>
          <Item label={t('talent.fields.positionSince')}>
            {e.positionSince}
          </Item>
          {e.probationEndDate ? (
            <Item label={t('talent.fields.probationEndDate')}>
              {e.probationEndDate}
            </Item>
          ) : null}
          {e.regularizedAt ? (
            <Item label={t('talent.fields.regularizedAt')}>
              {e.regularizedAt}
            </Item>
          ) : null}
          {e.leaveDate ? (
            <Item label={t('talent.fields.leaveDate')}>{e.leaveDate}</Item>
          ) : null}
          {e.leaveReason ? (
            <Item label={t('talent.fields.leaveReason')}>
              {t(`talent.leaveReason.${e.leaveReason}`)}
            </Item>
          ) : null}
          {'note' in e && e.note !== undefined ? (
            <Item label={t('talent.fields.note')}>{e.note}</Item>
          ) : null}
        </>
      ) : null}
    </dl>
  );
}
