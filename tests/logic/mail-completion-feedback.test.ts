// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { loggingToken } from '@nocobase/app-server/logging';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { composeMail } from '../../database/seed-data/demo-mail.ts';
import { scopeForUser } from '../../server/providers/hr/authorize.ts';
import { MAIL_REPLY_AUDIT } from '../../server/providers/hr/mail/audit.ts';
import { BILL_REVIEW } from '../../server/providers/hr/payroll/assistant.ts';
import { MAIL_REPLY_BILLING } from '../../server/providers/hr/mail/billing.ts';
import {
  auditMailToken,
  automationServiceToken,
  billingMailToken,
  mailServiceToken,
  payrollServicesToken,
} from '../../server/providers/hr/tokens.ts';
import { startHarness, type Harness } from './talent-review-harness.ts';

let h: Harness;
beforeAll(async () => {
  h = await startHarness('mail-completion-feedback');
}, 180_000);
afterAll(async () => {
  await h?.close();
}, 30_000);

/** Whole operation windows; concurrent fixture work is not a fixed per-request budget. */
async function measure<T>(label: string, work: () => Promise<T>): Promise<T> {
  const client = await (await h.db()).connection().client<{
    on(event: string, listener: (query: { sql: string }) => void): void;
    removeListener(
      event: string,
      listener: (query: { sql: string }) => void,
    ): void;
  }>();
  const sql: string[] = [];
  const listener = (query: { sql: string }) => sql.push(query.sql);
  client.on('query', listener);
  try {
    return await work();
  } finally {
    client.removeListener('query', listener);
    process.stdout.write(
      'MAIL_COMPLETION_COST ' +
        JSON.stringify({
          label,
          ...Object.fromEntries(
            ['select', 'insert', 'update', 'delete', 'begin', 'commit'].map(
              (verb) => [
                verb,
                sql.filter((statement) =>
                  new RegExp('^' + verb + '\\b', 'i').test(statement),
                ).length,
              ],
            ),
          ),
        }) +
        '\n',
    );
  }
}
async function configure(key: string, enabled: boolean) {
  const container = h.server.application.container;
  const userId = await h.userId(
    key === MAIL_REPLY_AUDIT ? 'hr01' : 'payroll01',
  );
  const actor = {
    userId,
    authz: await scopeForUser(container.resolve(authorizationToken), userId),
  };
  await container
    .resolve(automationServiceToken)
    .update(actor, key, { enabled });
}
async function runs(task: string, ref: string) {
  return (await h.db())
    .query()
    .selectFrom('aiTaskRuns')
    .selectAll()
    .where('task', '=', task)
    .where('triggerRef', 'like', `%${ref}%`)
    .orderBy('createdAt')
    .execute();
}
async function drafts(ref: string) {
  return (await h.db())
    .query()
    .selectFrom('businessMailMessages')
    .select(['id', 'bodyText', 'status'])
    .where('refId', '=', ref)
    .where('direction', '=', 'outbound')
    .execute();
}
async function request() {
  const created = await h.call('qa_audit', 'POST', '/audit-requests', {
    customerName: 'Synthetic completion audit',
    requesterAddress: 'auditor@completion.test',
    dueDate: '2026-12-20',
  });
  expect(created.status).toBe(201);
  const id = String(created.json.data.id);
  expect(
    (
      await h.call('qa_audit', 'PATCH', `/audit-requests/${id}`, {
        departmentIds: ['sz-mc'],
        positionIds: ['pos-cnc-operator'],
        materials: ['certificates'],
      })
    ).status,
  ).toBe(200);
  expect(
    (await h.call('qa_audit', 'POST', `/audit-requests/${id}/confirm`)).status,
  ).toBe(200);
  return id;
}

