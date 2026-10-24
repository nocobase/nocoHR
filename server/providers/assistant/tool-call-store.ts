import type { DatabaseConnection } from '@nocobase/db';
import { z } from 'zod';
import { capabilityJsonValue } from '../upgrade/json-value.js';

import {
  toolArgumentDigest,
  type StoredToolCall,
  type ToolCallStatus,
  type ToolCallStore,
} from './tool-executor.js';

const storedCall = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  employee: z.string().min(1),
  tool: z.string().min(1),
  messageId: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  modelCallId: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  auto: z
    .boolean()
    .nullable()
    .optional()
    .transform((value) => value ?? false),
  arguments: z.unknown(),
  argumentDigest: z.string().length(64),
  result: z.unknown().optional(),
  status: z.enum([
    'pending',
    'executing',
    'completed',
    'rejected',
    'uncertain',
  ]),
});

/** Application-owned persistence. Legacy tool-call rows are never updated. */
export class DatabaseToolCallStore implements ToolCallStore {
  public constructor(private readonly connection: DatabaseConnection) {}

  public async create(input: StoredToolCall): Promise<void> {
    const call = storedCall.parse(input);
    if (
      call.status !== 'pending' ||
      toolArgumentDigest(call.arguments) !== call.argumentDigest
    )
      throw new Error('INVALID_PENDING_TOOL_CALL');
    const stamp = new Date();
    await this.connection.repository('assistantToolCalls').createOne({
      values: {
        ...call,
        arguments: capabilityJsonValue(call.arguments),
        result: capabilityJsonValue(call.result),
        createdAt: stamp,
        updatedAt: stamp,
      },
    });
  }

  public async find(id: string): Promise<StoredToolCall | undefined> {
    const row = await this.connection
      .repository('assistantToolCalls')
      .findOne({ filter: { id } });
    if (!row) return undefined;
    const parsed = storedCall.safeParse(row);
    if (!parsed.success) throw new Error('INVALID_STORED_TOOL_CALL');
    // A pending database row has a nullable result; keep the pre-execution contract unchanged.
    const { result, ...call } = parsed.data;
    if (call.status === 'completed' && !Object.hasOwn(parsed.data, 'result'))
      throw new Error('INVALID_STORED_TOOL_CALL');
    return call.status === 'completed' ? { ...call, result } : call;
  }

  public async list(sessionId: string): Promise<StoredToolCall[]> {
    const rows = await this.connection
      .repository('assistantToolCalls')
      .findMany({ filter: { sessionId } });
    return rows.map((row) => {
      const { result, ...call } = storedCall.parse(row);
      return call.status === 'completed' ? { ...call, result } : call;
    });
  }

  public async claim(
    id: string,
    from: ToolCallStatus,
    to: ToolCallStatus,
  ): Promise<boolean> {
    const result = await this.connection
      .repository('assistantToolCalls')
      .updateMany({
        filter: { id, status: from },
        values: { status: to, updatedAt: new Date() },
      });
    return result.updatedCount === 1;
  }

  public async complete(id: string, result: unknown): Promise<void> {
    const update = await this.connection
      .repository('assistantToolCalls')
      .updateMany({
        filter: { id, status: 'executing' },
        values: {
          status: 'completed',
          result: capabilityJsonValue(result),
          updatedAt: new Date(),
        },
      });
    if (update.updatedCount !== 1) throw new Error('TOOL_CALL_STATE_CONFLICT');
  }
}
