import { describe, expect, it } from 'vitest';

import {
  checkUpgradeReadiness,
  type ReplacementCapabilities,
  type UpgradeInventory,
} from '../../server/providers/upgrade/preflight.js';

function inventory(): UpgradeInventory {
  return {
    formatVersion: 1,
    ai: {
      employees: ['hrAssistant'],
      tools: ['getMyHrProfile'],
      providers: ['test'],
      capabilities: ['chat'],
      activeTurns: 0,
      pendingApprovals: 0,
      missingFiles: 0,
      missingSecrets: 0,
      unmappedRecords: 0,
      unverifiedToolProfiles: 0,
      autoPolicyDifferences: 0,
    },
    workflows: {
      definitions: 1,
      enabledDefinitions: 1,
      nodeTypes: ['run'],
      customHandlers: [],
      activeRuns: 0,
      unqueuedRuns: 0,
      interruptedNodes: 0,
      unmappedParameters: 0,
      unmappedBranchJoins: 0,
      unverifiedScheduleUsers: 0,
      missingArtifacts: 0,
      unmappedRecords: 0,
    },
    history: { missingSources: 0, checksumMismatches: 0 },
  };
}

function replacement(): ReplacementCapabilities {
  return {
    ai: {
      verified: true,
      employees: new Set(['hrAssistant']),
      tools: new Set(['getMyHrProfile']),
      providers: new Set(['test']),
      capabilities: new Set(['chat']),
      approvalTransferVerified: true,
    },
    workflows: {
      verified: true,
      nodeTypes: new Set(['run']),
      customHandlers: new Set(),
    },
  };
}

describe('capability migration preflight', () => {
  it.each([
    ['unqueuedRuns', 'UNQUEUED_PROCESS_RUNS'],
    ['interruptedNodes', 'INTERRUPTED_PROCESS_NODES'],
    ['unmappedParameters', 'WORKFLOW_PARAMETERS_NOT_MAPPED'],
    ['unmappedBranchJoins', 'WORKFLOW_BRANCH_JOINS_NOT_MAPPED'],
    ['unverifiedScheduleUsers', 'UNVERIFIED_SCHEDULE_USERS'],
  ] as const)(
    'requires reconciliation of %s without accepting missing evidence',
    (field, code) => {
      const input = inventory();
      input.workflows[field] = 1;
      expect(checkUpgradeReadiness(input, replacement())).toEqual({
        ready: false,
        findings: [{ code, count: 1 }],
      });
      const incomplete = structuredClone(input) as unknown as {
        workflows: Record<string, unknown>;
      };
      delete incomplete.workflows[field];
      expect(checkUpgradeReadiness(incomplete, replacement())).toEqual({
        ready: false,
        findings: [{ code: 'INVALID_INVENTORY', count: 1 }],
      });
    },
  );
  it('does not treat unchanged ledger records or unmapped automatic policy as verified', () => {
    const input = inventory();
    input.ai.unverifiedToolProfiles = 2;
    input.ai.autoPolicyDifferences = 1;
    expect(checkUpgradeReadiness(input, replacement()).findings).toEqual([
      { code: 'UNVERIFIED_AI_TOOL_PROFILES', count: 2 },
      { code: 'AI_AUTO_POLICY_DIFFERENCES', count: 1 },
    ]);
  });
  it('requires validated replacements even when there is no legacy data', () => {
    const capability = replacement();
    capability.ai.verified = false;
    capability.workflows.verified = false;
    expect(
      checkUpgradeReadiness(inventory(), capability).findings.map(
        (f) => f.code,
      ),
    ).toEqual(['AI_NOT_VERIFIED', 'WORKFLOW_NOT_VERIFIED']);
  });

  it('blocks unknown providers and custom nodes without exposing their values', () => {
    const input = inventory();
    input.ai.providers = ['private-provider-name', 'private-provider-name'];
    input.workflows.nodeTypes.push('private-node');
    const result = checkUpgradeReadiness(input, replacement());
    expect(result).toEqual({
      ready: false,
      findings: [
        { code: 'PROVIDER_NOT_MAPPED', count: 1 },
        { code: 'NODE_NOT_MAPPED', count: 1 },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('does not replay running work or silently approve interrupted tools', () => {
    const input = inventory();
    input.ai.activeTurns = 2;
    input.ai.pendingApprovals = 3;
    input.workflows.activeRuns = 1;
    const capability = replacement();
    capability.ai.approvalTransferVerified = false;
    expect(checkUpgradeReadiness(input, capability)).toEqual({
      ready: false,
      findings: [
        { code: 'ACTIVE_AI_TURNS', count: 2 },
        { code: 'ACTIVE_WORKFLOW_RUNS', count: 1 },
        { code: 'APPROVAL_TRANSFER_NOT_VERIFIED', count: 3 },
      ],
    });
  });

  it('rejects credentials and malformed counts instead of printing input in errors', () => {
    for (const input of [
      { ...inventory(), apiKey: 'never-print-this' },
      { ...inventory(), ai: { ...inventory().ai, activeTurns: -1 } },
      { ...inventory(), ai: { ...inventory().ai, missingSecrets: NaN } },
      {
        ...inventory(),
        ai: { ...inventory().ai, unverifiedToolProfiles: undefined },
      },
      {
        ...inventory(),
        ai: { ...inventory().ai, autoPolicyDifferences: undefined },
      },
    ]) {
      expect(checkUpgradeReadiness(input, replacement())).toEqual({
        ready: false,
        findings: [{ code: 'INVALID_INVENTORY', count: 1 }],
      });
    }
  });

  it('blocks incomplete migration history, artifacts and record mappings', () => {
    const input = inventory();
    input.history.missingSources = 1;
    input.history.checksumMismatches = 2;
    input.workflows.missingArtifacts = 1;
    input.ai.unmappedRecords = 2;
    expect(checkUpgradeReadiness(input, replacement()).findings).toEqual([
      { code: 'MISSING_ARTIFACTS', count: 1 },
      { code: 'UNMAPPED_RECORDS', count: 2 },
      { code: 'MISSING_MIGRATION_SOURCES', count: 1 },
      { code: 'MIGRATION_CHECKSUM_MISMATCH', count: 2 },
    ]);
  });

  it('permits cutover only after all supplied capabilities are verified', () => {
    expect(checkUpgradeReadiness(inventory(), replacement())).toEqual({
      ready: true,
      findings: [],
    });
  });
});
