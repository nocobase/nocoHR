import { beforeAll, describe, expect, it } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { StandaloneServer } from '../../server/standalone.ts';

type Row = Record<string, any>;
type Call = (
  user: string | null,
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; json: Row }>;
type RawCall = (
  user: string | null,
  method: string,
  path: string,
  body?: BodyInit,
) => Promise<Response>;

export function registerLeaveProofAcceptance(
  server: () => StandaloneServer,
  call: Call,
  raw: RawCall,
) {
  describe('V2-05 private leave proofs', () => {
    const bytes = new TextEncoder().encode(
      '%PDF-1.4\nTest-only private leave evidence\n%%EOF',
    );
    const db = () =>
      server().application.container.resolve(databaseManagerToken);
    const upload = async (
      user: string | null,
      file = new File([bytes], 'proof.pdf', { type: 'application/pdf' }),
    ) => {
      const form = new FormData();
      form.append('file', file);
      // Attempted ownership injection must be ignored by the native uploader.
      form.append('uploadedByUserId', 'someone-else');
      return raw(user, 'POST', '/api/leaveProofFiles:uploadOne', form);
    };
    const draft = (
      attachmentFileId: string | null,
      user = 'emp_njl_1',
      overrides: Row = {},
    ) =>
      call(user, 'POST', '/leave/requests', {
        leaveTypeId: 'proof-test-sick',
        startAt: '2029-04-02T01:00:00.000Z',
        endAt: '2029-04-05T09:00:00.000Z',
        reason: 'Test private proof',
        attachmentFileId,
        ...overrides,
      });
    const change = (user: string, row: Row, action: string, extras: Row = {}) =>
      call(user, 'POST', `/leave/requests/${row.id}/${action}`, {
        expectedUpdatedAt: row.updatedAt,
        ...extras,
      });
    let proof: Row;
    let request: Row;
    beforeAll(async () => {
      const stamp = { createdAt: new Date(), updatedAt: new Date() };
      await db()
        .repository('leaveTypes')
        .createOne({
          values: {
            id: 'proof-test-sick',
            code: 'proof-test-sick',
            title: 'Test sick leave',
            payType: 'paid',
            unit: 'day',
            countBy: 'calendar',
            balanceRule: 'none',
            requiresAttachment: true,
            ...stamp,
          },
        });
    });
    it('rejects anonymous, no-grant and page-only uploads', async () => {
      expect((await upload(null)).status).toBe(401);
      const user = await call('trainer01', 'GET', '/api/auth/get-session');
      const authz = server().application.container.resolve(authorizationToken);
      await authz.permissionSets.create({
        key: 'proof-test-page-only',
        title: 'Test proof page only',
        grants: [
          {
            resource: { type: 'page', id: 'talent.me' },
            actions: [{ action: 'access' }],
          },
        ],
      });
      await authz.permissionSets.assign({
        permissionSet: 'proof-test-page-only',
        subject: { type: 'user', id: String(user.json.user.id) },
      });
      // Every seeded employee inherits hr.employee from the root department.
      // Remove only this test database's assignment while proving page-only
      // access; restore it in finally so other acceptance cases keep theirs.
      const assignments =
        await authz.permissionSets.listAssignments('hr.employee');
      const inherited = assignments.find(
        (entry) =>
          entry.subject.type === 'org.department' &&
          entry.subject.id === 'qiheng',
      );
      expect(inherited).toBeDefined();
      await authz.permissionSets.revoke(inherited!.id);
      try {
        expect((await upload('trainer01')).status).toBe(403);
      } finally {
        await authz.permissionSets.assign(inherited!);
      }
    });
    it('uploads, queries and downloads identical bytes with server-stamped ownership', async () => {
      const result = await upload('emp_njl_1');
      expect(result.status).toBe(200);
      proof = (await result.json()).data.record;
      expect(proof.contentUrl).toContain('/uploads/leave-proofs/');
      const owner = await call('emp_njl_1', 'GET', '/api/auth/get-session');
      const stored = await db()
        .repository('leaveProofFiles')
        .findOne({ filter: { id: proof.id } });
      expect(stored?.uploadedByUserId).toBe(owner.json.user.id);
      const metadata = await call(
        'emp_njl_1',
        'POST',
        '/api/leaveProofFiles:findOne',
        { filter: { id: proof.id } },
      );
      expect(metadata.status).toBe(200);
      expect(metadata.json.data).toMatchObject({
        id: proof.id,
        filename: 'proof.pdf',
        contentUrl: proof.contentUrl,
      });
      expect(metadata.json.data.key).toBeUndefined();
      expect(metadata.json.data.uploadedByUserId).toBeUndefined();
      const downloaded = await raw('emp_njl_1', 'GET', proof.contentUrl);
      expect(downloaded.status).toBe(200);
      expect(downloaded.headers.get('cache-control')).toContain('no-store');
      expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
    });
    it('denies metadata and bytes to others and prevents generic file bypass', async () => {
      for (const user of [
        null,
        'emp_njl_2',
        'mgr_njl',
        'mgr_cd',
        'trainer01',
      ]) {
        expect((await raw(user, 'GET', proof.contentUrl)).status).toBe(
          user ? 404 : 401,
        );
        const metadata = await call(
          user,
          'POST',
          '/api/leaveProofFiles:findOne',
          { filter: { id: proof.id } },
        );
        expect(metadata.status).not.toBe(200);
      }
      const generic = await call('hr01', 'POST', '/api/hrFiles:findOne', {
        filter: { id: proof.id },
      });
      expect(generic.json.data ?? null).toBeNull();
      expect(
        (await raw('hr01', 'GET', `/uploads/hr-files/${proof.id}.pdf`)).status,
      ).toBe(404);
      for (const action of [
        'createOne',
        'updateOne',
        'deleteOne',
        'uploadMany',
      ])
        expect(
          (await raw('emp_njl_1', 'POST', `/api/leaveProofFiles:${action}`))
            .status,
        ).toBe(404);
    });
    it('rejects unsupported, spoofed, empty and oversized uploads without metadata', async () => {
      const count = await db().repository('leaveProofFiles').count();
      for (const file of [
        new File(['<svg></svg>'], 'proof.svg', { type: 'image/svg+xml' }),
        new File(['not a PDF'], 'proof.pdf', { type: 'application/pdf' }),
        new File([bytes], 'proof.html', { type: 'application/pdf' }),
        new File([], 'proof.pdf', { type: 'application/pdf' }),
      ])
        expect((await upload('emp_njl_1', file)).status).toBe(400);
      const large = new File(
        [new Uint8Array(5 * 1024 * 1024 + 1)],
        'large.pdf',
        { type: 'application/pdf' },
      );
      expect((await upload('emp_njl_1', large)).status).toBe(413);
      expect(await db().repository('leaveProofFiles').count()).toBe(count);
    });
    it('requires proof at submission, prevents foreign binding and preserves proof on retry', async () => {
      const missing = await draft(null);
      expect(missing.status).toBe(201);
      expect(
        (await change('emp_njl_1', missing.json.data, 'submit')).json.code,
      ).toBe('ATTACHMENT_REQUIRED');
      expect((await draft(proof.id, 'emp_njl_2')).status).toBe(404);
      const created = await draft(proof.id);
      expect(created.status).toBe(201);
      request = created.json.data;
      expect(
        (await call('mgr_njl', 'GET', `/leave/requests/${request.id}/proof`))
          .status,
      ).toBe(404);
      const submitted = await change('emp_njl_1', request, 'submit');
      expect(submitted.status).toBe(200);
      request = submitted.json.data;
      expect(request.attachmentFileId).toBe(proof.id);
      expect((await change('emp_njl_1', request, 'submit')).status).toBe(409);
      expect(await db().repository('leaveProofFiles').count()).toBe(1);
    });
    it('allows applicant, current approver and HR while hiding future and unrelated approvers', async () => {
      for (const user of ['emp_njl_1', 'mgr_njl', 'hr01']) {
        const metadata = await call(
          user,
          'GET',
          `/leave/requests/${request.id}/proof`,
        );
        expect(metadata.status).toBe(200);
        expect(metadata.json.data.id).toBe(proof.id);
        expect(metadata.json.data.key).toBeUndefined();
        const response = await raw(user, 'GET', metadata.json.data.contentUrl);
        expect(response.status).toBe(200);
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      }
      for (const user of ['emp_njl_2', 'mgr_cd', 'mgr_east', 'trainer01']) {
        expect(
          (await call(user, 'GET', `/leave/requests/${request.id}/proof`))
            .status,
        ).toBe(404);
        expect((await raw(user, 'GET', proof.contentUrl)).status).toBe(404);
      }
      expect(
        (await call(null, 'GET', `/leave/requests/${request.id}/proof`)).status,
      ).toBe(401);
    });
    it('retains access for actual past approvers and respects revocation', async () => {
      const approved = await change('mgr_njl', request, 'decide', {
        decision: 'approved',
      });
      expect(approved.status).toBe(200);
      request = approved.json.data;
      expect((await raw('mgr_njl', 'GET', proof.contentUrl)).status).toBe(200);
      const rejected = await change('hr01', request, 'decide', {
        decision: 'rejected',
        comment: 'Test-only rejection',
      });
      expect(rejected.status).toBe(200);
      expect((await raw('mgr_njl', 'GET', proof.contentUrl)).status).toBe(200);
      const authz = server().application.container.resolve(authorizationToken);
      const original = (await authz.permissionSets.get('hr.manager'))!;
      await authz.permissionSets.update('hr.manager', {
        ...original,
        grants: original.grants.map((grant) =>
          grant.resource.type === 'composite' &&
          grant.resource.id === 'talent.leaveRequest'
            ? {
                ...grant,
                actions: grant.actions.filter(
                  (action) => action.action !== 'approve',
                ),
              }
            : grant,
        ),
      });
      try {
        expect((await raw('mgr_njl', 'GET', proof.contentUrl)).status).toBe(
          404,
        );
        expect(
          (await call('mgr_njl', 'GET', `/leave/requests/${request.id}/proof`))
            .status,
        ).toBe(404);
      } finally {
        await authz.permissionSets.update('hr.manager', original);
      }
      expect((await raw('mgr_njl', 'GET', proof.contentUrl)).status).toBe(200);
    });
  });
}
