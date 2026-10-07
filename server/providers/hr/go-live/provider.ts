/**
 * 上线准备 (go-live checklist and bulk account activation), kept in its own
 * provider beside HrProvider so the go-live work does not grow that file. It
 * runs after HrProvider (server/providers/index.ts) and only resolves the
 * talent platform's services.
 */
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { i18nToken } from '@nocobase/app-server/i18n';
import { databaseManagerToken } from '@nocobase/db';
import {
  createServiceToken,
  ServiceProvider,
  type ServiceToken,
} from '@nocobase/service-provider';

import { HR_NS } from '../shared.js';
import {
  imChannelToken,
  mailServiceToken,
  mailSettingsToken,
  organizationServiceToken,
  platformToken,
  talentServiceToken,
} from '../tokens.js';
import {
  createAccountActivation,
  type AccountActivationService,
} from './activation.js';
import { goLiveResource } from './resources.js';
import { createGoLiveSettings, type GoLiveSettingsStore } from './settings.js';
import { createGoLiveStatus, type GoLiveStatusService } from './status.js';

export const goLiveSettingsToken: ServiceToken<GoLiveSettingsStore> =
  createServiceToken<GoLiveSettingsStore>('hr/go-live-settings');
export const goLiveStatusToken: ServiceToken<GoLiveStatusService> =
  createServiceToken<GoLiveStatusService>('hr/go-live-status');
export const accountActivationToken: ServiceToken<AccountActivationService> =
  createServiceToken<AccountActivationService>('hr/account-activation');

export default class GoLiveProvider extends ServiceProvider<Application> {
  public readonly name: string = 'hr/go-live';

  public override register(): void {
    const container = this.app.container;
    container.singleton(goLiveSettingsToken, () =>
      createGoLiveSettings(container.resolve(databaseManagerToken)),
    );
    container.singleton(goLiveStatusToken, () =>
      createGoLiveStatus({
        database: container.resolve(databaseManagerToken),
        settings: container.resolve(goLiveSettingsToken),
        config: () => this.configFacts(),
        mailConfigured: async () => {
          const settings = (await container.resolve(mailSettingsToken).read())
            .value;
          return Object.values(settings.mailboxes).some(
            (mailbox) => mailbox.enabled && Boolean(mailbox.accountId),
          );
        },
        currentDate: () => container.resolve(platformToken).currentDate(),
      }),
    );
    container.singleton(accountActivationToken, () =>
      createAccountActivation({
        database: container.resolve(databaseManagerToken),
        users: () => container.resolve(userAdministrationServiceToken),
        talent: () => container.resolve(talentServiceToken),
        organization: () => container.resolve(organizationServiceToken),
        im: () => container.resolve(imChannelToken),
        mail: () => container.resolve(mailServiceToken),
        settings: container.resolve(goLiveSettingsToken),
        publicUrl: (path) => this.link(this.publicOrigin(), path),
        feishuUrl: (path) =>
          this.link(
            this.feishu().linkOrigin || this.publicOrigin(),
            path,
            this.feishu().configured,
          ),
        companyName: () =>
          String(
            this.app.config.get<{ companyName?: string }>('talent')
              ?.companyName ?? '',
          ),
        translate: async () => {
          const i18n = container.resolve(i18nToken);
          const locale = i18n.getDefaultLocale();
          await i18n.ensureLocaleLoaded(locale);
          return i18n.getFixedT(HR_NS, locale);
        },
        passwordLength: () => {
          const options = this.app.config.get<{
            emailAndPassword?: {
              minPasswordLength?: number;
              maxPasswordLength?: number;
            };
          }>('auth')?.emailAndPassword;
          return {
            min: options?.minPasswordLength ?? 8,
            max: options?.maxPasswordLength ?? 128,
          };
        },
        now: () => new Date(),
      }),
    );
  }

  public override async boot(): Promise<void> {
    const authz = this.app.container.resolve(authorizationToken);
    const reference = authz.compositeResources.define(goLiveResource.build());
    authz.ui.place(reference, { section: 'talent', group: 'talent.hrCore' });
  }

  private publicOrigin(): string {
    return String(
      this.app.config.get<{ publicOrigin?: string }>('app')?.publicOrigin ?? '',
    );
  }

  private feishu(): { configured: boolean; linkOrigin: string } {
    const raw =
      this.app.config.get<{
        appId?: string;
        appSecret?: string;
        linkOrigin?: string;
      }>('feishu') ?? {};
    return {
      configured: Boolean(raw.appId && raw.appSecret),
      linkOrigin: raw.linkOrigin ?? '',
    };
  }

  /** Like HrProvider's Feishu links: outside production an unset origin falls back to the local server. */
  private link(origin: string, path: string, localFallback = true): string {
    const port = this.app.config.get<{ port?: number }>('server')?.port;
    const base =
      origin ||
      (localFallback && process.env.NODE_ENV !== 'production' && port
        ? `http://localhost:${port}`
        : '');
    return `${base.replace(/\/$/u, '')}${this.app.publicBasePath.replace(/\/$/u, '')}${path}`;
  }

  /** Booleans only: the go-live page never sees a configured value. */
  private configFacts() {
    const llm =
      this.app.config.get<{ llmServices?: Record<string, unknown> }>('ai')
        ?.llmServices ?? {};
    return {
      companyName: Boolean(
        String(
          this.app.config.get<{ companyName?: string }>('talent')
            ?.companyName ?? '',
        ).trim(),
      ),
      publicOrigin: Boolean(this.publicOrigin()),
      feishu: this.feishu().configured,
      ai: Object.keys(llm).length > 0,
    };
  }
}
