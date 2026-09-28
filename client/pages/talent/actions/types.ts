export interface ActionsOutletContext {
  readonly reload: () => void;
}

export const ACTION_TYPES = [
  'onboard',
  'regularize',
  'transfer',
  'promote',
  'offboard',
] as const;
