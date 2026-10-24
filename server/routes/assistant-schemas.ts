import { z } from 'zod';

const model = z.object({
  llmService: z.string().optional(),
  model: z.string(),
});
const call = z.object({
  id: z.string(),
  name: z.string(),
  args: z.unknown(),
  auto: z.boolean(),
  execution: z.literal('backend'),
  willInterrupt: z.boolean(),
  invokeStatus: z.string(),
  status: z.string().optional(),
  content: z.unknown().optional(),
});
const conversation = z.object({
  sessionId: z.string(),
  title: z.string(),
  aiEmployee: z.object({ username: z.string() }),
  options: z.object({ modelSettings: model }),
  read: z.boolean(),
  updatedAt: z.iso.datetime(),
  llmActiveState: z.string(),
  state: z.string(),
});
export const assistantResponses: Record<string, z.ZodType> = {
  replaceAssistantUserPrompt: z.object({ prompt: z.string() }),
  previewAssistantFile: z.unknown(),
  getAssistantRuntime: z.object({ enabled: z.boolean() }),
  listAssistantEmployees: z.object({
    username: z.string(),
    nickname: z.string().optional(),
    position: z.string().optional(),
    avatar: z.string().optional(),
    description: z.string().optional(),
    bio: z.string().optional(),
    greeting: z.string().optional(),
    userConfig: z
      .object({ prompt: z.string().nullable().optional() })
      .optional(),
    modelSettings: z
      .object({
        enabled: z.boolean().optional(),
        model: z.string().optional(),
        llmService: z.string().optional(),
        models: z.array(model).optional(),
      })
      .optional(),
  }),
  listAssistantModels: z.object({
    llmService: z.string(),
    llmServiceTitle: z.string(),
    enabledModels: z.array(z.object({ value: z.string(), label: z.string() })),
  }),
  listAssistantConversations: conversation,
  createAssistantConversation: conversation,
  getAssistantConversation: conversation,
  listAssistantMessages: z.object({
    key: z.string(),
    role: z.string(),
    createdAt: z.iso.datetime(),
    content: z.object({
      messageId: z.string(),
      content: z.string(),
      tool_calls: z.array(call),
      attachments: z.array(z.unknown()).optional(),
    }),
  }),
  decideAssistantToolCall: z.object({
    updated: z.literal(1),
    toolCalls: z.array(call),
  }),
  updateAssistantConversation: z.object({}),
  archiveAssistantConversation: z.object({}),
  markAssistantConversationRead: z.object({}),
};
export const assistantListOperations = new Set([
  'listAssistantEmployees',
  'listAssistantModels',
  'listAssistantConversations',
  'listAssistantMessages',
]);
