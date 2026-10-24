import { randomUUID } from 'node:crypto';

import type { DatabaseConnection } from '@nocobase/db';

import { capabilityRecordDigest } from './digest.js';

export interface MigrationIdentity {
  sourcePackage: string;
  sourceVersion: string;
  sourceCollection: string;
  sourceKey: string;
  targetCollection: string;
  targetKey: string;
}

/** The copy and its ledger entry share a transaction. A replay cannot overwrite new runtime state. */
export async function copyCapabilityRecord(
  connection: DatabaseConnection,
  identity: MigrationIdentity,
  source: unknown,
  copy: (transaction: DatabaseConnection) => Promise<void>,
): Promise<'copied' | 'unchanged'> {
  const sourceDigest = capabilityRecordDigest(source);
  return connection.transaction(async (transaction) => {
    const ledger = transaction.repository('capabilityMigrationLedger');
    const filter = {
      sourcePackage: identity.sourcePackage,
      sourceCollection: identity.sourceCollection,
      sourceKey: identity.sourceKey,
    };
    const previous = await ledger.findOne({ filter });
    if (previous) {
      if (
        previous.sourceDigest !== sourceDigest ||
        previous.sourceVersion !== identity.sourceVersion ||
        previous.targetCollection !== identity.targetCollection ||
        previous.targetKey !== identity.targetKey ||
        previous.formatVersion !== 1
      )
        throw new Error('CAPABILITY_MIGRATION_CONFLICT');
      const target = await transaction
        .repository(identity.targetCollection)
        .findOne({ filter: { id: identity.targetKey } });
      if (!target) throw new Error('CAPABILITY_MIGRATION_TARGET_MISSING');
      return 'unchanged';
    }
    await copy(transaction);
    const target = await transaction
      .repository(identity.targetCollection)
      .findOne({ filter: { id: identity.targetKey } });
    if (!target) throw new Error('CAPABILITY_MIGRATION_TARGET_MISSING');
    await ledger.createOne({
      values: {
        id: randomUUID(),
        ...identity,
        formatVersion: 1,
        sourceDigest,
        createdAt: new Date(),
      },
    });
    return 'copied';
  });
}
