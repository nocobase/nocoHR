import { describe, expect, it, vi } from 'vitest';
import type { AutomationRunContext } from '../../server/providers/hr/automation.ts';
import { createMailService } from '../../server/providers/hr/mail/service.ts';
import { MAIL_SETTINGS_DEFAULTS } from '../../server/providers/hr/mail/settings.ts';
import { MAIL_PURPOSES } from '../../server/providers/hr/mail/types.ts';
import {
  MailPollError,
  runMailTask,
} from '../../server/providers/hr/mail/task-result.ts';
import { createBillingMailHandler } from '../../server/providers/hr/mail/billing.ts';
import { createAuditMail } from '../../server/providers/hr/mail/audit.ts';
import { createRecruitingMailHandler } from '../../server/providers/hr/mail/recruiting.ts';
import type { MailMessage } from '../../server/providers/hr/mail/types.ts';

const options = { dedupeKey: 'message', triggerRef: { mailId: 'message' } };
describe('mail automation failure propagation', () => {
  it('retains the original rejection after automation records failure', async () => {
    const original = new Error('original controlled failure');
    const run: Parameters<typeof runMailTask>[0] = async (
      _key,
      _options,
      work,
    ) => {
      try {
        await work({} as AutomationRunContext);
      } catch (error) {
        expect(error).toBe(original);
      }
      return { status: 'failed', runId: 'existing-task' };
    };
    await expect(
      runMailTask(run, 'task', options, async () => {
        throw original;
      }),
    ).rejects.toBe(original);
  });
  it.each(['succeeded', 'skipped', 'disabled', 'duplicate'])(
    'keeps %s non-failing',
    async (status) => {
      const work = vi.fn();
      await expect(
        runMailTask(async () => ({ status }), 'task', options, work),
      ).resolves.toBeUndefined();
      expect(work).not.toHaveBeenCalled();
    },
  );
  it('propagates a recorded pre-work failure without querying or running work again', async () => {
    const work = vi.fn();
    await expect(
      runMailTask(
        async () => ({ status: 'failed', runId: 'existing-task' }),
        'task',
        options,
        work,
      ),
    ).rejects.toThrow('MAIL_TASK_FAILED');
    expect(work).not.toHaveBeenCalled();
  });
  it.each([
    'billing sort',
    'billing reply',
    'audit sort',
    'recruiting sort',
    'recruiting reply',
  ])('%s does not discard a failed outcome', async (entry) => {
    const deps = {
      mail: {
        row: vi.fn(async () => ({ status: 'received' })),
        leaveUnmatched: vi.fn(),
      },
      run: vi.fn(async () => ({ status: 'failed', runId: 'existing-task' })),
    };
    const message = {
      id: 'message',
      refType: entry.startsWith('billing') ? 'laborVendorBill' : 'application',
      refId: 'record',
    } as MailMessage;
    const handler = entry.startsWith('billing')
      ? createBillingMailHandler(
          deps as unknown as Parameters<typeof createBillingMailHandler>[0],
        ).handler
      : entry.startsWith('audit')
        ? createAuditMail(
            deps as unknown as Parameters<typeof createAuditMail>[0],
          ).handler
        : createRecruitingMailHandler(
            deps as unknown as Parameters<
              typeof createRecruitingMailHandler
            >[0],
          ).handler;
    const action = entry.endsWith('reply')
      ? handler.onReply
      : handler.onUnmatched;
    await expect(action(message)).rejects.toThrow('MAIL_TASK_FAILED');
    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(deps.mail.leaveUnmatched).toHaveBeenCalledTimes(
      entry.endsWith('sort') ? 1 : 0,
    );
  });
});

describe('mail poll read failures', () => {
  it('retains a read failure and continues the other enabled mailboxes', async () => {
    const original = new Error('controlled sync failure');
    const startSync = vi.fn(
      async (_ctx: unknown, input: { accountId: string }) => {
        if (input.accountId === 'billing') throw original;
      },
    );
    const settings = {
      ...MAIL_SETTINGS_DEFAULTS,
      mailboxes: Object.fromEntries(
        MAIL_PURPOSES.map((purpose) => [
          purpose,
          {
            ...MAIL_SETTINGS_DEFAULTS.mailboxes[purpose],
            accountId: purpose,
            ownerUserId: 'owner',
          },
        ]),
      ),
    };
    const service = createMailService({
      settings: { read: async () => ({ value: settings }) },
      mail: () => ({
        startSync,
        listSyncRuns: async () => [],
        listFolders: async () => [],
        listMessages: async () => ({ items: [] }),
      }),
      log: vi.fn(),
      production: true,
      localProvider: null,
    } as unknown as Parameters<typeof createMailService>[0]);
    for (const purpose of MAIL_PURPOSES)
      service.registerHandler(
        purpose,
        {} as Parameters<typeof service.registerHandler>[1],
      );
    const error = await service.poll().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(MailPollError);
    expect((error as MailPollError).errors).toEqual([original]);
    expect((error as MailPollError).counts).toEqual({
      recruiting: 0,
      audit: 0,
      hr: 0,
    });
    expect(startSync.mock.calls.map(([, input]) => input.accountId)).toEqual(
      MAIL_PURPOSES,
    );
  });
});

describe('mail task finalization', () => {
  it('retains both errors when existing post-processing also fails', async () => {
    const original = new Error('original work failure');
    const following = new Error('existing post-processing failure');
    const run: Parameters<typeof runMailTask>[0] = async (
      _key,
      _options,
      work,
    ) => {
      try {
        await work({} as AutomationRunContext);
      } catch {
        /* automation persists the failure */
      }
      return { status: 'failed', runId: 'existing-task' };
    };
    const reason = await runMailTask(
      run,
      'task',
      options,
      async () => {
        throw original;
      },
      async () => {
        throw following;
      },
    ).catch((error: unknown) => error);
    expect(reason).toBeInstanceOf(AggregateError);
    expect((reason as AggregateError).errors).toEqual([original, following]);
    expect((reason as AggregateError).cause).toBe(following);
  });
});

describe('valid sender filtering', () => {
  it.each(['billing', 'audit'])(
    '%s keeps an out-of-domain message skipped',
    async (purpose) => {
      const leaveUnmatched = vi.fn();
      const run = vi.fn(
        async (
          _key: string,
          _options: unknown,
          work: (context: AutomationRunContext) => Promise<unknown>,
        ) => {
          const result = await work({
            summarize: vi.fn(),
          } as unknown as AutomationRunContext);
          expect(result).toEqual({ status: 'skipped' });
          return { status: 'skipped', runId: 'existing-task' };
        },
      );
      const deps = {
        run,
        mail: { leaveUnmatched, row: async () => ({ status: 'unmatched' }) },
        settings: {
          read: async () => ({
            value: {
              mailboxes: {
                [purpose]: { allowedSenderDomains: ['allowed.test'] },
              },
            },
          }),
        },
      };
      const handler =
        purpose === 'billing'
          ? createBillingMailHandler(
              deps as unknown as Parameters<typeof createBillingMailHandler>[0],
            ).handler
          : createAuditMail(
              deps as unknown as Parameters<typeof createAuditMail>[0],
            ).handler;
      await expect(
        handler.onUnmatched({
          id: 'message',
          from: { address: 'sender@other.test' },
        } as MailMessage),
      ).resolves.toBeUndefined();
      expect(leaveUnmatched).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledTimes(1);
    },
  );
});