it.each(['disabled', 'failure', 'partial', 'success'] as const)(
  'audit pack remains available with %s reply drafting',
  async (mode) => {
    const id = await request();
    await configure(MAIL_REPLY_AUDIT, mode !== 'disabled');
    const container = h.server.application.container;
    const mail = container.resolve(mailServiceToken);
    const original = new Error(`controlled audit ${mode}`);
    const automation = container.resolve(automationServiceToken);
    const runTask = vi.spyOn(automation, 'run');
    const draftNew = mail.draftNew.bind(mail);
    const draft = vi.spyOn(mail, 'draftNew');
    if (mode === 'partial')
      draft.mockImplementationOnce(async (input) => {
        await draftNew(input);
        throw original;
      });
    if (mode === 'failure') draft.mockRejectedValueOnce(original);
    try {
      const result = await measure(`audit ${mode}`, () =>
        h.call('qa_audit', 'POST', `/audit-requests/${id}/pack`),
      );
      expect(result.status).toBe(200);
      expect(result.json.data).toMatchObject({
        status: 'packReady',
        hasPack: true,
      });
      expect(result.json.data.packFileName).toMatch(/audit-pack.*\.zip/u);
      const userId = await h.userId('qa_audit');
      const pack = await container.resolve(auditMailToken).service.pack(
        {
          userId,
          authz: await scopeForUser(
            container.resolve(authorizationToken),
            userId,
          ),
        },
        id,
      );
      expect(pack.bytes.byteLength).toBeGreaterThan(100);
      const thread = await drafts(id);
      const call = runTask.mock.calls.find(
        (call) =>
          call[0] === MAIL_REPLY_AUDIT && call[2].triggerRef?.requestId === id,
      )!;
      expect(call).toBeTruthy();
      await measure(`audit ${mode} duplicate trigger`, () =>
        automation.run(...call),
      );
      expect((await drafts(id)).map((row) => row.id)).toEqual(
        thread.map((row) => row.id),
      );
      expect(thread).toHaveLength(
        mode === 'disabled' || mode === 'failure' ? 0 : 1,
      );
      const run = (await runs(MAIL_REPLY_AUDIT, id))[0]!;
      expect(run.status).toBe(
        mode === 'disabled'
          ? 'skipped'
          : mode === 'success'
            ? 'succeeded'
            : 'failed',
      );
      if (mode === 'failure' || mode === 'partial')
        expect(String(run.error)).toContain(original.message);
      expect(run.finishedAt).toBeTruthy();
      // Access denial cannot rebuild or replace the saved pack, or create a reply.
      expect(
        (await h.call('mgr_njl', 'POST', `/audit-requests/${id}/pack`)).status,
      ).toBe(403);
      expect(
        (await h.call(null, 'POST', `/audit-requests/${id}/pack`)).status,
      ).toBe(401);
      expect((await drafts(id)).map((row) => row.id)).toEqual(
        thread.map((row) => row.id),
      );
      expect(
        (await h.call('qa_audit', 'GET', `/audit-requests/${id}`)).json.data,
      ).toMatchObject({
        status: 'packReady',
        packFileName: result.json.data.packFileName,
      });
    } finally {
      draft.mockRestore();
      runTask.mockRestore();
      await configure(MAIL_REPLY_AUDIT, true);
    }
  },
);

