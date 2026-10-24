import { createServiceToken } from '@nocobase/service-provider';
import type { AssistantConversations } from './conversation-service.js';
export const assistantConversationsToken =
  createServiceToken<AssistantConversations>('app/assistant-conversations');
