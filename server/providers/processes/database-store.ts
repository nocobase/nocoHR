import { randomUUID } from 'node:crypto';

import type { DatabaseConnection } from '@nocobase/db';
import { z } from 'zod';

import { capabilityRecordDigest } from '../upgrade/digest.js';
import { capabilityJsonValue } from '../upgrade/json-value.js';
import type { ProcessDefinition, ProcessRun, ProcessStore } from './engine.js';

const rowSchema = z.object({
  actorUserId: z.string().nullable().optional(),
  id: z.string(),
  eventKey: z.string(),
  definitionKey: z.string(),
  definitionHash: z.string(),
  definitionDigest: z.string(),
  input: z.unknown(),
  output: z.record(z.string(), z.unknown()),
  next: z.string().nullable(),
  status: z.enum(['accepted', 'running', 'success', 'failed', 'uncertain']),
});

export function processDefinitionDigest(definition: ProcessDefinition): string {
  return capabilityRecordDigest({
    key: definition.key,
    hash: definition.hash,
    entry: definition.entry,
    nodes: definition.nodes,
  });
}

/** Definition revisions come from verified artifacts, never from editable run rows. */
export class DatabaseProcessStore implements ProcessStore {
  public constructor(
    private readonly connection: DatabaseConnection,
    private readonly resolveDefinition: (
      key: string,
      hash: string,
    ) => Promise<ProcessDefinition>,
  ) {}

  public async accept(run: ProcessRun): Promise<ProcessRun> {
    try {
      const stamp = new Date();
      await this.connection.repository('processRuns').createOne({
        values: {
          ...(run.actorUserId ? { actorUserId: run.actorUserId } : {}),
          id: randomUUID(),
          eventKey: run.eventKey,
          definitionKey: run.definition.key,
          definitionHash: run.definition.hash,
          definitionDigest: processDefinitionDigest(run.definition),
          input: capabilityJsonValue(run.input),
          output: {},
          next: run.definition.entry,
          status: 'accepted',
          createdAt: stamp,
          updatedAt: stamp,
        },
      });
    } catch (error) {
      // A unique event key may have been accepted by another worker. Other errors remain errors.
      if (
        !(await this.connection
          .repository('processRuns')
          .findOne({ filter: { eventKey: run.eventKey } }))
      )
        throw error;
    }
    const accepted = await this.find(run.eventKey);
    if (!accepted) throw new Error('PROCESS_ACCEPTANCE_MISSING');
    return accepted;
  }

  public async find(eventKey: string): Promise<ProcessRun | undefined> {
    const raw = await this.connection
      .repository('processRuns')
      .findOne({ filter: { eventKey } });
    if (!raw) return undefined;
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) throw new Error('INVALID_STORED_PROCESS_RUN');
    const row = parsed.data;
    const definition = await this.resolveDefinition(
      row.definitionKey,
      row.definitionHash,
    );
    if (processDefinitionDigest(definition) !== row.definitionDigest)
      throw new Error('PROCESS_ARTIFACT_CHANGED');
    return {
      ...(row.actorUserId ? { actorUserId: row.actorUserId } : {}),
      eventKey,
      definition,
      input: row.input,
      output: row.output,
      next: row.next ?? undefined,
      status: row.status,
    };
  }

  public async claim(eventKey: string, nodeKey: string): Promise<boolean> {
    return this.connection.transaction(async (tx) => {
      const runs = tx.repository('processRuns');
      const result = await runs.updateMany({
        filter: { eventKey, status: 'accepted', next: nodeKey },
        values: { status: 'running', updatedAt: new Date() },
      });
      if (result.updatedCount !== 1) return false;
      const run = await runs.findOne({ filter: { eventKey } });
      const parsed = rowSchema.safeParse(run);
      if (!parsed.success) throw new Error('INVALID_STORED_PROCESS_RUN');
      const stamp = new Date();
      await tx.repository('processNodeRuns').createOne({
        values: {
          id: randomUUID(),
          runId: parsed.data.id,
          nodeKey,
          status: 'running',
          createdAt: stamp,
          updatedAt: stamp,
        },
      });
      return true;
    });
  }

  public async finishNode(
    eventKey: string,
    nodeKey: string,
    result: unknown,
    next?: string,
  ): Promise<void> {
    await this.connection.transaction(async (tx) => {
      const runs = tx.repository('processRuns');
      const raw = await runs.findOne({
        filter: { eventKey, status: 'running', next: nodeKey },
      });
      if (!raw) throw new Error('PROCESS_STATE_CONFLICT');
      const parsed = rowSchema.safeParse(raw);
      if (!parsed.success) throw new Error('INVALID_STORED_PROCESS_RUN');
      const update = await runs.updateMany({
        filter: { eventKey, status: 'running', next: nodeKey },
        values: {
          output: capabilityJsonValue({
            ...parsed.data.output,
            [nodeKey]: result,
          }),
          next: next ?? null,
          status: 'accepted',
          updatedAt: new Date(),
        },
      });
      if (update.updatedCount !== 1) throw new Error('PROCESS_STATE_CONFLICT');
      const node = await tx.repository('processNodeRuns').updateMany({
        filter: { runId: parsed.data.id, nodeKey, status: 'running' },
        values: {
          status: 'success',
          result: capabilityJsonValue(result),
          updatedAt: new Date(),
        },
      });
      if (node.updatedCount !== 1) throw new Error('PROCESS_STATE_CONFLICT');
    });
  }

  public async finishRun(
    eventKey: string,
    status: 'success' | 'failed' | 'uncertain',
  ): Promise<void> {
    await this.connection.transaction(async (tx) => {
      const runs = tx.repository('processRuns');
      const row = await runs.findOne({ filter: { eventKey } });
      const parsed = rowSchema.safeParse(row);
      if (!parsed.success) throw new Error('INVALID_STORED_PROCESS_RUN');
      if (!['accepted', 'running'].includes(parsed.data.status))
        throw new Error('PROCESS_STATE_CONFLICT');
      const update = await runs.updateMany({
        filter: { eventKey, status: parsed.data.status },
        values: { status, updatedAt: new Date() },
      });
      if (update.updatedCount !== 1) throw new Error('PROCESS_STATE_CONFLICT');
      await tx.repository('processNodeRuns').updateMany({
        filter: { runId: parsed.data.id, status: 'running' },
        values: { status, updatedAt: new Date() },
      });
    });
  }
}
