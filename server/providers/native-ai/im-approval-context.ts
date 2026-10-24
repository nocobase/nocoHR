import { AsyncLocalStorage } from 'node:async_hooks';

/** Set only by the verified native card handler, never by model/UI input. */
export const nativeIMApprovalContext = new AsyncLocalStorage<{
  userId: string;
  sessionId: string;
}>();
