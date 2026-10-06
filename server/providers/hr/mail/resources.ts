import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';
import { defineCompositeResource } from '@nocobase/authorization/core';

import { label } from '../shared.js';
import type { MailPurpose } from './types.js';

/**
 * 邮件往来 permissions (V2-06 talent.mail, 按邮箱用途授权): one composite per
 * mailbox purpose, each with
 *
 * - `view`: read the mailbox's mail (a step may narrow it message by message,
 *   e.g. payroll in the 人事邮箱, recruiters in the 招聘邮箱);
 * - `send`: send the drafts of mail one may see;
 * - `assign`: sort the unsorted mail (link, ignore, recognise again), and in
 *   the 人事邮箱 see all of it.
 *
 * The page resource `talent.mail` only shows the menu entry. The mail service
 * reads its table directly; the data grant names it for the permission UI.
 */
const MAIL_FIELDS = [
  'id',
  'mailbox',
  'direction',
  'status',
  'threadKey',
  'fromAddress',
  'fromName',
  'toAddresses',
  'subject',
  'bodyText',
  'refType',
  'refId',
  'aiIntent',
  'aiSummary',
  'sentAt',
  'receivedAt',
  'createdAt',
] as const;

const mailRead = defineDatabasePermission((p) =>
  p
    .collection('businessMailMessages')
    .title(label('collections.businessMailMessages'))
    .read([...MAIL_FIELDS]),
);

function mailResource(id: string, title: string) {
  return defineCompositeResource(id, (r) =>
    r
      .title(label(title))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('businessMailMessages', mailRead),
      )
      .action('send', (a) =>
        a
          .title(label('authz.mail.send'))
          .grant('businessMailMessages', mailRead),
      )
      .action('assign', (a) =>
        a
          .title(label('authz.mail.assign'))
          .grant('businessMailMessages', mailRead),
      ),
  );
}

export const mailBillingResource = mailResource(
  'talent.mailBilling',
  'authz.mail.billing',
);
export const mailRecruitingResource = mailResource(
  'talent.mailRecruiting',
  'authz.mail.recruiting',
);
export const mailAuditResource = mailResource(
  'talent.mailAudit',
  'authz.mail.audit',
);
export const mailHrResource = mailResource('talent.mailHr', 'authz.mail.hr');

/** The composite that authorizes each mailbox purpose. */
export const MAIL_RESOURCE: Record<MailPurpose, string> = {
  billing: 'talent.mailBilling',
  recruiting: 'talent.mailRecruiting',
  audit: 'talent.mailAudit',
  hr: 'talent.mailHr',
};

export const MAIL_COMPOSITES = [
  mailBillingResource,
  mailRecruitingResource,
  mailAuditResource,
  mailHrResource,
] as const;