async function bill() {
  const database = await h.db();
  const id = randomUUID();
  const now = new Date();
  await database
    .query()
    .insertInto('laborVendorBills')
    .values({
      id,
      vendorName: `Synthetic ${id}`,
      month: '2026-09',
      fileId: 'synthetic-bill-file',
      sourceMailId: null,
      lines: [{ employeeNo: 'QH9001', name: 'Synthetic worker', hours: 160 }],
      reconciliation: [
        {
          employeeId: 'emp-agency-01',
          employeeNo: 'QH9001',
          name: 'Synthetic worker',
          billedHours: 160,
          attendanceHours: 152,
          diffHours: 8,
          reason: 'diff',
        },
      ],
      aiNotes: 'Existing reconciled notes',
      status: 'reconciled',
      confirmedBy: null,
      confirmedAt: null,
      uploads: [],
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  const inbox = path.join(
    h.server.application.paths.storageDir,
    'mail/local/billing@qiheng.test/inbox',
  );
  mkdirSync(inbox, { recursive: true });
  const subject = `Synthetic completion ${id}`;
  writeFileSync(
    path.join(inbox, `${id}.eml`),
    composeMail({
      from: { name: 'Synthetic vendor', address: 'vendor@completion.test' },
      to: 'billing@qiheng.test',
      subject,
      text: 'Please review these reconciled hours.',
      date: new Date(),
    }),
  );
  await h.server.application.container
    .resolve(mailServiceToken)
    .poll('billing');
  const source = await database
    .query()
    .selectFrom('businessMailMessages')
    .select(['id'])
    .where('subject', '=', subject)
    .executeTakeFirstOrThrow();
  await h.server.application.container.resolve(mailServiceToken).link({
    id: String(source.id),
    refType: 'laborVendorBill',
    refId: id,
    intent: 'vendorBill',
    summary: 'Synthetic non-poll completion fixture',
  });
  await database
    .query()
    .updateTable('laborVendorBills')
    .set({ sourceMailId: source.id })
    .where('id', '=', id)
    .execute();
  return id;
}

it.each(['disabled', 'failure', 'partial', 'success'] as const)(
  'billing non-poll caller receives truthful %s completion and never repeats a draft',
  async (mode) => {
    const id = await bill();
    await configure(MAIL_REPLY_BILLING, mode !== 'disabled');
    const container = h.server.application.container;
    const billing = container.resolve(billingMailToken);
    const mail = container.resolve(mailServiceToken);
    const original = new Error(`controlled billing ${mode}`);
    const draftReply = mail.draftReply.bind(mail);
    const draft = vi.spyOn(mail, 'draftReply');
    if (mode === 'failure') draft.mockRejectedValueOnce(original);
    if (mode === 'partial')
      draft.mockImplementationOnce(async (input) => {
        await draftReply(input);
        throw original;
      });
    try {
      if (mode === 'failure' || mode === 'partial')
        await expect(
          measure(`billing ${mode}`, () => billing.draftForBill(id)),
        ).rejects.toBe(original);
      else
        await expect(
          measure(`billing ${mode}`, () => billing.draftForBill(id)),
        ).resolves.toBeUndefined();
      const before = await drafts(id);
      expect(before).toHaveLength(
        mode === 'disabled' || mode === 'failure' ? 0 : 1,
      );
      const run = (await runs(MAIL_REPLY_BILLING, id))[0]!;
      expect(run.status).toBe(
        mode === 'disabled'
          ? 'skipped'
          : mode === 'success'
            ? 'succeeded'
            : 'failed',
      );
      if (mode === 'failure' || mode === 'partial')
        expect(String(run.error)).toContain(original.message);
      expect(run.finishedAt).toBeTruthy();
      // Existing dedupe consumes even a failed trigger: reporting failure must not retry it.
      await expect(
        measure(`billing ${mode}`, () => billing.draftForBill(id)),
      ).resolves.toBeUndefined();
      expect((await drafts(id)).map((row) => row.id)).toEqual(
        before.map((row) => row.id),
      );
      expect(draft).toHaveBeenCalledTimes(mode === 'disabled' ? 0 : 1);
      const saved = await (
        await h.db()
      )
        .query()
        .selectFrom('laborVendorBills')
        .select(['aiNotes'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(saved.aiNotes).toBe('Existing reconciled notes');
      expect(
        (await h.call('mgr_njl', 'GET', `/payroll/vendor-bills/${id}`)).status,
      ).toBe(403);
      expect(
        (await h.call(null, 'GET', `/payroll/vendor-bills/${id}`)).status,
      ).toBe(401);
    } finally {
      draft.mockRestore();
      await configure(MAIL_REPLY_BILLING, true);
    }
  },
);

it('a bill without source mail legitimately skips drafting without a new task', async () => {
  const container = h.server.application.container;
  const automation = vi.spyOn(container.resolve(automationServiceToken), 'run');
  try {
    await expect(
      container.resolve(billingMailToken).draftForBill(randomUUID()),
    ).resolves.toBeUndefined();
    expect(automation).not.toHaveBeenCalled();
  } finally {
    automation.mockRestore();
  }
});

it.each(['failure', 'partial', 'success'] as const)(
  'registered bill review reaches the existing background catch with %s drafting',
  async (mode) => {
    const id = await bill();
    await configure(BILL_REVIEW, true);
    await configure(MAIL_REPLY_BILLING, true);
    const container = h.server.application.container;
    const payroll = container.resolve(payrollServicesToken);
    const billing = container.resolve(billingMailToken);
    const mail = container.resolve(mailServiceToken);
    const original = new Error(`controlled background billing ${mode}`);
    const draftReply = mail.draftReply.bind(mail);
    const draft = vi.spyOn(mail, 'draftReply');
    if (mode === 'failure') draft.mockRejectedValueOnce(original);
    if (mode === 'partial')
      draft.mockImplementationOnce(async (input) => {
        await draftReply(input);
        throw original;
      });
    // Call-through observers on public instances; no replacement of the callback, task or catch.
    const callback = vi.spyOn(billing, 'draftForBill');
    const warning = vi.spyOn(
      container.resolve(loggingToken).getLogger('hr'),
      'warn',
    );
    try {
      await measure(`bill review background ${mode}`, async () => {
        const outcome = await payroll.assistant.review(
          id,
          'controlled-completion-upload',
        );
        expect(outcome.status).toBe('succeeded');
        await vi.waitFor(() =>
          expect(callback).toHaveBeenCalledExactlyOnceWith(id),
        );
        const result = await (
          callback.mock.results[0]!.value as Promise<void>
        ).catch((reason: unknown) => reason);
        if (mode === 'success') expect(result).toBeUndefined();
        else expect(result).toBe(original);
        const ownWarnings = warning.mock.calls.filter(
          ([fields]) =>
            fields &&
            typeof fields === 'object' &&
            'automation' in fields &&
            fields.automation === 'hrAssistant.mailReplyBilling',
        );
        if (mode === 'success') expect(ownWarnings).toHaveLength(0);
        else
          expect(ownWarnings).toEqual([
            [
              { error: original, automation: 'hrAssistant.mailReplyBilling' },
              'HR automation failed',
            ],
          ]);
      });
      const before = await drafts(id);
      expect(before).toHaveLength(mode === 'failure' ? 0 : 1);
      const reply = (await runs(MAIL_REPLY_BILLING, id))[0]!;
      expect(reply.status).toBe(mode === 'success' ? 'succeeded' : 'failed');
      expect(reply.finishedAt).toBeTruthy();
      if (mode !== 'success')
        expect(String(reply.error)).toContain(original.message);
      expect((await runs(BILL_REVIEW, id))[0]!.status).toBe('succeeded');
      expect(
        (
          await (
            await h.db()
          )
            .query()
            .selectFrom('laborVendorBills')
            .select(['aiNotes'])
            .where('id', '=', id)
            .executeTakeFirstOrThrow()
        ).aiNotes,
      ).toBe('Existing reconciled notes');
      await payroll.assistant.review(id, 'controlled-completion-upload');
      expect(callback).toHaveBeenCalledTimes(1);
      expect(draft).toHaveBeenCalledTimes(1);
      expect((await drafts(id)).map((row) => row.id)).toEqual(
        before.map((row) => row.id),
      );
    } finally {
      draft.mockRestore();
      callback.mockRestore();
      warning.mockRestore();
    }
  },
);
