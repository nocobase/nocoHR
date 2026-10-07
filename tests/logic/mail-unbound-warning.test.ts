import { describe, expect, it } from 'vitest';

import { createMailService } from '../../server/providers/hr/mail/service.ts';
import {
  MAIL_SETTINGS_DEFAULTS,
  type MailSettings,
} from '../../server/providers/hr/mail/settings.ts';
import { MAIL_PURPOSES } from '../../server/providers/hr/mail/types.ts';

// An installation without mail logged “Mailbox has no Mail account bound” for each of its four mailboxes on every
// five-minute poll; it is reported once per mailbox per process.
describe('an unbound mailbox', () => {
  it('is reported once per mailbox, not on every poll', async () => {
    const mailboxes = Object.fromEntries(
      MAIL_PURPOSES.map((purpose) => [
        purpose,
        { ...MAIL_SETTINGS_DEFAULTS.mailboxes[purpose], enabled: true },
      ]),
    ) as MailSettings['mailboxes'];
    const value: MailSettings = { ...MAIL_SETTINGS_DEFAULTS, mailboxes };
    const logged: string[] = [];
    const deps = {
      settings: {
        read: async () => ({ value, revision: 1, updatedBy: null }),
      },
      localProvider: null,
      production: true,
      log: (fields: Record<string, unknown>, message: string) =>
        logged.push(`${String(fields.purpose)}: ${message}`),
    };
    const service = createMailService(
      deps as unknown as Parameters<typeof createMailService>[0],
    );
    for (const purpose of MAIL_PURPOSES)
      service.registerHandler(
        purpose,
        {} as Parameters<typeof service.registerHandler>[1],
      );
    await service.poll();
    await service.poll();
    await service.poll();
    expect(logged).toEqual(
      MAIL_PURPOSES.map(
        (purpose) => `${purpose}: Mailbox has no Mail account bound`,
      ),
    );
  });
});
