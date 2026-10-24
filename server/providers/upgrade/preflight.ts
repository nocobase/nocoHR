import { z } from 'zod';

const count = z.number().int().nonnegative().safe();
const names = z.array(z.string().min(1).max(128)).max(10_000);

/** Metadata only. Credentials, messages, inputs and results are never accepted. */
export const UpgradeInventorySchema = z.strictObject({
  formatVersion: z.literal(1),
  ai: z.strictObject({
    employees: names,
    tools: names,
    providers: names,
    capabilities: names,
    activeTurns: count,
    pendingApprovals: count,
    missingFiles: count,
    missingSecrets: count,
    unmappedRecords: count,
    unverifiedToolProfiles: count,
    autoPolicyDifferences: count,
  }),
  workflows: z.strictObject({
    definitions: count,
    enabledDefinitions: count,
    nodeTypes: names,
    customHandlers: names,
    activeRuns: count,
    unqueuedRuns: count,
    interruptedNodes: count,
    unmappedParameters: count,
    unmappedBranchJoins: count,
    unverifiedScheduleUsers: count,
    missingArtifacts: count,
    unmappedRecords: count,
  }),
  history: z.strictObject({ missingSources: count, checksumMismatches: count }),
});

export type UpgradeInventory = z.infer<typeof UpgradeInventorySchema>;

export interface ReplacementCapabilities {
  ai: {
    verified: boolean;
    employees: ReadonlySet<string>;
    tools: ReadonlySet<string>;
    providers: ReadonlySet<string>;
    capabilities: ReadonlySet<string>;
    approvalTransferVerified: boolean;
  };
  workflows: {
    verified: boolean;
    nodeTypes: ReadonlySet<string>;
    customHandlers: ReadonlySet<string>;
  };
}

export type PreflightCode =
  | 'INVALID_INVENTORY'
  | 'UNVERIFIED_AI_TOOL_PROFILES'
  | 'AI_AUTO_POLICY_DIFFERENCES'
  | 'AI_NOT_VERIFIED'
  | 'WORKFLOW_NOT_VERIFIED'
  | 'EMPLOYEE_NOT_MAPPED'
  | 'TOOL_NOT_MAPPED'
  | 'PROVIDER_NOT_MAPPED'
  | 'AI_CAPABILITY_NOT_MAPPED'
  | 'NODE_NOT_MAPPED'
  | 'HANDLER_NOT_MAPPED'
  | 'ACTIVE_AI_TURNS'
  | 'ACTIVE_WORKFLOW_RUNS'
  | 'UNQUEUED_PROCESS_RUNS'
  | 'INTERRUPTED_PROCESS_NODES'
  | 'WORKFLOW_PARAMETERS_NOT_MAPPED'
  | 'WORKFLOW_BRANCH_JOINS_NOT_MAPPED'
  | 'UNVERIFIED_SCHEDULE_USERS'
  | 'APPROVAL_TRANSFER_NOT_VERIFIED'
  | 'MISSING_FILES'
  | 'MISSING_SECRETS'
  | 'MISSING_ARTIFACTS'
  | 'UNMAPPED_RECORDS'
  | 'MISSING_MIGRATION_SOURCES'
  | 'MIGRATION_CHECKSUM_MISMATCH'
  | 'INVALID_WORKFLOW_COUNTS';

export interface PreflightFinding {
  code: PreflightCode;
  count: number;
}

export interface PreflightResult {
  ready: boolean;
  findings: PreflightFinding[];
}

/** Read-only cutover gate; reports codes and counts, never configuration values. */
export function checkUpgradeReadiness(
  input: unknown,
  replacement: ReplacementCapabilities,
): PreflightResult {
  const parsed = UpgradeInventorySchema.safeParse(input);
  if (!parsed.success)
    return {
      ready: false,
      findings: [{ code: 'INVALID_INVENTORY', count: 1 }],
    };
  const inventory = parsed.data;
  const findings: PreflightFinding[] = [];
  const add = (code: PreflightCode, value: number) => {
    if (value > 0) findings.push({ code, count: value });
  };
  const unmapped = (values: string[], supported: ReadonlySet<string>) =>
    new Set(values.filter((name) => !supported.has(name))).size;
  add('AI_NOT_VERIFIED', replacement.ai.verified ? 0 : 1);
  add('UNVERIFIED_AI_TOOL_PROFILES', inventory.ai.unverifiedToolProfiles);
  add('AI_AUTO_POLICY_DIFFERENCES', inventory.ai.autoPolicyDifferences);
  add('WORKFLOW_NOT_VERIFIED', replacement.workflows.verified ? 0 : 1);
  add(
    'EMPLOYEE_NOT_MAPPED',
    unmapped(inventory.ai.employees, replacement.ai.employees),
  );
  add('TOOL_NOT_MAPPED', unmapped(inventory.ai.tools, replacement.ai.tools));
  add(
    'PROVIDER_NOT_MAPPED',
    unmapped(inventory.ai.providers, replacement.ai.providers),
  );
  add(
    'AI_CAPABILITY_NOT_MAPPED',
    unmapped(inventory.ai.capabilities, replacement.ai.capabilities),
  );
  add(
    'NODE_NOT_MAPPED',
    unmapped(inventory.workflows.nodeTypes, replacement.workflows.nodeTypes),
  );
  add(
    'HANDLER_NOT_MAPPED',
    unmapped(
      inventory.workflows.customHandlers,
      replacement.workflows.customHandlers,
    ),
  );
  add('ACTIVE_AI_TURNS', inventory.ai.activeTurns);
  add('ACTIVE_WORKFLOW_RUNS', inventory.workflows.activeRuns);
  add('UNQUEUED_PROCESS_RUNS', inventory.workflows.unqueuedRuns);
  add('INTERRUPTED_PROCESS_NODES', inventory.workflows.interruptedNodes);
  add('WORKFLOW_PARAMETERS_NOT_MAPPED', inventory.workflows.unmappedParameters);
  add(
    'WORKFLOW_BRANCH_JOINS_NOT_MAPPED',
    inventory.workflows.unmappedBranchJoins,
  );
  add('UNVERIFIED_SCHEDULE_USERS', inventory.workflows.unverifiedScheduleUsers);
  add(
    'APPROVAL_TRANSFER_NOT_VERIFIED',
    replacement.ai.approvalTransferVerified ? 0 : inventory.ai.pendingApprovals,
  );
  add('MISSING_FILES', inventory.ai.missingFiles);
  add('MISSING_SECRETS', inventory.ai.missingSecrets);
  add('MISSING_ARTIFACTS', inventory.workflows.missingArtifacts);
  add(
    'UNMAPPED_RECORDS',
    inventory.ai.unmappedRecords + inventory.workflows.unmappedRecords,
  );
  add('MISSING_MIGRATION_SOURCES', inventory.history.missingSources);
  add('MIGRATION_CHECKSUM_MISMATCH', inventory.history.checksumMismatches);
  add(
    'INVALID_WORKFLOW_COUNTS',
    inventory.workflows.enabledDefinitions > inventory.workflows.definitions
      ? 1
      : 0,
  );
  return { ready: findings.length === 0, findings };
}
