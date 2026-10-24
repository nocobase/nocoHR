import type { Application } from '@nocobase/app-server/application';
import { ServiceProvider } from '@nocobase/service-provider';
import { schedulerServiceToken } from '@nocobase/app-plugin-scheduler/server/tokens';

/** Register only in an isolated probe copy, never in application composition. */
export default class MailDependencyProbeProvider extends ServiceProvider<Application> {
  readonly name = 'test.mail-dependency-probe';

  override async boot(): Promise<void> {
    this.app.container.resolve(schedulerServiceToken).defineSchedule({
      key: 'test.mail-dependency-probe',
      title: 'Controlled mail dependency probe',
      schedule: {
        cron: '* * * * * *',
        from: new Date(Date.now() + 5_000),
        limit: 1,
      },
      target: { type: 'app.hr-mail-poll', config: {} },
    });
  }
}
