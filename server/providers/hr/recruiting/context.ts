/**
 * What every recruiting service receives: the platform helpers, lazily
 * resolved neighbours (core HR, payroll, custom fields, knowledge, the
 * office-suite channel, the automation service), the settings, candidate
 * email, file storage and a few questions about the caller.
 *
 * The provider (server/providers/hr/index.ts, V2-07 block) builds it once
 * with the container; nothing here runs at import time.
 */
import { notificationServiceToken } from '@nocobase/app-plugin-notification';
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { i18nToken } from '@nocobase/app-server/i18n';
import { loggingToken } from '@nocobase/app-server/logging';
import type { ServiceContainer } from '@nocobase/service-provider';

import type { AIRunner } from '../ai-runner.js';
import { tryAuthorizeAction } from '../authorize.js';
import { HR_ADMIN_SETTINGS } from '../core-service.js';
import type { ActorContext } from '../framework-service.js';
import type { Platform } from '../platform.js';
import { newId, str } from '../shared.js';
import {
  automationServiceToken,
  customFieldServiceToken,
  hrCoreServiceToken,
  imChannelToken,
  knowledgeServiceToken,
  mailServiceToken,
  payrollServicesToken,
} from '../tokens.js';
import { readRecruitingSettings, type RecruitingSettings } from './config.js';

export type Translate = (
  key: string,
  values?: Record<string, unknown>,
) => string;

export interface RecruitingDeps {
  readonly container: ServiceContainer;
  readonly platform: Platform;
  readonly ai: AIRunner;
  /** Runs work after the request answers; failures are logged, never thrown. */
  readonly background: (label: string, run: () => Promise<unknown>) => void;
  readonly production: boolean;
  /** An application path with the deployment base path, for links in emails and bot messages. */
  readonly publicUrl: (path: string) => string;
  /** The employer's name for offer letters (config.talent.companyName). */
  readonly companyName: () => string;
}

