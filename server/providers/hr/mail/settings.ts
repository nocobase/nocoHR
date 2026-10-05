/**
 * 设置 / 邮件 (V2-06): what the business mailboxes are used for. Stored as the
 * `mail` row of personnelSettings with a revision, like the 人事设置 sections;
 * connection details and passwords are in the application configuration
 * (server/config/mail.ts), never here.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import type { ActorContext } from '../framework-service.js';
import { PERSONNEL_SETTINGS_AUTH } from '../personnel-settings.js';
import { HrError } from '../shared.js';
import { MAIL_PURPOSES, type MailPurpose } from './types.js';

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9.-]+\.[a-z0-9-]+$/u)
  .max(253);

const mailboxSchema = z
  .object({
    enabled: z.boolean(),
    /** Empty: any sender; otherwise mail from other domains goes to 待归类 without being recognised. */
    allowedSenderDomains: z.array(domain).max(50),
    /** Days an unlinked message keeps its body and attachments. */
    retentionDays: z.number().int().min(7).max(3650),
    /** billing: which 派遣公司 a sender domain belongs to. */
    vendors: z
      .array(
        z
          .object({ domain, vendorName: z.string().trim().min(1).max(100) })
          .strict(),
      )
      .max(50),
  })
  .strict();

export const mailSettingsSchema = z
  .object({
    /** The notification plugin's email channel used for sending. */
    channel: z.string().trim().max(100),
    senderName: z.string().trim().max(100),
    /** Outside production every message goes to this address instead, when set. */
    redirectTo: z.union([z.literal(''), z.string().trim().email().max(320)]),
    pollMinutes: z.number().int().min(1).max(1440),
    allowedAttachmentTypes: z
      .array(
        z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9]{1,10}$/u),
      )
      .min(1)
      .max(30),
    maxAttachmentMb: z.number().int().min(1).max(50),
    mailboxes: z
      .object(
        Object.fromEntries(MAIL_PURPOSES.map((p) => [p, mailboxSchema])) as {
          [K in MailPurpose]: typeof mailboxSchema;
        },
      )
      .strict(),
  })
  .strict();

export type MailSettings = z.infer<typeof mailSettingsSchema>;

const mailboxDefault = {
  enabled: true,
  allowedSenderDomains: [],
  retentionDays: 90,
  vendors: [],
};

export const MAIL_SETTINGS_DEFAULTS: MailSettings = {
  channel: 'system-email',
  senderName: '启衡精密人力资源部',
  redirectTo: '',
  pollMinutes: 5,
  allowedAttachmentTypes: ['xlsx', 'xls', 'csv', 'pdf', 'jpg', 'png', 'docx'],
  maxAttachmentMb: 20,
  mailboxes: {
    billing: mailboxDefault,
    recruiting: mailboxDefault,
    audit: mailboxDefault,
    hr: mailboxDefault,
  },
};

const ROW_ID = 'mail';

export function createMailSettingsService(database: DatabaseManager) {
  async function read(): Promise<{ value: MailSettings; revision: number }> {
    const row = await database
      .repository('personnelSettings')
      .findOne({ filter: { id: ROW_ID } });
    const parsed = mailSettingsSchema.safeParse(row?.value);
    return {
      value: parsed.success ? parsed.data : MAIL_SETTINGS_DEFAULTS,
      revision: Number(row?.revision ?? 0),
    };
  }
  return {
    read,
    async get(ctx: ActorContext) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      return read();
    },
    async update(ctx: ActorContext, input: unknown) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      const body = z
        .object({
          revision: z.number().int().min(0),
          value: mailSettingsSchema,
        })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT');
      return database.transaction(async (connection) => {
        const repo = connection.repository('personnelSettings');
        const previous = await repo.findOne({ filter: { id: ROW_ID } });
        const revision = Number(previous?.revision ?? 0);
        if (revision !== body.data.revision)
          throw new HrError('SETTINGS_CONFLICT', 409);
        const stamp = new Date();
        if (previous)
          await repo.updateOne({
            filter: { id: ROW_ID, revision },
            values: {
              value: body.data.value,
              revision: revision + 1,
              updatedBy: ctx.userId,
              updatedAt: stamp,
            },
          });
        else
          await repo.createOne({
            values: {
              id: ROW_ID,
              value: body.data.value,
              revision: 1,
              updatedBy: ctx.userId,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
        return { value: body.data.value, revision: revision + 1 };
      });
    },
  };
}

export type MailSettingsService = ReturnType<typeof createMailSettingsService>;
