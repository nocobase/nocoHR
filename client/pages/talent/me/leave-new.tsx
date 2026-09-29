import { useParams } from 'react-router';
import {
  ExistingLeaveDraft,
  LeaveRequestForm,
} from '@/components/talent/leave-request-form';

export default function NewLeaveRequestPage() {
  const { requestId } = useParams();
  return requestId ? (
    <ExistingLeaveDraft key={requestId} id={requestId} />
  ) : (
    <LeaveRequestForm />
  );
}
