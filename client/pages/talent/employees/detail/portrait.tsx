import type { ReactElement } from 'react';
import { useOutletContext } from 'react-router';

import { BusinessTimeline } from '@/components/talent/profile/business-timeline';
import { ProfileSummaryCard } from '@/components/talent/profile/profile-summary-card';

import type { DetailOutletContext } from './types.js';

/** Tab "画像" (V3-11): the AI summary with per-sentence evidence and the business-data timeline; the endpoints enforce scope. */
export default function EmployeePortraitTab(): ReactElement {
  const { detail } = useOutletContext<DetailOutletContext>();
  return (
    <div className='space-y-4'>
      <ProfileSummaryCard employeeId={detail.employee.id} />
      <BusinessTimeline employeeId={detail.employee.id} />
    </div>
  );
}
