import { createContext, useContext } from 'react';

export const LEAVE_FORM_ID = 'leave-management-form';
export const LeaveFormContext = createContext<{
  pending: boolean;
  markDirty: () => void;
  start: () => void;
  end: () => void;
  saved: () => void;
} | null>(null);
export function useLeaveForm() {
  const context = useContext(LeaveFormContext);
  if (!context) throw new Error('Leave form requires its overlay');
  return context;
}
