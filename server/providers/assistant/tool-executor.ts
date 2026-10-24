import type { ServiceContainer } from '@nocobase/service-provider';

import type { RegisteredTool, ToolActor } from '../../ai/contracts.js';
import { capabilityRecordDigest } from '../upgrade/digest.js';

export type ToolCallStatus =
  'pending' | 'executing' | 'completed' | 'rejected' | 'uncertain';

export interface StoredToolCall {
  id: string;
  userId: string;
  sessionId: string;
  employee: string;
  tool: string;
  messageId?: string;
  modelCallId?: string;
  auto?: boolean;
  arguments: unknown;
  argumentDigest: string;
  status: ToolCallStatus;
  result?: unknown;
}

/** A durable store must implement claim as an atomic compare-and-set. */
export interface ToolCallStore {
  find(id: string): Promise<StoredToolCall | undefined>;
  claim(id: string, from: ToolCallStatus, to: ToolCallStatus): Promise<boolean>;
  complete(id: string, result: unknown): Promise<void>;
}

export interface ToolAuthorization {
  authorize(
    actor: ToolActor,
    employee: string,
    sessionId: string,
    tool: string,
  ): Promise<void>;
}

export function toolArgumentDigest(value: unknown): string {
  return capabilityRecordDigest(value);
}

/** The model cannot execute an ASK tool, claim another user's call or alter stored arguments. */
export class ToolExecutor {
  public constructor(
    private readonly container: ServiceContainer,
    private readonly tools: ReadonlyMap<string, RegisteredTool>,
    private readonly store: ToolCallStore,
    private readonly authorization: ToolAuthorization,
  ) {}

  public async decide(
    actor: ToolActor,
    input: {
      id: string;
      sessionId: string;
      digest: string;
      decision: 'approve' | 'reject';
    },
  ): Promise<
    { status: 'completed'; result: unknown } | { status: 'rejected' }
  > {
    const call = await this.store.find(input.id);
    if (
      !call ||
      call.userId !== String(actor.id) ||
      call.sessionId !== input.sessionId
    )
      throw new Error('TOOL_CALL_NOT_FOUND');
    if (
      call.argumentDigest !== input.digest ||
      toolArgumentDigest(call.arguments) !== input.digest
    )
      throw new Error('TOOL_ARGUMENTS_CHANGED');
    const tool = this.tools.get(call.tool);
    if (!tool) throw new Error('TOOL_NOT_AVAILABLE');
    await this.authorization.authorize(
      actor,
      call.employee,
      call.sessionId,
      call.tool,
    );
    if (input.decision === 'reject') {
      if (!(await this.store.claim(call.id, 'pending', 'rejected')))
        throw new Error('TOOL_CALL_ALREADY_DECIDED');
      return { status: 'rejected' };
    }
    if (!(await this.store.claim(call.id, 'pending', 'executing')))
      throw new Error('TOOL_CALL_ALREADY_DECIDED');
    try {
      const result = await tool.execute(this.container, actor, call.arguments);
      await this.store.complete(call.id, result);
      return { status: 'completed', result };
    } catch (error) {
      // The business action may already have committed. Never automatically replay it.
      await this.store.claim(call.id, 'executing', 'uncertain');
      throw error;
    }
  }
}
