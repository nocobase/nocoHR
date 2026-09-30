import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V3-08 能力体系, what the first framework tables left out:
 *
 * - `positions.jdFileId` / `jdFilename` / `jdText` / `jdStatus` / `jdError`:
 *   the uploaded 岗位说明书 (an `hrFiles` row), its extracted plain text and
 *   the extraction state (pending / ready / failed) shown on 岗位体系;
 * - `customFields` on `competencies`, `competencyLevels` and
 *   `positionRequirements`: the values of administrator-added fields
 *   (总纲 可定制约定), keyed by the definition's internal key;
 * - `developmentTargets`: 发展目标岗位 (拟任人员), a position an employee is
 *   prepared for without holding it. One active row per employee and target
 *   position is enforced by the service; the index serves that check.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610020001_extend_competency_framework',
  async up({ builder }) {
    await builder.alterCollection('positions', (c) => {
      c.string('jdFileId', { length: 64 }).nullable();
      c.string('jdFilename', { length: 255 }).nullable();
      c.text('jdText').nullable();
      c.string('jdStatus', { length: 16 }).nullable();
      c.string('jdError', { length: 64 }).nullable();
    });
    await builder.alterCollection('competencies', (c) => {
      c.json('customFields').nullable();
    });
    await builder.alterCollection('competencyLevels', (c) => {
      c.json('customFields').nullable();
    });
    await builder.alterCollection('positionRequirements', (c) => {
      c.json('customFields').nullable();
    });
    await builder.createCollection('developmentTargets', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('targetPositionId', { length: 64 }).notNull();
      c.string('reason', { length: 200 }).nullable();
      c.string('status', { length: 16 }).notNull();
      c.string('createdBy', { length: 64 }).notNull();
      c.datetime('achievedAt').nullable();
      c.datetime('cancelledAt').nullable();
      c.string('cancelledBy', { length: 64 }).nullable();
      c.string('decisionActionId', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['employeeId', 'targetPositionId', 'status']);
      c.index(['targetPositionId', 'status']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('developmentTargets');
    await builder.alterCollection('positionRequirements', (c) => {
      c.dropFields('customFields');
    });
    await builder.alterCollection('competencyLevels', (c) => {
      c.dropFields('customFields');
    });
    await builder.alterCollection('competencies', (c) => {
      c.dropFields('customFields');
    });
    await builder.alterCollection('positions', (c) => {
      c.dropFields('jdError');
      c.dropFields('jdStatus');
      c.dropFields('jdText');
      c.dropFields('jdFilename');
      c.dropFields('jdFileId');
    });
  },
});

export default migration;
