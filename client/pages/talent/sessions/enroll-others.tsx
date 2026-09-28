import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { UserPlusIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { TrainingSessionDetail } from '@/components/talent/training-types';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { toast } from '@/components/ui/toast';

/**
 * Enrolls someone else — an instructor for a trainee, a manager for a team
 * member. The people offered are those the caller may list; the server checks
 * the enrollment scope again.
 */
export function EnrollOthers({
  session,
  onEnrolled,
}: {
  session: TrainingSessionDetail;
  onEnrolled: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const api = useApiClient();
  const people = useRemote<{
    items: { id: string; name: string; employeeNo: string; status: string }[];
  }>('talent/employees');
  const [employeeId, setEmployeeId] = useState('');
  const [busy, setBusy] = useState(false);
  // Without the employee list (an instructor), enrolling others is left to managers and HR.
  if (people.error || !people.data) return null;
  const taken = new Set(
    session.enrollments
      .filter((e) => e.status !== 'cancelled')
      .map((e) => e.employeeId),
  );
  const options = people.data.items.filter(
    (p) => p.status !== 'leave' && !taken.has(p.id),
  );

  async function enroll(): Promise<void> {
    setBusy(true);
    try {
      await api.request({
        path: `talent/sessions/${encodeURIComponent(session.id)}/enroll`,
        method: 'POST',
        json: { employeeId },
      });
      setEmployeeId('');
      onEnrolled();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <NativeSelect
        aria-label={t('talent.sessions.enrollOther')}
        value={employeeId}
        onChange={(e) => setEmployeeId(e.target.value)}
      >
        <NativeSelectOption value=''>
          {t('talent.sessions.enrollOther')}
        </NativeSelectOption>
        {options.map((p) => (
          <NativeSelectOption key={p.id} value={p.id}>
            {p.name}（{p.employeeNo}）
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <Button
        variant='outline'
        disabled={!employeeId || busy || session.remaining <= 0}
        onClick={() => void enroll()}
      >
        <UserPlusIcon data-icon='inline-start' />
        {t('talent.sessions.enroll')}
      </Button>
    </div>
  );
}
