import type { DatabaseConnection } from '@nocobase/db';
import { z } from 'zod';
import { capabilityJsonValue } from '../upgrade/json-value.js';
import {
  legacyId,
  legacyJson,
  jsonField,
} from '../assistant/legacy-contract.js';
import { copyCapabilityRecord } from '../upgrade/ledger.js';
import type { ProcessAuthorize } from './service.js';
import type { ProcessCatalog } from './catalog.js';
import { capabilityRecordDigest } from '../upgrade/digest.js';

const source = {
  sourcePackage: '@nocobase/app-plugin-workflow',
  sourceVersion: '1.0.0-beta.32',
};
const jsonColumns: Record<string, string[]> = {
  workflows: [
    'inputSchema',
    'parametersSchema',
    'parameterValues',
    'client',
    'options',
  ],
  workflowNodes: ['config', 'options'],
  workflowRuns: ['input', 'parameters', 'stack', 'output'],
  workflowNodeRuns: ['meta', 'result'],
};

/** Physical retained tables, even when their Collection metadata is no longer registered. */
export class ProcessHistory {
  public constructor(
    private readonly db: DatabaseConnection,
    private readonly authorize: ProcessAuthorize,
  ) {}
  private async rows(
    tx: DatabaseConnection,
    table: string,
    field: string,
    id: string,
  ) {
    const rows = await tx.query
      .selectFrom(table)
      .selectAll()
      .where(field, '=', id)
      .limit(1001)
      .execute();
    if (rows.length > 1000) throw new Error('PROCESS_HISTORY_BATCH_LIMIT');
    const metadata = await tx.collections.get(table);
    const decoded = new Set(
      metadata?.fields?.filter((f) => f.type === 'json').map((f) => f.name),
    );
    return rows
      .map((raw) => {
        const row = { ...raw };
        for (const name of jsonColumns[table] ?? [])
          if (row[name] != null && !decoded.has(name))
            row[name] = jsonField(row[name]);
        return capabilityJsonValue(legacyJson(row)) as Record<string, unknown>;
      })
      .sort((a, b) =>
        String(a.id ?? a.key).localeCompare(String(b.id ?? b.key)),
      );
  }
  public async definition(userId: string, id: string, tx = this.db) {
    await this.authorize(userId);
    const copied = await tx
      .repository('processDefinitions')
      .findOne({ filter: { id } });
    if (copied) return copied.snapshot as Record<string, unknown>;
    const rows = await this.rows(tx, 'workflows', 'id', id);
    if (rows.length !== 1) throw new Error('PROCESS_DEFINITION_NOT_FOUND');
    const workflow = rows[0];
    return {
      workflow,
      nodes: await this.rows(tx, 'workflowNodes', 'workflowId', id),
      stats: await this.rows(
        tx,
        'workflowStats',
        'key',
        legacyId(workflow.key),
      ),
      versionStats: await this.rows(tx, 'workflowVersionStats', 'id', id),
    };
  }
  public async run(
    userId: string,
    id: string,
    tx = this.db,
    sourceOnly = false,
  ) {
    await this.authorize(userId);
    if (!sourceOnly) {
      const copied = await tx
        .repository('processRunHistory')
        .findOne({ filter: { id } });
      if (copied) return copied.snapshot as Record<string, unknown>;
    }
    const rows = await this.rows(tx, 'workflowRuns', 'id', id);
    if (rows.length !== 1) throw new Error('PROCESS_RUN_NOT_FOUND');
    return {
      run: rows[0],
      nodes: await this.rows(tx, 'workflowNodeRuns', 'workflowRunId', id),
    };
  }
  /** One bounded definition and its final runs; every target and ledger entry commits as one unit. */
  public async copy(
    userId: string,
    id: string,
    artifactHash: string,
    catalog: ProcessCatalog,
    modules: ReadonlyMap<string, string>,
  ) {
    await this.authorize(userId);
    return this.db.transaction(async (tx) => {
      // Always reread physical sources, including on replay; target edits never become source truth.
      const workflowRows = await this.rows(tx, 'workflows', 'id', id);
      if (workflowRows.length !== 1)
        throw new Error('PROCESS_DEFINITION_NOT_FOUND');
      const workflow = workflowRows[0];
      const nodes = await this.rows(tx, 'workflowNodes', 'workflowId', id);
      const artifact = catalog.artifact(legacyId(workflow.key), artifactHash);
      this.verifyDefinition(workflow, nodes, artifact, modules);
      const runs = await this.rows(tx, 'workflowRuns', 'workflowId', id);
      if (runs.length > 100) throw new Error('PROCESS_HISTORY_BATCH_LIMIT');
      const histories = [];
      let totalNodes = 0;
      for (const run of runs) {
        if (![-3, -2, -1, 1].includes(Number(run.status)) || run.status == null)
          throw new Error('ACTIVE_OR_UNKNOWN_PROCESS_HISTORY');
        if (run.hash !== workflow.hash || run.workflowKey !== workflow.key)
          throw new Error('PROCESS_HISTORY_GAP');
        const snapshot = await this.run(userId, legacyId(run.id), tx, true);
        const nodeRuns = snapshot.nodes as Record<string, unknown>[];
        totalNodes += nodeRuns.length;
        if (totalNodes > 1000) throw new Error('PROCESS_HISTORY_BATCH_LIMIT');
        if (
          !nodeRuns.length ||
          new Set(nodeRuns.map((n) => String(n.nodeKey))).size !==
            nodeRuns.length
        )
          throw new Error('PROCESS_HISTORY_GAP');
        for (const row of nodeRuns)
          if (
            ![-3, -2, -1, 1].includes(Number(row.status)) ||
            row.status == null ||
            !nodes.some(
              (n) =>
                legacyId(n.id) === legacyId(row.nodeId) &&
                n.key === row.nodeKey,
            )
          )
            throw new Error('PROCESS_HISTORY_GAP');
        if (Number(run.status) === 1) {
          const visited = new Set<string>();
          let next: string | undefined = artifact.entry;
          while (next) {
            if (visited.has(next)) throw new Error('PROCESS_HISTORY_GAP');
            visited.add(next);
            const node = artifact.nodes.find((n) => n.key === next),
              recorded = nodeRuns.find((n) => n.nodeKey === next);
            if (!node || !recorded || Number(recorded.status) !== 1)
              throw new Error('PROCESS_HISTORY_GAP');
            if (node.type === 'terminate') {
              if (node.outcome !== 'success')
                throw new Error('PROCESS_HISTORY_GAP');
              next = undefined;
            } else if (node.type === 'condition') {
              if (typeof recorded.result !== 'boolean')
                throw new Error('PROCESS_HISTORY_GAP');
              next = recorded.result ? node.yes : node.no;
            } else next = node.next;
          }
          if (visited.size !== nodeRuns.length)
            throw new Error('PROCESS_HISTORY_GAP');
        }
        histories.push({ id: legacyId(run.id), snapshot });
      }
      const snapshot = {
        workflow,
        nodes,
        stats: await this.rows(
          tx,
          'workflowStats',
          'key',
          legacyId(workflow.key),
        ),
        versionStats: await this.rows(tx, 'workflowVersionStats', 'id', id),
      };
      const result = { copied: 0, unchanged: 0 };
      const copy = async (
        table: string,
        key: string,
        target: string,
        values: Record<string, unknown>,
        input: unknown,
      ) => {
        const status = await copyCapabilityRecord(
          tx,
          {
            ...source,
            sourceCollection: table,
            sourceKey: key,
            targetCollection: target,
            targetKey: key,
          },
          input,
          async (connection) => {
            await connection
              .repository(target)
              .createOne({ values: { id: key, ...values } });
          },
        );
        result[status]++;
      };
      // Include the bounded child run set in the definition digest to detect late arrivals on replay.
      await copy(
        'workflows',
        id,
        'processDefinitions',
        { key: workflow.key, hash: workflow.hash, artifactHash, snapshot },
        { snapshot, artifactHash, runIds: histories.map((h) => h.id).sort() },
      );
      for (const h of histories)
        await copy(
          'workflowRuns',
          h.id,
          'processRunHistory',
          { definitionId: id, snapshot: h.snapshot },
          h.snapshot,
        );
      return result;
    });
  }
  private verifyDefinition(
    workflow: Record<string, unknown>,
    nodes: Record<string, unknown>[],
    artifact: ReturnType<ProcessCatalog['artifact']>,
    modules: ReadonlyMap<string, string>,
  ) {
    if (
      !workflow.hash ||
      ![true, false, 0, 1].includes(workflow.enabled as never) ||
      artifact.enabled !== (workflow.enabled === true || workflow.enabled === 1)
    )
      throw new Error('PROCESS_DEFINITION_NOT_MAPPED');
    for (const key of ['parametersSchema', 'parameterValues', 'client'])
      if (Object.keys(workflow[key] ?? {}).length)
        throw new Error('PROCESS_CAPABILITY_NOT_MAPPED');
    const options = z
      .strictObject({ timeout: z.literal(0).optional() })
      .safeParse(workflow.options ?? {});
    if (!options.success) throw new Error('PROCESS_CAPABILITY_NOT_MAPPED');
    const normalize = (schema: unknown) => {
      const { $schema: _schema, ...rest } = schema as Record<string, unknown>;
      return rest;
    };
    if (
      capabilityRecordDigest(normalize(workflow.inputSchema)) !==
        capabilityRecordDigest(normalize(artifact.inputSchema)) ||
      nodes.length !== artifact.nodes.length
    )
      throw new Error('PROCESS_DEFINITION_NOT_MAPPED');
    const mapped = nodes.map((node) => {
      if (Object.keys(node.options ?? {}).length)
        throw new Error('PROCESS_CAPABILITY_NOT_MAPPED');
      const key = legacyId(node.key);
      if (node.type === 'terminate') {
        const config = z
          .strictObject({ outcome: z.enum(['success', 'failure']).optional() })
          .parse(node.config);
        return {
          key,
          type: 'terminate',
          outcome: config.outcome === 'failure' ? 'failed' : 'success',
        };
      }
      if (node.type !== 'run' && node.type !== 'condition')
        throw new Error('NODE_NOT_MAPPED');
      const config = z
        .strictObject({
          module: z.string(),
          ...(node.type === 'run'
            ? { args: z.strictObject({}).optional() }
            : {}),
        })
        .parse(node.config);
      const handler = modules.get(config.module);
      if (!handler) throw new Error('HANDLER_NOT_MAPPED');
      if (node.type === 'run')
        return {
          key,
          type: 'run',
          handler,
          ...(node.downstreamKey ? { next: node.downstreamKey } : {}),
        };
      if (node.downstreamKey) throw new Error('PROCESS_CAPABILITY_NOT_MAPPED');
      const yes = nodes.filter(
          (n) => n.upstreamKey === key && n.branchKey === 'yes',
        ),
        no = nodes.filter((n) => n.upstreamKey === key && n.branchKey === 'no');
      if (yes.length !== 1 || no.length !== 1)
        throw new Error('PROCESS_DEFINITION_NOT_MAPPED');
      return {
        key,
        type: 'condition',
        handler,
        yes: yes[0].key,
        no: no[0].key,
      };
    });
    for (const node of mapped)
      if (
        capabilityRecordDigest(node) !==
        capabilityRecordDigest(artifact.nodes.find((n) => n.key === node.key))
      )
        throw new Error('PROCESS_DEFINITION_NOT_MAPPED');
    const roots = nodes.filter((n) => !n.upstreamKey);
    if (roots.length !== 1 || roots[0].key !== artifact.entry)
      throw new Error('PROCESS_DEFINITION_NOT_MAPPED');
  }
}
