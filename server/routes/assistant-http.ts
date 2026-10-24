import { Hono, type MiddlewareHandler } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { ToolActor } from '../ai/contracts.js';
import type { AssistantConversations } from '../providers/assistant/conversation-service.js';
import {
  sendRequest,
  resumeRequest,
  decisionRequest,
} from '../providers/assistant/chat-adapter.js';

const selectedModel = z.strictObject({
  llmService: z.string().optional(),
  model: z.string().min(1),
});
const createBody = z.strictObject({
  aiEmployee: z.strictObject({ username: z.string().min(1) }),
  modelSettings: selectedModel,
});
const editBody = z.strictObject({ title: z.string().trim().min(1).max(200) });
export class AssistantInputError extends Error {
  public fieldViolations?: { field: string; description: string }[];
}
export const assistantHttpInputs: Record<string, z.ZodType> = {
  createAssistantConversation: createBody,
  replaceAssistantUserPrompt: z.strictObject({ prompt: z.string() }),
  updateAssistantConversation: editBody,
  decideAssistantToolCall: decisionRequest,
  sendAssistantMessage: sendRequest.omit({ sessionId: true }),
  resumeAssistantToolCall: resumeRequest.omit({ sessionId: true }),
};

/** HTTP binding shared by the application contribution and isolated transport tests. */
export function createAssistantRoutes(options: {
  enabled: () => boolean;
  service: () => AssistantConversations;
  actor: (context: Parameters<MiddlewareHandler>[0]) => ToolActor;
  guard: MiddlewareHandler;
  document: (
    operationId: string,
    summary: string,
    streaming?: boolean,
  ) => readonly MiddlewareHandler[];
}) {
  const r = new Hono();
  const doc = options.document;
  const body = async <T>(
    c: Parameters<MiddlewareHandler>[0],
    schema: z.ZodType<T>,
  ) => {
    let value: unknown;
    try {
      value = await c.req.json();
    } catch {
      throw new AssistantInputError('INVALID_ARGUMENT');
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      const error = new AssistantInputError('UNSUPPORTED_CHAT_REQUEST');
      error.fieldViolations = parsed.error.issues.map((issue) => ({
        field: issue.path.map(String).join('.') || '*',
        description: 'The field is invalid or unsupported.',
      }));
      throw error;
    }
    return parsed.data;
  };
  r.get(
    '/assistantRuntime',
    options.guard,
    ...doc(
      'getAssistantRuntime',
      'Get the configured application chat runtime',
    ),
    (c) => c.json({ data: { enabled: options.enabled() } }),
  );
  const security: MiddlewareHandler = async (c, next) =>
    options.guard(c, async () => {
      if (!options.enabled()) throw new Error('ASSISTANT_UNAVAILABLE');
      await options.service().authorize(options.actor(c));
      await next();
    });
  r.get(
    '/assistantEmployees',
    security,
    ...doc('listAssistantEmployees', 'List application AI employees'),
    async (c) =>
      c.json({
        data: await options.service().roster(options.actor(c)),
        meta: {},
      }),
  );
  r.put(
    '/assistantEmployees/:id/userPrompt',
    security,
    ...doc(
      'replaceAssistantUserPrompt',
      'Replace the caller’s personal employee prompt',
    ),
    async (c) => {
      const input = (await body(
        c,
        assistantHttpInputs.replaceAssistantUserPrompt,
      )) as { prompt: string };
      await options
        .service()
        .setUserPrompt(options.actor(c), c.req.param('id'), input.prompt);
      return c.json({ data: { prompt: input.prompt } });
    },
  );
  r.get(
    '/assistantFiles/:id/preview',
    security,
    ...doc(
      'previewAssistantFile',
      'Read a retained attachment with uploader or AI settings access',
    ),
    async (c) => {
      const { file, stream } = await options
        .service()
        .previewFile(options.actor(c), c.req.param('id'));
      return new Response(stream, {
        headers: {
          'Content-Type': file.mimetype,
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'X-Content-Type-Options': 'nosniff',
        },
      });
    },
  );
  r.get(
    '/assistantModels',
    security,
    ...doc('listAssistantModels', 'List configured application models'),
    (c) => c.json({ data: options.service().models.list(), meta: {} }),
  );
  r.get(
    '/assistantConversations',
    security,
    ...doc(
      'listAssistantConversations',
      'List the caller’s application conversations',
    ),
    async (c) => {
      const rows = await options
        .service()
        .list(options.actor(c), (c.req.query('q') ?? '').slice(0, 200));
      return c.json({
        data: rows.map((row) => options.service().wire(row)),
        meta: { pageSize: 200 },
      });
    },
  );
  r.post(
    '/assistantConversations',
    security,
    ...doc('createAssistantConversation', 'Create an application conversation'),
    async (c) => {
      const input = await body(c, createBody);
      return c.json(
        {
          data: options
            .service()
            .wire(
              await options
                .service()
                .create(
                  options.actor(c),
                  input.aiEmployee.username,
                  input.modelSettings,
                ),
            ),
        },
        201,
      );
    },
  );
  r.get(
    '/assistantConversations/:id',
    security,
    ...doc(
      'getAssistantConversation',
      'Read an owned application conversation',
    ),
    async (c) =>
      c.json({
        data: options
          .service()
          .wire(
            await options.service().get(options.actor(c), c.req.param('id')),
          ),
      }),
  );
  r.get(
    '/assistantConversations/:id/messages',
    security,
    ...doc(
      'listAssistantMessages',
      'Read an owned conversation’s stored messages',
    ),
    async (c) => {
      const size = z.coerce
        .number()
        .int()
        .min(1)
        .max(200)
        .safeParse(c.req.query('pageSize') ?? 200);
      if (!size.success) throw new AssistantInputError('INVALID_ARGUMENT');
      const rows = await options
        .service()
        .history(options.actor(c), c.req.param('id'));
      return c.json({
        data: rows.slice(0, size.data),
        meta: { pageSize: size.data },
      });
    },
  );
  r.patch(
    '/assistantConversations/:id',
    security,
    ...doc(
      'updateAssistantConversation',
      'Rename an owned application conversation',
    ),
    async (c) => {
      const input = await body(c, editBody);
      await options.service().edit(options.actor(c), c.req.param('id'), input);
      return c.json({ data: {} });
    },
  );
  r.delete(
    '/assistantConversations/:id',
    security,
    ...doc(
      'archiveAssistantConversation',
      'Archive an owned conversation while retaining history',
    ),
    async (c) => {
      await options
        .service()
        .edit(options.actor(c), c.req.param('id'), { state: 'archived' });
      return c.json({ data: {} });
    },
  );
  r.post(
    '/assistantConversations/:id/markRead',
    security,
    ...doc('markAssistantConversationRead', 'Mark a conversation as read'),
    async (c) => {
      await options.service().markRead(options.actor(c), c.req.param('id'));
      return c.json({ data: {} });
    },
  );
  r.put(
    '/assistantConversations/:id/messages/:messageId/toolCalls/:callId/userDecision',
    security,
    ...doc(
      'decideAssistantToolCall',
      'Approve or reject a stored backend tool call',
    ),
    async (c) => {
      const input = await body(c, decisionRequest);
      return c.json({
        data: await options
          .service()
          .decide(
            options.actor(c),
            c.req.param('id'),
            c.req.param('messageId'),
            c.req.param('callId'),
            input,
          ),
      });
    },
  );
  for (const [path, kind] of [
    ['send', 'send'],
    ['resumeToolCall', 'resume'],
  ] as const) {
    r.post(
      `/assistantConversations/:id/${path}`,
      security,
      ...doc(
        kind === 'send' ? 'sendAssistantMessage' : 'resumeAssistantToolCall',
        kind === 'send'
          ? 'Send a text message'
          : 'Continue after stored tool decisions',
        true,
      ),
      async (c) => {
        const input = (await body(
          c,
          assistantHttpInputs[
            kind === 'send' ? 'sendAssistantMessage' : 'resumeAssistantToolCall'
          ],
        )) as Record<string, unknown>;
        if (Object.hasOwn(input, 'sessionId'))
          throw new AssistantInputError('UNSUPPORTED_CHAT_REQUEST');
        const controller = new AbortController();
        const signal = AbortSignal.any([c.req.raw.signal, controller.signal]);
        // Validation, ownership and the durable claim all precede the first SSE byte.
        const run = await options
          .service()
          .prepare(
            options.actor(c),
            c.req.param('id'),
            kind,
            { ...input, sessionId: c.req.param('id') },
            signal,
          );
        return streamSSE(c, async (stream) => {
          stream.onAbort(() => controller.abort());
          try {
            await run(async (event) => {
              signal.throwIfAborted();
              await stream.writeSSE({ data: JSON.stringify(event) });
            });
            if (!signal.aborted)
              await stream.writeSSE({ data: JSON.stringify({ type: 'end' }) });
          } catch {
            if (!signal.aborted)
              await stream.writeSSE({
                data: JSON.stringify({
                  type: 'error',
                  code: 'CHAT_REQUEST_FAILED',
                  body: 'CHAT_REQUEST_FAILED',
                }),
              });
          }
        });
      },
    );
  }
  return r;
}
