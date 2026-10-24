/** Synthetic values shaped by NocoBaseAIService and NocoBaseChatTransport, never deployment data. */
export const assistantChatProtocol = {
  sessionId: 'synthetic-session',
  employee: 'hrAssistant',
  model: { llmService: 'synthetic', model: 'test-model' },
  send: {
    sessionId: 'synthetic-session',
    aiEmployee: 'hrAssistant',
    model: { llmService: 'synthetic', model: 'test-model' },
    messages: [
      {
        key: 'synthetic-user-message',
        role: 'user',
        content: {
          type: 'text',
          content: 'Prepare a draft for my review.',
        },
      },
    ],
  },
  approve: { type: 'approve' },
  reject: { type: 'reject', message: 'Do not save this draft.' },
  // The page sends no backend results. Only registered frontend tools add entries here.
  resume: {
    sessionId: 'synthetic-session',
    messageId: 'synthetic-assistant-message',
    model: { llmService: 'synthetic', model: 'test-model' },
    toolCallResults: [],
  },
  pendingEvent: {
    type: 'tool_calls',
    body: [
      {
        id: 'synthetic-model-call',
        name: 'saveDraft',
        args: { text: 'A synthetic draft' },
        invokeStatus: 'interrupted',
        auto: false,
        execution: 'backend',
        willInterrupt: true,
      },
    ],
  },
} as const;
