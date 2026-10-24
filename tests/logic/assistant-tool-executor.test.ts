import {
  ServiceContainer,
  createServiceToken,
} from '@nocobase/service-provider';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineTools, type ToolActor } from '../../server/ai/contracts.js';
import {
  ToolExecutor,
  toolArgumentDigest,
  type StoredToolCall,
  type ToolCallStore,
  type ToolCallStatus,
} from '../../server/providers/assistant/tool-executor.js';

const actor: ToolActor = { id: 'owner', roles: [], isRoot: false };

function fixture() {
  const send = vi.fn(async () => ({ id: 'draft' }));
  const dependency = createServiceToken<{ send: typeof send }>('test/drafts');
  const container = new ServiceContainer();
  container.instance(dependency, { send });
  const tool = defineTools({
    scope: 'SPECIFIED',
    execution: 'backend',
    defaultPermission: 'ASK',
    definition: {
      name: 'saveDraft',
      description: 'Save a draft',
      schema: z.strictObject({ text: z.string() }),
    },
    dependencies: { drafts: dependency },
    invoke: (context) => context.deps.drafts.send(),
  });
  const call: StoredToolCall = {
    id: 'call',
    userId: 'owner',
    sessionId: 'session',
    employee: 'hrAssistant',
    tool: 'saveDraft',
    arguments: { text: 'a draft' },
    argumentDigest: toolArgumentDigest({ text: 'a draft' }),
    status: 'pending',
  };
  const store: ToolCallStore = {
    async find(id) {
      return id === call.id ? { ...call } : undefined;
    },
    async claim(_id, from: ToolCallStatus, to: ToolCallStatus) {
      if (call.status !== from) return false;
      call.status = to;
      return true;
    },
    async complete() {
      call.status = 'completed';
    },
  };
  const authorize = vi.fn(async () => undefined);
  const executor = new ToolExecutor(
    container,
    new Map([[tool.definition.name, tool]]),
    store,
    { authorize },
  );
  const input = {
    id: call.id,
    sessionId: call.sessionId,
    digest: call.argumentDigest,
    decision: 'approve' as const,
  };
  return { executor, input, call, send, authorize, tool, container };
}

describe('assistant tool approvals', () => {
  it('executes a concurrent approval only once', async () => {
    const f = fixture();
    const results = await Promise.allSettled([
      f.executor.decide(actor, f.input),
      f.executor.decide(actor, f.input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.call.status).toBe('completed');
  });

  it('rejects another user, another session and modified arguments', async () => {
    const f = fixture();
    await expect(
      f.executor.decide({ ...actor, id: 'other' }, f.input),
    ).rejects.toThrow('TOOL_CALL_NOT_FOUND');
    await expect(
      f.executor.decide(actor, { ...f.input, sessionId: 'other' }),
    ).rejects.toThrow('TOOL_CALL_NOT_FOUND');
    f.call.arguments = { text: 'changed' };
    await expect(f.executor.decide(actor, f.input)).rejects.toThrow(
      'TOOL_ARGUMENTS_CHANGED',
    );
    expect(f.send).not.toHaveBeenCalled();
  });

  it('rechecks permission at approval time and leaves a denied call pending', async () => {
    const f = fixture();
    f.authorize.mockRejectedValueOnce(new Error('ACCESS_REVOKED'));
    await expect(f.executor.decide(actor, f.input)).rejects.toThrow(
      'ACCESS_REVOKED',
    );
    expect(f.call.status).toBe('pending');
    expect(f.send).not.toHaveBeenCalled();
  });

  it('records uncertain execution and never automatically retries a side effect', async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(new Error('connection lost after commit'));
    await expect(f.executor.decide(actor, f.input)).rejects.toThrow(
      'connection lost',
    );
    expect(f.call.status).toBe('uncertain');
    await expect(f.executor.decide(actor, f.input)).rejects.toThrow(
      'TOOL_CALL_ALREADY_DECIDED',
    );
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid input before resolving dependencies or executing business code', async () => {
    const f = fixture();
    await expect(
      f.tool.execute(f.container, actor, { text: 42 }),
    ).rejects.toThrow('INVALID_TOOL_INPUT');
    expect(f.send).not.toHaveBeenCalled();
  });

  it('rejects a call without invoking its tool', async () => {
    const f = fixture();
    expect(
      await f.executor.decide(actor, { ...f.input, decision: 'reject' }),
    ).toEqual({ status: 'rejected' });
    expect(f.call.status).toBe('rejected');
    expect(f.send).not.toHaveBeenCalled();
  });
});