export function createRecruitingContext(deps: RecruitingDeps) {
  const { container, platform } = deps;
  const { database } = platform;
  const titles = new Map<string, string>();

  async function translate(): Promise<Translate> {
    const i18n = container.resolve(i18nToken);
    const locale = i18n.getDefaultLocale();
    await i18n.ensureLocaleLoaded(locale);
    const t = i18n.getFixedT('hr', locale);
    return (key, values) => String(t(key, values));
  }

  const ctx = {
    ...deps,
    database,
    core: () => container.resolve(hrCoreServiceToken),
    payroll: () => container.resolve(payrollServicesToken),
    customFields: () => container.resolve(customFieldServiceToken),
    knowledge: () => container.resolve(knowledgeServiceToken),
    im: () => container.resolve(imChannelToken),
    automation: () => container.resolve(automationServiceToken),
    drive: () => container.resolve(driveManagerToken),
    users: () => container.resolve(userAdministrationServiceToken),
    authentication: () => container.resolve(authenticationToken),
    translate,
    settings: async (): Promise<RecruitingSettings> =>
      (await readRecruitingSettings(database)).value,
    today: () => platform.currentDate(),

    log(detail: Record<string, unknown>, message: string) {
      container.resolve(loggingToken).getLogger('hr').warn(detail, message);
    },
    audit(event: Record<string, unknown>) {
      container
        .resolve(loggingToken)
        .getLogger('hr-audit')
        .info(event, 'HR audit');
    },

    async can(actor: ActorContext, resource: string, action: string) {
      return Boolean(await tryAuthorizeAction(actor.authz, resource, action));
    },

    isHrAdmin(actor: ActorContext) {
      return actor.authz.can({
        resource: { type: 'settings', id: HR_ADMIN_SETTINGS },
        action: 'administer',
      });
    },

    holdersOf: (setKey: string) =>
      container.resolve(hrCoreServiceToken).holdersOf(setKey),
    hrAdministrators: () =>
      container.resolve(hrCoreServiceToken).hrAdministrators(),

    /** The owner of an automation (设置 / AI 员工任务), or null when unset. */
    async ownerOf(key: string): Promise<string | null> {
      const row = await database
        .query()
        .selectFrom('aiAutomationSettings')
        .select(['ownerUserId', 'enabled'])
        .where('id', '=', key)
        .executeTakeFirst();
      return row?.ownerUserId ? str(row.ownerUserId) : null;
    },

    async departmentTitle(id: string | null | undefined): Promise<string> {
      if (!id) return '';
      const cached = titles.get(`d:${id}`);
      if (cached !== undefined) return cached;
      const department = await platform.organization.getDepartment(id);
      const title = department
        ? platform.organization.titleText(department.title)
        : id;
      titles.set(`d:${id}`, title);
      return title;
    },

    async position(id: string | null | undefined) {
      if (!id) return undefined;
      const row = await database
        .query()
        .selectFrom('positions')
        .select([
          'id',
          'title',
          'grade',
          'jobFamilyId',
          'responsibilities',
          'active',
        ])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) return undefined;
      let family: string | null = null;
      if (row.jobFamilyId) {
        const f = await database
          .query()
          .selectFrom('jobFamilies')
          .select(['title'])
          .where('id', '=', str(row.jobFamilyId))
          .executeTakeFirst();
        family = f ? str(f.title) : null;
      }
      return {
        id: str(row.id),
        title: str(row.title),
        grade: row.grade ? str(row.grade) : null,
        jobFamily: family,
        responsibilities: row.responsibilities
          ? str(row.responsibilities)
          : null,
      };
    },

    async headOfDepartment(departmentId: string): Promise<string | null> {
      const head = await platform.organization.resolveHead(departmentId);
      return head?.userId ?? null;
    },

    /**
     * Sends one candidate email through the configured notification channel
     * (设置 / 招聘设置 · 邮件). Outside production a test mailbox may take
     * every message instead. Answers the delivery state; a channel that is
     * not configured is `channelNotConfigured`, recorded on the message.
     */
    async sendEmail(input: {
      key: string;
      to: string;
      subject: string;
      body: string;
      /** The application the mail is about: its thread in the 招聘邮箱, so a candidate's reply comes back to it. */
      applicationId?: string | null;
    }): Promise<'sent' | 'channelNotConfigured' | 'failed'> {
      const settings = (await readRecruitingSettings(database)).value;
      // V2-07: through the 招聘邮箱 when it is on, with the thread's reply address.
      if (container.has(mailServiceToken)) {
        const viaMail = await container.resolve(mailServiceToken).sendDirect({
          purpose: 'recruiting',
          idempotencyKey: `recruiting:${input.key}`,
          to: input.to,
          subject: input.subject,
          text: input.body,
          refType: input.applicationId ? 'application' : null,
          refId: input.applicationId ?? null,
          channel: settings.email.channel,
          redirectTo: settings.email.redirectTo ?? undefined,
        });
        if (viaMail) return viaMail;
      }
      const to =
        !deps.production && settings.email.redirectTo
          ? settings.email.redirectTo
          : input.to;
      if (!container.has(notificationServiceToken))
        return 'channelNotConfigured';
      try {
        await container.resolve(notificationServiceToken).send({
          idempotencyKey: `hr:recruiting:${input.key}`,
          source: { type: 'hr.recruiting', referenceId: input.key },
          messages: {
            [settings.email.channel]: {
              to,
              subject: input.subject,
              text: input.body,
            },
          },
        });
        return 'sent';
      } catch (error) {
        const code = str(
          (error as { code?: unknown }).code ??
            (error as Error).message ??
            'failed',
        );
        if (/CHANNEL|UNKNOWN|DISABLED|NOT_FOUND/iu.test(code))
          return 'channelNotConfigured';
        ctx.log({ error, key: input.key }, 'Recruiting email failed');
        return 'failed';
      }
    },

    /** Stores an upload in the default drive and the file collection; answers its id. */
    async storeFile(file: {
      name: string;
      bytes: Uint8Array;
      mimeType: string;
      folder: string;
    }): Promise<string> {
      const id = newId();
      const safe = file.name.replace(/[^\w.\-一-龥]/gu, '_').slice(-120);
      const ext = safe.includes('.')
        ? safe
            .split('.')
            .pop()!
            .replace(/[^A-Za-z0-9]/gu, '')
            .slice(0, 16)
        : '';
      // The storage key stays ASCII (the drive refuses other characters); the original name is kept in the row.
      const key = `recruiting/${file.folder}/${new Date().toISOString().slice(0, 7)}/${id}${ext ? `.${ext}` : ''}`;
      await container
        .resolve(driveManagerToken)
        .use('local')
        .put(key, file.bytes);
      const now = new Date();
      await database
        .query()
        .insertInto('hrFiles')
        .values({
          id,
          disk: 'local',
          key,
          filename: safe,
          ext,
          mimeType: file.mimeType,
          size: file.bytes.byteLength,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return id;
    },

    async readFile(
      fileId: string,
    ): Promise<
      { bytes: Uint8Array; filename: string; mimeType: string } | undefined
    > {
      const row = await database
        .query()
        .selectFrom('hrFiles')
        .select(['disk', 'key', 'filename', 'mimeType'])
        .where('id', '=', fileId)
        .executeTakeFirst();
      if (!row) return undefined;
      const disk = container.resolve(driveManagerToken).use(str(row.disk));
      const bytes = await disk.getBytes(str(row.key));
      return {
        bytes,
        filename: str(row.filename),
        mimeType: str(row.mimeType ?? 'application/octet-stream'),
      };
    },

    async removeFile(fileId: string): Promise<void> {
      const row = await database
        .query()
        .selectFrom('hrFiles')
        .select(['disk', 'key'])
        .where('id', '=', fileId)
        .executeTakeFirst();
      if (!row) return;
      await container
        .resolve(driveManagerToken)
        .use(str(row.disk))
        .delete(str(row.key))
        .catch(() => undefined);
      await database
        .query()
        .deleteFrom('hrFiles')
        .where('id', '=', fileId)
        .execute()
        .catch(() => undefined);
    },
  };
  return ctx;
}

export type RecruitingContext = ReturnType<typeof createRecruitingContext>;
