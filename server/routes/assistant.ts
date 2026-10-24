import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication/server';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  ApiError,
  apiErrorHandler,
  apiErrorResponses,
  apiErrorResponse,
  apiValidator,
  dataResponse,
  listResponse,
  defineApiRoutes,
  describeRoute,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  createAssistantRoutes,
  AssistantInputError,
  assistantHttpInputs,
} from './assistant-http.js';
import { assistantConversationsToken } from '../providers/assistant/tokens.js';
import {
  assistantResponses,
  assistantListOperations,
} from './assistant-schemas.js';
import type { AssistantConfig } from '../config/assistant.js';

export const assistantRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const container = app.container;
    const auth = container.resolve(authenticationToken);
    const authz = container.resolve(authorizationToken);
    const routes = createAssistantRoutes({
      enabled: () =>
        Boolean(app.config.get<AssistantConfig>('assistant')?.enabled),
      service: () => container.resolve(assistantConversationsToken),
      actor: (context) => {
        const principal = (context as Context<AuthorizationEnv, string>).get(
          'authz',
        ).identity.principal;
        if (principal.type !== 'user') throw new Error('ASSISTANT_FORBIDDEN');
        return {
          id: String(principal.id),
          roles: [],
          isRoot: false,
          locale: context.req.header('accept-language'),
        };
      },
      guard: async (c, next) => {
        let authorized: Response | void = undefined;
        const authenticated = await auth.required()(
          c as Context<AuthEnv, string>,
          async () => {
            authorized = await authz.middleware()(
              c as Context<AuthorizationEnv, string>,
              next,
            );
          },
        );
        return authenticated ?? authorized;
      },
      document: (operationId, summary, streaming) => {
        const input = assistantHttpInputs[operationId];
        const hasId = ![
          'getAssistantRuntime',
          'listAssistantEmployees',
          'listAssistantModels',
          'listAssistantConversations',
          'createAssistantConversation',
        ].includes(operationId);
        const ids = hasId
          ? [
              'id',
              ...(operationId === 'decideAssistantToolCall'
                ? ['messageId', 'callId']
                : []),
            ]
          : [];
        return [
          bodyLimit({
            maxSize: 262144,
            onError: () => {
              throw new AssistantInputError('BODY_TOO_LARGE');
            },
          }),
          describeRoute({
            tags: ['ApplicationAssistant'],
            operationId,
            summary,
            responses: {
              [operationId === 'createAssistantConversation' ? '201' : '200']:
                operationId === 'previewAssistantFile'
                  ? {
                      description: 'Retained file bytes.',
                      content: {
                        'application/octet-stream': {
                          schema: { type: 'string', format: 'binary' },
                        },
                      },
                    }
                  : streaming
                    ? {
                        description:
                          'Chat frames with a JSON type and body: new_message, content, tool_calls, tool_call_status, error, end.',
                        content: {
                          'text/event-stream': { schema: { type: 'string' } },
                        },
                      }
                    : assistantListOperations.has(operationId)
                      ? listResponse(assistantResponses[operationId])
                      : dataResponse(assistantResponses[operationId]),
              ...apiErrorResponses,
              '400': apiErrorResponse(400),
              '404': apiErrorResponse(404),
              '409': apiErrorResponse(409),
              '503': apiErrorResponse(503),
            },
          }),
          ...(ids.length
            ? [
                apiValidator(
                  'param',
                  z.object(
                    Object.fromEntries(
                      ids.map((name) => [name, z.string().min(1)]),
                    ),
                  ),
                ),
              ]
            : []),
          ...(input ? [apiValidator('json', input)] : []),
          ...(operationId === 'listAssistantMessages'
            ? [
                apiValidator(
                  'query',
                  z.object({
                    pageSize: z.coerce
                      .number()
                      .int()
                      .min(1)
                      .max(200)
                      .default(200),
                  }),
                ),
              ]
            : []),
          ...(operationId === 'listAssistantConversations'
            ? [
                apiValidator(
                  'query',
                  z.object({ q: z.string().max(200).optional() }),
                ),
              ]
            : []),
        ];
      },
    });
    routes.onError((error, context) => {
      const reason = error.message;
      let translated: Error = error;
      if (
        reason === 'CONVERSATION_NOT_FOUND' ||
        reason === 'TOOL_CALL_NOT_FOUND' ||
        reason === 'FILE_NOT_FOUND'
      )
        translated = new ApiError({
          status: 'NOT_FOUND',
          reason,
          domain: 'nocohr',
          message: 'The requested conversation item was not found.',
        });
      else if (
        [
          'ASSISTANT_FORBIDDEN',
          'FILE_ACCESS_DENIED',
          'EMPLOYEE_DISABLED',
          'TOOL_NOT_AVAILABLE',
        ].includes(reason)
      )
        translated = new ApiError({
          status: 'PERMISSION_DENIED',
          reason,
          domain: 'nocohr',
          message: 'Using the assistant is not allowed.',
        });
      else if (
        reason === 'CHAT_REQUEST_CONFLICT' ||
        reason === 'CHAT_REQUEST_ALREADY_CONSUMED' ||
        reason === 'TOOL_CALL_ALREADY_DECIDED' ||
        reason === 'TOOL_ARGUMENTS_CHANGED' ||
        reason === 'LEGACY_CONVERSATION_READ_ONLY'
      )
        translated = new ApiError({
          status: 'ABORTED',
          reason,
          domain: 'nocohr',
          message:
            'The conversation changed or this request has already been consumed.',
        });
      else if (
        reason === 'ASSISTANT_UNAVAILABLE' ||
        reason === 'ASSISTANT_MODEL_UNAVAILABLE'
      )
        translated = new ApiError({
          status: 'UNAVAILABLE',
          reason,
          domain: 'nocohr',
          message: 'The application assistant is not configured.',
        });
      else if (
        error instanceof AssistantInputError ||
        [
          'UNSUPPORTED_CHAT_REQUEST',
          'CHAT_MODEL_CHANGED',
          'CHAT_EMPLOYEE_CHANGED',
          'EMPLOYEE_NOT_FOUND',
          'CHAT_CONFIRMATION_REQUIRED',
          'UNMAPPED_MESSAGE_CONTENT',
          'AI_ATTACHMENT_PARSER_NOT_MAPPED',
          'AI_ATTACHMENT_SIZE_NOT_MAPPED',
        ].includes(reason)
      )
        translated = new ApiError({
          status: 'INVALID_ARGUMENT',
          reason,
          domain: 'nocohr',
          message:
            'The assistant request is not supported in its current state.',
          ...(error instanceof AssistantInputError
            ? { fieldViolations: error.fieldViolations }
            : {}),
          ...(reason === 'BODY_TOO_LARGE' ? { httpStatus: 413 } : {}),
        });
      return apiErrorHandler(translated, context);
    });
    return routes;
  });
