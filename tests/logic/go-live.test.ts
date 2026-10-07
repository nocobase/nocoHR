// @vitest-environment node

// 上线准备: the go-live checklist's status endpoint (values from the tables, each step scoped by the caller's
// permissions, marking a step as not needed, the first payroll month) and 批量开通账号并发激活链接 (accounts created
// through the Users service and linked, hashed single-use tokens that expire, revocation, the public page setting the
// password through the authentication plugin, refusal of privileged accounts, and per-address throttling).
import { createHash } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PASSWORD,
  startHarness,
  today,
  type Harness,
} from './talent-review-harness.ts';

let h: Harness;

beforeAll(async () => {
  h = await startHarness('go-live');
}, 240_000);

afterAll(async () => {
  await h?.close();
});

const sha = (value: string) => createHash('sha256').update(value).digest('hex');

async function addEmployee(
  id: string,
  employeeNo: string,
  values: {
    email?: string | null;
    externalUserId?: string | null;
    name?: string;
  } = {},
) {
  const now = new Date();
  await (
    await h.db()
  )
    .query()
    .insertInto('employees')
    .values({
      id,
      employeeNo,
      name: values.name ?? `上线测试${employeeNo}`,
      userId: null,
      departmentId: 'cd-mc',
      positionId: null,
      managerEmployeeId: null,
      status: 'active',
      hireDate: today(),
      positionSince: null,
      email: values.email ?? null,
      mobile: null,
      note: null,
      gender: null,
      birthDate: null,
      idType: null,
      idNumber: null,
      employmentType: 'fullTime',
      workLocation: null,
      probationEndDate: null,
      regularizedAt: null,
      leaveDate: null,
      leaveReason: null,
      address: null,
      externalProvider: values.externalUserId ? 'feishu' : null,
      externalUserId: values.externalUserId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
}

/** An activation row with a token the test knows, for the expiry, revocation and refusal checks. */
async function plantToken(employeeId: string, userId: string, expiresAt: Date) {
  const token =
    `planted${Math.random().toString(36).slice(2)}${'x'.repeat(40)}`.slice(
      0,
      48,
    );
  const now = new Date();
  await (
    await h.db()
  )
    .query()
    .insertInto('accountActivations')
    .values({
      id: `act-${token.slice(7, 20)}`,
      employeeId,
      userId,
      tokenHash: sha(token),
      expiresAt,
      usedAt: null,
      revokedAt: null,
      revokedReason: null,
      channel: 'manual',
      deliveryStatus: 'manual',
      sentTo: null,
      createdBy: 'test',
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return token;
}

const publicCall = async (
  method: string,
  token: string,
  body?: unknown,
  ip?: string,
) => {
  const response = await h.server.fetch(
    new Request(`${h.base}/api/public/activation/${token}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(method === 'GET' ? {} : { origin: 'http://localhost' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    ip ? { incoming: { socket: { remoteAddress: ip } } } : undefined,
  );
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : {} };
};

const stepOf = (data: { steps: { key: string }[] }, key: string) =>
  data.steps.find((s) => s.key === key) as
    | {
        key: string;
        status: string;
        facts: Record<string, any>;
        skipped: boolean;
        canSkip: boolean;
      }
    | undefined;

describe('上线准备 · 状态', () => {
  it('needs a session and the go-live permission', async () => {
    expect((await h.call(null, 'GET', '/go-live/status')).status).toBe(401);
    expect((await h.call('emp_njl_1', 'GET', '/go-live/status')).status).toBe(
      403,
    );
  });

  it('hr01 sees every step, computed from the tables', async () => {
    const response = await h.call('hr01', 'GET', '/go-live/status');
    expect(response.status).toBe(200);
    const data = response.json.data;
    expect(data.steps.map((s: { key: string }) => s.key)).toEqual([
      'config',
      'departments',
      'positions',
      'employees',
      'contracts',
      'leaveOpening',
      'salaries',
      'insurance',
      'deductions',
      'taxOpening',
      'accounts',
      'trialPayroll',
    ]);
    const db = await h.db();
    const active = await db
      .query()
      .selectFrom('employees')
      .select(['id', 'userId'])
      .where('status', '!=', 'leave')
      .execute();
    const departments = await db
      .query()
      .selectFrom('departments')
      .select(['id'])
      .execute();
    expect(stepOf(data, 'employees')!.facts.count).toBe(active.length);
    expect(stepOf(data, 'employees')!.status).toBe('done');
    expect(stepOf(data, 'departments')!.facts.count).toBe(departments.length);
    const contracts = await db
      .query()
      .selectFrom('employmentContracts')
      .select(['employeeId'])
      .where('status', '=', 'active')
      .execute();
    const ids = new Set(active.map((e) => String(e.id)));
    const covered = new Set(
      contracts.map((c) => String(c.employeeId)).filter((id) => ids.has(id)),
    ).size;
    expect(stepOf(data, 'contracts')!.facts).toMatchObject({
      covered,
      total: active.length,
    });
    const accounts = stepOf(data, 'accounts')!;
    expect(accounts.facts.total).toBe(active.length);
    expect(accounts.facts.withoutAccount).toBe(
      active.filter((e) => !e.userId).length,
    );
    // Configuration is reported as booleans only.
    const config = stepOf(data, 'config')!;
    expect(
      Object.values(config.facts).every((v) => typeof v === 'boolean'),
    ).toBe(true);
    expect(config.facts.publicOrigin).toBe(true);
    // The demo payroll has a calculated cycle.
    expect(['done', 'inProgress', 'notStarted']).toContain(
      stepOf(data, 'trialPayroll')!.status,
    );
    expect(stepOf(data, 'contracts')!.canSkip).toBe(true);
    expect(stepOf(data, 'salaries')!.canSkip).toBe(false);
  });

  it('payroll01 sees the payroll steps only', async () => {
    const response = await h.call('payroll01', 'GET', '/go-live/status');
    expect(response.status).toBe(200);
    expect(response.json.data.steps.map((s: { key: string }) => s.key)).toEqual(
      ['salaries', 'insurance', 'deductions', 'taxOpening', 'trialPayroll'],
    );
    // Counts of people only: no amount anywhere.
    expect(JSON.stringify(response.json.data)).not.toMatch(
      /amount|base|salary"/iu,
    );
  });

  it('marks steps as not needed by who owns them, and the first payroll month decides 个税累计期初', async () => {
    expect(
      (
        await h.call('hr01', 'PUT', '/go-live/steps/contracts', {
          skipped: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await h.call('payroll01', 'PUT', '/go-live/steps/contracts', {
          skipped: true,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.call('hr01', 'PUT', '/go-live/steps/deductions', {
          skipped: true,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.call('payroll01', 'PUT', '/go-live/steps/deductions', {
          skipped: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (await h.call('hr01', 'PUT', '/go-live/steps/nothing', { skipped: true }))
        .status,
    ).toBe(404);
    let data = (await h.call('hr01', 'GET', '/go-live/status')).json.data;
    expect(stepOf(data, 'contracts')).toMatchObject({
      status: 'skipped',
      skipped: true,
    });
    expect(stepOf(data, 'deductions')).toMatchObject({
      status: 'skipped',
      skipped: true,
    });
    expect(
      (
        await h.call('hr01', 'PUT', '/go-live/steps/contracts', {
          skipped: false,
        })
      ).status,
    ).toBe(200);
    data = (await h.call('hr01', 'GET', '/go-live/status')).json.data;
    expect(stepOf(data, 'contracts')!.skipped).toBe(false);

    const year = today().slice(0, 4);
    const january = await h.call(
      'payroll01',
      'PUT',
      '/go-live/first-payroll-month',
      {
        revision: data.revision,
        firstPayrollMonth: `${year}-01`,
      },
    );
    expect(january.status).toBe(200);
    data = (await h.call('payroll01', 'GET', '/go-live/status')).json.data;
    expect(stepOf(data, 'taxOpening')!.status).toBe('notNeeded');
    const july = await h.call(
      'payroll01',
      'PUT',
      '/go-live/first-payroll-month',
      {
        revision: data.revision,
        firstPayrollMonth: `${year}-07`,
      },
    );
    expect(july.status).toBe(200);
    data = (await h.call('payroll01', 'GET', '/go-live/status')).json.data;
    expect(stepOf(data, 'taxOpening')!.status).not.toBe('notNeeded');
    expect(stepOf(data, 'taxOpening')!.facts.firstPayrollMonth).toBe(
      `${year}-07`,
    );
    // A stale revision is refused.
    expect(
      (
        await h.call('payroll01', 'PUT', '/go-live/first-payroll-month', {
          revision: 0,
          firstPayrollMonth: '',
        })
      ).status,
    ).toBe(409);
  });
});

describe('批量开通账号并发激活链接', () => {
  let feishuToken = '';
  let feishuUserId = '';

  it('creates and links accounts for employees without one, and skips the others', async () => {
    await addEmployee('emp-golive-a', 'GL1001', {
      email: 'golive.a@example.com',
    });
    await addEmployee('emp-golive-b', 'GL1002', {
      email: 'golive.b@example.com',
      externalUserId: 'ou_golive_b',
      name: '上线飞书',
    });
    await addEmployee('emp-golive-c', 'GL1003', { email: null });
    expect(
      (
        await h.call(null, 'POST', '/account-activation/bulk', {
          employeeIds: ['emp-golive-a'],
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await h.call('emp_njl_1', 'POST', '/account-activation/bulk', {
          employeeIds: ['emp-golive-a'],
        })
      ).status,
    ).toBe(403);
    const response = await h.call('hr01', 'POST', '/account-activation/bulk', {
      employeeIds: [
        'emp-golive-a',
        'emp-golive-b',
        'emp-golive-c',
        'emp-wanglei',
      ],
    });
    expect(response.status).toBe(200);
    const results = Object.fromEntries(
      response.json.data.map((r: { employeeId: string }) => [r.employeeId, r]),
    ) as Record<string, any>;
    expect(results['emp-wanglei'].outcome).toEqual({
      status: 'skipped',
      reason: 'hasAccount',
    });
    expect(results['emp-golive-c'].outcome).toEqual({
      status: 'skipped',
      reason: 'noEmail',
    });
    expect(results['emp-golive-b'].outcome).toMatchObject({
      status: 'sent',
      channel: 'feishu',
    });
    expect(['sent', 'manual']).toContain(
      results['emp-golive-a'].outcome.status,
    );
    if (results['emp-golive-a'].outcome.status === 'manual')
      expect(results['emp-golive-a'].outcome.link).toMatch(
        /\/activate\/[A-Za-z0-9_-]{43}$/u,
      );
    expect(results['emp-golive-a'].login).toBe('gl1001');
    const db = await h.db();
    const employees = await db
      .query()
      .selectFrom('employees')
      .select(['id', 'userId'])
      .where('id', 'in', ['emp-golive-a', 'emp-golive-b', 'emp-golive-c'])
      .execute();
    const linked = Object.fromEntries(
      employees.map((e) => [String(e.id), e.userId]),
    );
    expect(linked['emp-golive-a']).toBeTruthy();
    expect(linked['emp-golive-b']).toBeTruthy();
    expect(linked['emp-golive-c']).toBeNull();
    feishuUserId = String(linked['emp-golive-b']);
    const user = await db
      .query()
      .selectFrom('user')
      .select(['username', 'email'])
      .where('id', '=', feishuUserId)
      .executeTakeFirst();
    expect(user).toMatchObject({
      username: 'gl1002',
      email: 'golive.b@example.com',
    });

    // The bot message carries the link; only its hash is stored.
    const { imChannelToken } =
      await import('../../server/providers/hr/tokens.ts');
    const outbox =
      h.server.application.container.resolve(imChannelToken).mockOutbox!(
        'ou_golive_b',
      );
    const text = outbox.map((m) => m.text ?? '').join('\n');
    const match = /\/activate\/([A-Za-z0-9_-]{43})/u.exec(text);
    expect(match).toBeTruthy();
    feishuToken = match![1];
    expect(Buffer.from(feishuToken, 'base64url').length).toBeGreaterThanOrEqual(
      24,
    );
    const rows = await db
      .query()
      .selectFrom('accountActivations')
      .selectAll()
      .where('employeeId', '=', 'emp-golive-b')
      .execute();
    expect(rows).toHaveLength(1);
    expect(String(rows[0].tokenHash)).toBe(sha(feishuToken));
    expect(JSON.stringify(rows)).not.toContain(feishuToken);
    const days =
      (new Date(String(rows[0].expiresAt)).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
    const events = await db
      .query()
      .selectFrom('accountActivationEvents')
      .select(['event'])
      .where('employeeId', '=', 'emp-golive-b')
      .execute();
    expect(events.map((e) => e.event)).toEqual(
      expect.arrayContaining(['accountCreated', 'issued', 'sent']),
    );

    // A second run skips them: they have accounts now.
    const again = await h.call('hr01', 'POST', '/account-activation/bulk', {
      employeeIds: ['emp-golive-a'],
    });
    expect(again.json.data[0].outcome).toEqual({
      status: 'skipped',
      reason: 'hasAccount',
    });
    // The state the detail page shows.
    const state = await h.call(
      'hr01',
      'GET',
      '/account-activation/employees/emp-golive-b',
    );
    expect(state.json.data.open).toMatchObject({
      channel: 'feishu',
      deliveryStatus: 'sent',
    });
    expect(state.json.data.activatedAt).toBeNull();
    // The accounts step counts them as pending.
    const status = (await h.call('hr01', 'GET', '/go-live/status')).json.data;
    expect(stepOf(status, 'accounts')!.facts.pending).toBeGreaterThanOrEqual(2);
  });

  it('the link shows the person, sets the password through the authentication plugin once, and signs in', async () => {
    const view = await publicCall('GET', feishuToken);
    expect(view.status).toBe(200);
    expect(view.json.data).toMatchObject({
      name: '上线飞书',
      login: 'gl1002',
      minPasswordLength: 8,
    });
    const short = await publicCall('POST', feishuToken, { password: 'short' });
    expect(short.status).toBe(400);
    expect(short.json.code).toBe('PASSWORD_TOO_SHORT');
    const newPassword = 'golive-new-password-1';
    const done = await publicCall('POST', feishuToken, {
      password: newPassword,
    });
    expect(done.status).toBe(200);
    expect(done.json.data.login).toBe('gl1002');
    const signIn = await h.server.fetch(
      new Request(`${h.base}/api/auth/sign-in/username`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'gl1002', password: newPassword }),
      }),
    );
    expect(signIn.status).toBe(200);
    // Single use.
    expect((await publicCall('GET', feishuToken)).status).toBe(404);
    expect(
      (
        await publicCall('POST', feishuToken, {
          password: 'another-password-2',
        })
      ).status,
    ).toBe(404);
    // An activated account gets no new link.
    const resend = await h.call(
      'hr01',
      'POST',
      '/account-activation/employees/emp-golive-b/resend',
    );
    expect(resend.status).toBe(409);
    expect(resend.json.code).toBe('ACCOUNT_ALREADY_ACTIVATED');
    const state = await h.call(
      'hr01',
      'GET',
      '/account-activation/employees/emp-golive-b',
    );
    expect(state.json.data.activatedAt).toBeTruthy();
    expect(state.json.data.open).toBeNull();
  });

  it('refuses a wrong, an expired and a revoked link', async () => {
    expect((await publicCall('GET', 'A'.repeat(43))).status).toBe(404);
    expect((await publicCall('GET', 'not-a-token')).status).toBe(404);
    const db = await h.db();
    const a = await db
      .query()
      .selectFrom('employees')
      .select(['userId'])
      .where('id', '=', 'emp-golive-a')
      .executeTakeFirst();
    const userId = String(a!.userId);
    const expired = await plantToken(
      'emp-golive-a',
      userId,
      new Date(Date.now() - 1000),
    );
    expect((await publicCall('GET', expired)).status).toBe(404);
    expect(
      (await publicCall('POST', expired, { password: 'golive-expired-1' }))
        .status,
    ).toBe(404);
    const live = await plantToken(
      'emp-golive-a',
      userId,
      new Date(Date.now() + 3_600_000),
    );
    expect((await publicCall('GET', live)).status).toBe(200);
    expect(
      (
        await h.call(
          'emp_njl_1',
          'POST',
          '/account-activation/employees/emp-golive-a/revoke',
        )
      ).status,
    ).toBe(403);
    const revoked = await h.call(
      'hr01',
      'POST',
      '/account-activation/employees/emp-golive-a/revoke',
    );
    expect(revoked.status).toBe(200);
    expect(revoked.json.data.revoked).toBeGreaterThanOrEqual(1);
    expect((await publicCall('GET', live)).status).toBe(404);
    expect(
      (await publicCall('POST', live, { password: 'golive-revoked-1' })).status,
    ).toBe(404);
  });

  it('never activates root or payroll accounts through a link', async () => {
    const payrollUser = await h.userId('payroll01');
    const resend = await h.call(
      'hr01',
      'POST',
      '/account-activation/employees/emp-payroll01/resend',
    );
    expect(resend.status).toBe(403);
    expect(resend.json.code).toBe('ACCOUNT_PRIVILEGED_PAYROLL');
    // A link made for it anyway (by an older rule) is refused when used, and the password stays.
    const token = await plantToken(
      'emp-payroll01',
      payrollUser,
      new Date(Date.now() + 3_600_000),
    );
    expect(
      (await publicCall('POST', token, { password: 'take-over-attempt-1' }))
        .status,
    ).toBe(404);
    const signIn = await h.server.fetch(
      new Request(`${h.base}/api/auth/sign-in/username`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'payroll01', password: PASSWORD }),
      }),
    );
    expect(signIn.status).toBe(200);
    const refused = await (
      await h.db()
    )
      .query()
      .selectFrom('accountActivationEvents')
      .select(['event', 'detail'])
      .where('userId', '=', payrollUser)
      .execute();
    expect(refused.some((e) => e.event === 'refused')).toBe(true);
  });

  it('re-sends with the configured lifetime, at most once a minute', async () => {
    const settings = await h.call(
      'hr01',
      'GET',
      '/go-live/activation-settings',
    );
    expect(settings.json.data.value.linkDays).toBe(7);
    expect(
      (
        await h.call('payroll01', 'PUT', '/go-live/activation-settings', {
          revision: 0,
          value: { linkDays: 3 },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await h.call('hr01', 'PUT', '/go-live/activation-settings', {
          revision: settings.json.data.revision,
          value: { linkDays: 3 },
        })
      ).status,
    ).toBe(200);
    const db = await h.db();
    // Out of the pause since the bulk run.
    await db
      .query()
      .updateTable('accountActivationEvents')
      .set({ createdAt: new Date(Date.now() - 120_000) })
      .where('employeeId', '=', 'emp-golive-a')
      .execute();
    const resend = await h.call(
      'hr01',
      'POST',
      '/account-activation/employees/emp-golive-a/resend',
    );
    expect(resend.status).toBe(200);
    const days =
      (new Date(resend.json.data.expiresAt).getTime() - Date.now()) /
      86_400_000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThanOrEqual(3);
    const soon = await h.call(
      'hr01',
      'POST',
      '/account-activation/employees/emp-golive-a/resend',
    );
    expect(soon.status).toBe(409);
    expect(soon.json.code).toBe('ACTIVATION_TOO_SOON');
    // Only the newest link is open.
    const open = await db
      .query()
      .selectFrom('accountActivations')
      .select(['id'])
      .where('employeeId', '=', 'emp-golive-a')
      .where('usedAt', 'is', null)
      .where('revokedAt', 'is', null)
      .execute();
    expect(open).toHaveLength(1);
  });

  it('“all without an account” takes only employees in service without one', async () => {
    const response = await h.call('hr01', 'POST', '/account-activation/bulk', {
      allWithoutAccount: true,
    });
    expect(response.status).toBe(200);
    const results = response.json.data as {
      employeeId: string;
      outcome: { status: string; reason?: string };
    }[];
    expect(results.some((r) => r.outcome.reason === 'hasAccount')).toBe(false);
    expect(
      results.find((r) => r.employeeId === 'emp-golive-c')?.outcome,
    ).toEqual({ status: 'skipped', reason: 'noEmail' });
    expect(results.some((r) => r.employeeId === 'emp-golive-a')).toBe(false);
  });

  it('limits each client address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 62; i += 1)
      statuses.push(
        (
          await publicCall(
            'POST',
            'B'.repeat(43),
            { password: 'whatever-123' },
            '192.0.2.91',
          )
        ).status,
      );
    expect(statuses.slice(0, 60).every((s) => s === 404)).toBe(true);
    expect(statuses.slice(60)).toEqual([409, 409]);
    // Another address is not affected.
    expect(
      (
        await publicCall(
          'POST',
          'B'.repeat(43),
          { password: 'whatever-123' },
          '192.0.2.92',
        )
      ).status,
    ).toBe(404);
  });
});
