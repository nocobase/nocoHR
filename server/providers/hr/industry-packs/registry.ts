/**
 * The industry content packs this application ships (types.ts explains what a
 * pack brings and how to add one). Lookups are by pack key, operation kind,
 * page resource id and permission set key.
 */
import { manufacturingPack } from './manufacturing.js';
import type { CertifiedOperation, IndustryPackDefinition } from './types.js';

export const INDUSTRY_PACKS: readonly IndustryPackDefinition[] = [
  manufacturingPack,
];

export interface PackOperation extends CertifiedOperation {
  readonly pack: string;
}

const OPERATIONS: readonly PackOperation[] = INDUSTRY_PACKS.flatMap((pack) =>
  pack.operations.map((operation) => ({ ...operation, pack: pack.key })),
);

export function packByKey(key: string): IndustryPackDefinition | undefined {
  return INDUSTRY_PACKS.find((pack) => pack.key === key);
}

export function allOperations(): readonly PackOperation[] {
  return OPERATIONS;
}

export function operationByKind(kind: string): PackOperation | undefined {
  return OPERATIONS.find((operation) => operation.kind === kind);
}

export function operationByPage(page: string): PackOperation | undefined {
  return OPERATIONS.find((operation) => operation.page === page);
}

export function operationsByPermissionSet(
  key: string,
): readonly PackOperation[] {
  return OPERATIONS.filter((operation) => operation.permissionSet === key);
}

export function operationByResource(
  resource: string,
): PackOperation | undefined {
  return OPERATIONS.find((operation) => operation.resource === resource);
}
