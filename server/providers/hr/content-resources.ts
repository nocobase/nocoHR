/**
 * The permission model of content maintenance and exam enhancements (V2 step
 * 6): revision suggestions, conflicts between documents, external
 * certificates, the examiner AI employee, and the sterilizer log demo page an
 * external certificate unlocks. The document, exam and certificate actions it
 * extends live beside their V1 composites.
 */
import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

import {
  automationRunItemsRead,
  automationRunsRead,
  automationSettingsWrite,
} from './automation-resources.js';
import { CERTIFICATE_FIELDS } from './exam-resources.js';
import { label } from './shared.js';

export const CONTENT_REVISION_FIELDS = [
  'id',
  'documentId',
  'reason',
  'targetType',
  'targetId',
  'courseId',
  'ownerUserId',
  'sectionTitle',
  'currentSnapshot',
  'proposed',
  'accepted',
  'explanation',
  'status',
  'reviewedBy',
  'reviewedAt',
  'rejectReason',
  'source',
  'createdAt',
  'updatedAt',
] as const;
export const DOCUMENT_CONFLICT_FIELDS = [
  'id',
  'documentId',
  'sectionTitle',
  'otherDocumentId',
  'otherSectionTitle',
  'description',
  'excerpt',
  'otherExcerpt',
  'source',
  'status',
  'handledBy',
  'handledAt',
  'resolutionNote',
  'createdAt',
  'updatedAt',
] as const;

const read = (collection: string, fields: readonly string[]) =>
  defineDatabasePermission((p) =>
    p
      .collection(collection)
      .title(label(`collections.${collection}`))
      .read([...fields]),
  );

const revisionRead = read('contentRevisions', CONTENT_REVISION_FIELDS);
const revisionDecide = revisionRead.update([
  'accepted',
  'status',
  'reviewedBy',
  'reviewedAt',
  'rejectReason',
  'updatedAt',
]);

/** Revision suggestions; the scope of every action is the content's owner (the instructor), or all for HR. */
export const revisionResource = defineCompositeResource(
  'talent.revision',
  (r) =>
    r
      .title(label('authz.revision.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('contentRevisions', revisionRead),
      )
      .action('accept', (a) =>
        a
          .title(label('authz.revision.accept'))
          .grant('contentRevisions', revisionDecide),
      )
      .action('reject', (a) =>
        a
          .title(label('authz.revision.reject'))
          .grant('contentRevisions', revisionDecide),
      )
      .action('apply', (a) =>
        a
          .title(label('authz.revision.apply'))
          .grant('contentRevisions', revisionDecide),
      ),
);

const conflictRead = read('documentConflicts', DOCUMENT_CONFLICT_FIELDS);
export const documentConflictResource = defineCompositeResource(
  'talent.documentConflict',
  (r) =>
    r
      .title(label('authz.documentConflict.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('documentConflicts', conflictRead),
      )
      .action('resolve', (a) =>
        a
          .title(label('authz.documentConflict.resolve'))
          .grant(
            'documentConflicts',
            conflictRead.update([
              'status',
              'handledBy',
              'handledAt',
              'resolutionNote',
              'updatedAt',
            ]),
          ),
      )
      .action('ignore', (a) =>
        a
          .title(label('authz.documentConflict.ignore'))
          .grant(
            'documentConflicts',
            conflictRead.update([
              'status',
              'handledBy',
              'handledAt',
              'resolutionNote',
              'updatedAt',
            ]),
          ),
      ),
);

const certificateRead = read('employeeCertificates', CERTIFICATE_FIELDS);
/** register: oneself (employees) or anyone (HR); verify: HR only, never one's own certificate. */
export const externalCertificateResource = defineCompositeResource(
  'talent.externalCertificate',
  (r) =>
    r
      .title(label('authz.externalCertificate.title'))
      .action('register', (a) =>
        a
          .title(label('authz.externalCertificate.register'))
          .grant(
            'employeeCertificates',
            certificateRead
              .create([...CERTIFICATE_FIELDS])
              .update([...CERTIFICATE_FIELDS]),
          )
          .grant(
            'employees',
            read('employees', [
              'id',
              'name',
              'userId',
              'departmentId',
              'status',
            ]),
          ),
      )
      .action('verify', (a) =>
        a
          .title(label('authz.externalCertificate.verify'))
          .grant(
            'employeeCertificates',
            certificateRead.update([
              'status',
              'verifyStatus',
              'verifiedBy',
              'verifiedAt',
              'verifyNote',
              'updatedAt',
            ]),
          ),
      ),
);

export const examinerResource = defineCompositeResource(
  'talent.examiner',
  (r) =>
    r
      .title(label('authz.examiner.title'))
      .action('use', (a) =>
        a
          .title(label('authz.examiner.use'))
          .grant(
            'examAttempts',
            read('examAttempts', ['id', 'examId', 'employeeId', 'status']),
          ),
      )
      .action('configure', (a) =>
        a
          .title(label('authz.actions.configure'))
          .grant('aiAutomationSettings', automationSettingsWrite)
          .grant('aiTaskRuns', automationRunsRead)
          .grant('aiTaskRunItems', automationRunItemsRead),
      ),
);

const SIGNOFF_FIELDS = [
  'id',
  'batchNo',
  'step',
  'employeeId',
  'userId',
  'signedAt',
  'certificateId',
  'certificateNo',
  'certificateStatus',
  'createdAt',
  'updatedAt',
] as const;

/** 灭菌柜操作登记（演示）: held through the external pressure-vessel certificate (equip.sterilizerOperator). */
export const demoSterilizerResource = defineCompositeResource(
  'demo.sterilizer',
  (r) =>
    r
      .title(label('authz.demoSterilizer.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant(
            'demoBatchSignoffs',
            read('demoBatchSignoffs', SIGNOFF_FIELDS),
          ),
      )
      .action('log', (a) =>
        a
          .title(label('authz.demoSterilizer.log'))
          .grant('employees', read('employees', ['id', 'name', 'userId']))
          .grant(
            'demoBatchSignoffs',
            read('demoBatchSignoffs', SIGNOFF_FIELDS).create([
              ...SIGNOFF_FIELDS,
            ]),
          ),
      ),
);

export const CONTENT_COLLECTIONS: readonly { name: string; title: string }[] = [
  { name: 'contentRevisions', title: 'collections.contentRevisions' },
  { name: 'documentConflicts', title: 'collections.documentConflicts' },
];

export const CONTENT_COMPOSITES = [
  revisionResource,
  documentConflictResource,
  externalCertificateResource,
  examinerResource,
  demoSterilizerResource,
] as const;

/** Collections an instructor owns: revisions through `ownerUserId`, conflicts through either document's owner. */
export const CONTENT_OWNED_COLLECTIONS = [
  'contentRevisions',
  'documentConflicts',
] as const;
