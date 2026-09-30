import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V4-14 行业方案 · 持证上岗. The 总纲 allows no new business table for this
 * step, only fields:
 *
 * - `shifts.requiredCertificationIds`: the certifications someone scheduled
 *   onto the shift must hold (valid or expiring through the shift's end);
 *   null or empty means none. Maintained separately from the shift
 *   definition (`talent.shift` · manageRequiredCertifications), so a shift
 *   already in use can gain or lose a requirement.
 * - `demoBatchSignoffs.kind` / `machineNo`: the demonstration start log
 *   (the specification's demoStartLogs, which keeps the table name of the
 *   earlier batch record demo) records a 设备开工 (`machineStart`, the
 *   default for older rows) or a 叉车出库 (`forkliftDispatch`) with the
 *   machine or forklift number.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610120001_licensed_operation',
  async up({ builder }) {
    await builder.alterCollection('shifts', (c) => {
      c.json('requiredCertificationIds').nullable();
    });
    await builder.alterCollection('demoBatchSignoffs', (c) => {
      // machineStart | forkliftDispatch
      c.string('kind', { length: 32 }).nullable();
      c.string('machineNo', { length: 32 }).nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('demoBatchSignoffs', (c) => {
      c.dropFields('kind', 'machineNo');
    });
    await builder.alterCollection('shifts', (c) => {
      c.dropFields('requiredCertificationIds');
    });
  },
});

export default migration;
