import type { ZodType } from 'zod';

import { toolArgumentDigest } from '../assistant/tool-executor.js';

export type ProcessNode =
  | { key: string; type: 'run'; handler: string; next?: string }
  | { key: string; type: 'condition'; handler: string; yes: string; no: string }
  | { key: string; type: 'terminate'; outcome: 'success' | 'failed' };

export interface ProcessDefinition {
  key: string;
  hash: string;
  enabled: boolean;
  inputSchema: ZodType;
  entry: string;
  nodes: readonly ProcessNode[];
}

export interface ProcessRun {
  actorUserId?: string;
  eventKey: string;
  definition: ProcessDefinition;
  input: unknown;
  next: string | undefined;
  status: 'accepted' | 'running' | 'success' | 'failed' | 'uncertain';
  output: Record<string, unknown>;
}

export interface ProcessStore {
  /** Unique eventKey, atomic insert. Returns the existing row on a duplicate. */
  accept(run: ProcessRun): Promise<ProcessRun>;
  find(eventKey: string): Promise<ProcessRun | undefined>;
  /** Atomically reserves a single node on this run. */
  claim(eventKey: string, nodeKey: string): Promise<boolean>;
  finishNode(
    eventKey: string,
    nodeKey: string,
    result: unknown,
    next?: string,
  ): Promise<void>;
  finishRun(
    eventKey: string,
    status: 'success' | 'failed' | 'uncertain',
  ): Promise<void>;
}

export type ProcessHandler = (context: {
  actorUserId?: string;
  input: unknown;
  upstream: Readonly<Record<string, unknown>>;
  idempotencyKey: string;
}) => Promise<unknown>;

/** Reject missing handlers, dangling edges and cycles before accepting side effects. */
export function validateProcessDefinition(
  definition: ProcessDefinition,
  handlers: ReadonlyMap<string, ProcessHandler>,
): void {
  if (!definition.key || !definition.hash || !definition.nodes.length)
    throw new Error('INVALID_PROCESS_DEFINITION');
  const nodes = new Map(definition.nodes.map((node) => [node.key, node]));
  if (nodes.size !== definition.nodes.length || !nodes.has(definition.entry))
    throw new Error('INVALID_PROCESS_TOPOLOGY');
  for (const node of nodes.values()) {
    if (!node.key) throw new Error('INVALID_PROCESS_TOPOLOGY');
    if (node.type !== 'terminate' && !handlers.has(node.handler))
      throw new Error('PROCESS_HANDLER_NOT_AVAILABLE');
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string) => {
    if (visiting.has(key)) throw new Error('PROCESS_CYCLE');
    if (visited.has(key)) return;
    const node = nodes.get(key);
    if (!node) throw new Error('INVALID_PROCESS_TOPOLOGY');
    visiting.add(key);
    if (node.type === 'run' && node.next) visit(node.next);
    if (node.type === 'condition') {
      visit(node.yes);
      visit(node.no);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const node of nodes.values()) visit(node.key);
}

/** Execution requires a durable store and explicitly registered, trusted handlers. */
export class ProcessEngine {
  public constructor(
    private readonly store: ProcessStore,
    private readonly handlers: ReadonlyMap<string, ProcessHandler>,
    private readonly authorize: (
      definition: ProcessDefinition,
      input: unknown,
    ) => Promise<void>,
  ) {}

  public async trigger(
    definition: ProcessDefinition,
    input: unknown,
    eventKey: string,
    actorUserId?: string,
  ): Promise<ProcessRun> {
    if (!eventKey) throw new Error('PROCESS_EVENT_KEY_REQUIRED');
    if (!definition.enabled) throw new Error('PROCESS_DISABLED');
    validateProcessDefinition(definition, this.handlers);
    const parsed = definition.inputSchema.safeParse(input);
    if (!parsed.success) throw new Error('INVALID_PROCESS_INPUT');
    await this.authorize(definition, parsed.data);
    const existing = await this.store.find(eventKey);
    if (existing) {
      if (
        existing.actorUserId !== actorUserId ||
        existing.definition.key !== definition.key ||
        existing.definition.hash !== definition.hash ||
        toolArgumentDigest(existing.input) !== toolArgumentDigest(parsed.data)
      )
        throw new Error('PROCESS_EVENT_CONFLICT');
      return existing;
    }
    const accepted = await this.store.accept({
      ...(actorUserId ? { actorUserId } : {}),
      eventKey,
      definition,
      input: parsed.data,
      next: definition.entry,
      status: 'accepted',
      output: {},
    });
    if (
      accepted.actorUserId !== actorUserId ||
      accepted.definition.key !== definition.key ||
      accepted.definition.hash !== definition.hash ||
      toolArgumentDigest(accepted.input) !== toolArgumentDigest(parsed.data)
    )
      throw new Error('PROCESS_EVENT_CONFLICT');
    return accepted;
  }

  public async step(eventKey: string): Promise<void> {
    const run = await this.store.find(eventKey);
    if (!run) throw new Error('PROCESS_RUN_NOT_FOUND');
    if (run.status !== 'accepted') return;
    if (!run.next) {
      await this.store.finishRun(eventKey, 'success');
      return;
    }
    const node = run.definition.nodes.find(
      (candidate) => candidate.key === run.next,
    );
    if (!node) throw new Error('INVALID_PROCESS_TOPOLOGY');
    if (!(await this.store.claim(eventKey, node.key))) return;
    if (node.type === 'terminate') {
      await this.store.finishRun(eventKey, node.outcome);
      return;
    }
    try {
      const handler = this.handlers.get(node.handler);
      if (!handler) throw new Error('PROCESS_HANDLER_NOT_AVAILABLE');
      const result = await handler({
        ...(run.actorUserId ? { actorUserId: run.actorUserId } : {}),
        input: run.input,
        upstream: run.output,
        idempotencyKey: JSON.stringify([eventKey, node.key]),
      });
      if (node.type === 'condition' && typeof result !== 'boolean')
        throw new Error('INVALID_PROCESS_CONDITION');
      const next =
        node.type === 'condition' ? (result ? node.yes : node.no) : node.next;
      await this.store.finishNode(eventKey, node.key, result, next);
    } catch (error) {
      // A handler may have committed an external action before failing. No blind retry.
      await this.store.finishRun(eventKey, 'uncertain');
      throw error;
    }
  }
}
