/**
 * V2-06 我的工资条 (`talent.myPayslips`, every employee): the employee's own
 * published payslips. Amounts appear only after verifying the password again
 * (the verification lasts 30 minutes and also unlocks the HR assistant's
 * payslip answers). Each line expands to its calculation; reference items are
 * listed apart. Laid out for phone width.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { LockIcon, MessageCircleQuestionIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import {
  PayslipView,
  type PayslipLineView,
} from '@/components/talent/payroll-payslip';
import { useMoney, usePayrollError } from '@/components/talent/payroll-hooks';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

interface MonthList {
  verified: boolean;
  months: { month: string; net: number | null; viewedAt: string | null }[];
}
interface MyPayslip {
  month: string;
  lines: PayslipLineView[];
  gross: number;
  socialEmployee: number;
  housingFundEmployee: number;
  tax: number;
  net: number;
}
interface MyInsurance {
  enrolment: {
    planCity: string;
    socialBase: number;
    housingFundBase: number;
    startMonth: string;
  } | null;
  month: string | null;
  contributions: {
    code: string;
    base: number;
    employeeRate: number;
    employee: number;
  }[];
}

export default function MyPayslipsPage(): ReactElement {
  const { t } = useTranslation();
  const [epoch, setEpoch] = useState(0);
  const list = useRemote<MonthList>('talent/my-payslips', { epoch });
  return (
    <PageContainer className='max-w-2xl'>
      <PageHeader
        title={t('payroll.mine.title')}
        description={t('payroll.mine.description')}
        actions={
          <Button
            variant='outline'
            nativeButton={false}
            render={<Link to='/talent/me/assistant' />}
          >
            <MessageCircleQuestionIcon data-icon='inline-start' />
            {t('payroll.mine.ask')}
          </Button>
        }
      />
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={4} />
      ) : !list.data.months.length ? (
        <EmptyState title={t('payroll.mine.empty')} />
      ) : !list.data.verified ? (
        <VerifyCard onVerified={() => setEpoch((n) => n + 1)} />
      ) : (
        <Verified months={list.data.months.map((m) => m.month)} />
      )}
    </PageContainer>
  );
}

function VerifyCard({ onVerified }: { onVerified: () => void }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = usePayrollError();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function verify(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: 'talent/my-payslips/verify',
        method: 'POST',
        json: { password },
      });
      setPassword('');
      onVerified();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <LockIcon aria-hidden className='size-4' />
          {t('payroll.mine.verifyTitle')}
        </CardTitle>
        <CardDescription>{t('payroll.mine.verifyDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className='space-y-3'
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor='payslip-password'>
              {t('payroll.mine.password')}
            </FieldLabel>
            <Input
              id='payslip-password'
              type='password'
              autoComplete='current-password'
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <Button
            type='submit'
            className='w-full sm:w-auto'
            disabled={busy || !password}
          >
            {t('payroll.mine.verify')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Verified({ months }: { months: string[] }): ReactElement {
  const { t } = useTranslation();
  const money = useMoney();
  const [params, setParams] = useSearchParams();
  const requested = params.get('month');
  const month = requested && months.includes(requested) ? requested : months[0];
  const slip = useRemote<MyPayslip>(`talent/my-payslips/${month}`);
  const insurance = useRemote<MyInsurance>(
    'talent/my-payslips/social-insurance',
  );
  return (
    <div className='space-y-4'>
      <Field className='max-w-xs'>
        <FieldLabel htmlFor='payslip-month'>
          {t('payroll.cycles.month')}
        </FieldLabel>
        <NativeSelect
          id='payslip-month'
          value={month}
          onChange={(event) => {
            const next = new URLSearchParams(params);
            next.set('month', event.target.value);
            setParams(next, { replace: true });
          }}
        >
          {months.map((m) => (
            <NativeSelectOption key={m} value={m}>
              {m}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Card>
        <CardHeader>
          <CardTitle>{t('payroll.mine.payslipOf', { month })}</CardTitle>
          <CardDescription>{t('payroll.mine.expandHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {slip.error ? (
            <LoadError error={slip.error} onRetry={slip.reload} />
          ) : !slip.data ? (
            <BlockSkeleton rows={6} />
          ) : (
            <PayslipView lines={slip.data.lines} totals={slip.data} />
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('payroll.mine.insurance')}</CardTitle>
        </CardHeader>
        <CardContent className='text-sm'>
          {insurance.error ? (
            <LoadError error={insurance.error} onRetry={insurance.reload} />
          ) : !insurance.data ? (
            <BlockSkeleton rows={2} />
          ) : !insurance.data.enrolment ? (
            <p className='text-muted-foreground'>
              {t('payroll.mine.noInsurance')}
            </p>
          ) : (
            <div className='space-y-2'>
              <p>
                {t('payroll.mine.insuredIn', {
                  city: insurance.data.enrolment.planCity,
                  social: money(insurance.data.enrolment.socialBase),
                  housing: money(insurance.data.enrolment.housingFundBase),
                })}
              </p>
              <ul className='space-y-1'>
                {insurance.data.contributions
                  .filter((c) => c.employee > 0)
                  .map((c) => (
                    <li key={c.code} className='flex justify-between gap-2'>
                      <span>
                        {t(`payroll.insurance.codes.${c.code}`)} ·{' '}
                        {money(c.base)} × {c.employeeRate}%
                      </span>
                      <span className='tabular-nums'>{money(c.employee)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      <p className='text-sm text-muted-foreground'>
        {t('payroll.mine.feedback')}
      </p>
    </div>
  );
}
