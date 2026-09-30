/**
 * The channel a conversation turn came from (V1-04): set by the office-suite
 * bot adapter around one AI employee turn, read by tools that record it (a
 * knowledge gap's `channel`). Unset means the in-app chat.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type ConversationChannel = 'app' | 'feishu' | 'dingtalk' | 'wecom';

export const channelContext = new AsyncLocalStorage<ConversationChannel>();

export function currentChannel(): ConversationChannel {
  return channelContext.getStore() ?? 'app';
}
