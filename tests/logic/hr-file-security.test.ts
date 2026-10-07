// @vitest-environment node

// S3 and S5 of the 2026-10-07 production readiness review, on the demo data: an `hrFiles` upload names its purpose
// and is checked against it (permission, extension, stored type, first bytes); a lesson video, a contract scan and
// an employee attachment take only a file their editor uploaded for them, never another record's file; the lesson
// video endpoint serves only a video, with nosniff, a sandbox CSP and an inline disposition, streaming exactly the
// requested byte range; a practical record keeps only the photos taken on it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PASSWORD,
  startHarness,
  type Harness,
} from './talent-review-harness.ts';

let h: Harness;
const cookies = new Map<string, string>();

beforeAll(async () => {
  h = await startHarness('hr-file-security');
}, 240_000);

afterAll(async () => {
  await h?.close();
});

async function cookieOf(username: string): Promise<string> {
  const cached = cookies.get(username);
  if (cached) return cached;
  const response = await h.server.fetch(
    new Request(`${h.base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ');
  cookies.set(username, cookie);
  return cookie;
}

async function upload(
  username: string,
  url: string,
  file: File,
): Promise<{ status: number; json: Record<string, any> }> {
  const body = new FormData();
  body.append('file', file);
  const response = await h.server.fetch(
    new Request(`${h.base}${url}`, {
      method: 'POST',
      headers: { cookie: await cookieOf(username), origin: 'http://localhost' },
      body,
    }),
  );
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : {} };
}

const uploadHrFile = (username: string, purpose: string | null, file: File) =>
  upload(
    username,
    `/api/hrFiles/uploadOne${purpose ? `?purpose=${purpose}` : ''}`,
    file,
  );

async function get(
  username: string,
  url: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return h.server.fetch(
    new Request(`${h.base}${url}`, {
      headers: { cookie: await cookieOf(username), ...headers },
    }),
  );
}

/** A minimal ISO media file: an `ftyp` box, then numbered filler bytes. */
function mp4(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 24, ...Buffer.from('ftypisom')], 0);
  for (let i = 12; i < size; i += 1) bytes[i] = i % 251;
  return bytes;
}
const PDF = new TextEncoder().encode('%PDF-1.4\n%test scan\n');
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const HTML = new TextEncoder().encode(
  '<html><script>alert(document.cookie)</script></html>',
);

/** An hrFiles row the application stored itself (a payroll import, a mail attachment): no purpose, no uploader. */
async function storedFile(name: string, mimeType: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await (
    await h.db()
  )
    .query()
    .insertInto('hrFiles')
    .values({
      id,
      disk: 'local',
      key: `objects/${id}.${name.split('.').pop()}`,
      filename: name,
      ext: name.split('.').pop()!,
      mimeType,
      size: 10,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return id;
}

describe('hrFiles uploads', () => {
  it('needs a purpose and its permission, and refuses a file that is not of its type', async () => {
    const video = new File([mp4()], 'lesson.mp4', { type: 'video/mp4' });
    expect((await uploadHrFile('hr01', null, video)).json.code).toBe(
      'HR_FILE_PURPOSE_REQUIRED',
    );
    expect((await uploadHrFile('emp_njl_1', 'courseVideo', video)).status).toBe(
      403,
    );
    // An HTML page declared as HTML, or disguised as an MP4, is removed again and refused.
    for (const file of [
      new File([HTML], 'x.html', { type: 'text/html' }),
      new File([HTML], 'x.mp4', { type: 'video/mp4' }),
    ]) {
      const refused = await uploadHrFile('hr01', 'courseVideo', file);
      expect(refused.status).toBe(400);
      expect(refused.json.code).toBe('HR_FILE_TYPE_INVALID');
    }
    const kept = await (
      await h.db()
    )
      .query()
      .selectFrom('hrFiles')
      .select(['id'])
      .where('filename', 'in', ['x.html', 'x.mp4'])
      .execute();
    expect(kept).toEqual([]);
    const ok = await uploadHrFile('hr01', 'courseVideo', video);
    expect(ok.status).toBe(201);
    const row = await (
      await h.db()
    )
      .query()
      .selectFrom('hrFiles')
      .select(['purpose', 'uploadedByUserId'])
      .where('id', '=', ok.json.data.record.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({
      purpose: 'courseVideo',
      uploadedByUserId: await h.userId('hr01'),
    });
  });

  it('reads back only the caller’s own uploads', async () => {
    const own = await uploadHrFile(
      'hr01',
      'contract',
      new File([PDF], 'scan.pdf', { type: 'application/pdf' }),
    );
    const findOne = async (username: string) => {
      const response = await h.server.fetch(
        new Request(`${h.base}/api/hrFiles/findOne`, {
          method: 'POST',
          headers: {
            cookie: await cookieOf(username),
            origin: 'http://localhost',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ filter: { id: own.json.data.record.id } }),
        }),
      );
      return JSON.stringify(await response.json());
    };
    expect(await findOne('hr01')).toContain('scan.pdf');
    expect(await findOne('trainer01')).not.toContain('scan.pdf');
  });
});

describe('lesson videos (S3)', () => {
  let videoId: string;
  let lessonId: string;
  const bytes = mp4();

  it('refuses a video that was not uploaded as course content by the caller', async () => {
    const contractScan = (
      await uploadHrFile(
        'hr01',
        'contract',
        new File([PDF], 'contract.pdf', { type: 'application/pdf' }),
      )
    ).json.data.record.id as string;
    const legacyHtml = await storedFile('page.html', 'text/html');
    const legacyMp4 = await storedFile('old.mp4', 'video/mp4');
    for (const fileId of [contractScan, legacyHtml, legacyMp4]) {
      const saved = await h.call('hr01', 'POST', '/courses', {
        title: '视频课程',
        lessons: [
          {
            title: '第一节',
            contentType: 'video',
            videoFileId: fileId,
            videoSeconds: 60,
          },
        ],
      });
      expect(saved.status).toBe(404);
      expect(saved.json.code).toBe('LESSON_VIDEO_INVALID');
    }
  });

  it('saves an uploaded MP4 and streams exactly the requested range with the security headers', async () => {
    videoId = (
      await uploadHrFile(
        'hr01',
        'courseVideo',
        new File([bytes], '安全培训.mp4', { type: 'video/mp4' }),
      )
    ).json.data.record.id;
    const saved = await h.call('hr01', 'POST', '/courses', {
      title: '设备安全视频课',
      lessons: [
        {
          title: '第一节',
          contentType: 'video',
          videoFileId: videoId,
          videoSeconds: 60,
        },
      ],
    });
    expect(saved.status).toBe(201);
    lessonId = saved.json.data.lessons[0].id;
    // Saving the course again keeps the video it already shows.
    expect(
      (
        await h.call('hr01', 'PATCH', `/courses/${saved.json.data.id}`, {
          lessons: [
            {
              id: lessonId,
              title: '第一节',
              contentType: 'video',
              videoFileId: videoId,
              videoSeconds: 60,
            },
          ],
        })
      ).status,
    ).toBe(200);

    const url = `/api/talent/learning/lessons/${lessonId}/video`;
    const ranged = await get('hr01', url, { range: 'bytes=100-199' });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe(
      `bytes 100-199/${bytes.length}`,
    );
    expect(ranged.headers.get('content-length')).toBe('100');
    expect(ranged.headers.get('content-type')).toBe('video/mp4');
    expect(ranged.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ranged.headers.get('content-security-policy')).toBe(
      "sandbox; default-src 'none'",
    );
    expect(ranged.headers.get('content-disposition')).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent('安全培训.mp4')}`,
    );
    expect(new Uint8Array(await ranged.arrayBuffer())).toEqual(
      bytes.slice(100, 200),
    );

    const suffix = await get('hr01', url, { range: 'bytes=-10' });
    expect(new Uint8Array(await suffix.arrayBuffer())).toEqual(
      bytes.slice(-10),
    );
    const open = await get('hr01', url, { range: 'bytes=4000-' });
    expect(open.status).toBe(206);
    expect(new Uint8Array(await open.arrayBuffer())).toEqual(bytes.slice(4000));
    const whole = await get('hr01', url);
    expect(whole.status).toBe(200);
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);
    expect(
      (await get('hr01', url, { range: `bytes=${bytes.length}-` })).status,
    ).toBe(416);
  });

  it('never serves a stored file of another type as a lesson video', async () => {
    // A lesson saved before this check, pointing at an HTML file.
    const html = await storedFile('page.html', 'text/html');
    await (
      await h.db()
    )
      .query()
      .updateTable('lessons')
      .set({ videoFileId: html })
      .where('id', '=', lessonId)
      .execute();
    const response = await get(
      'hr01',
      `/api/talent/learning/lessons/${lessonId}/video`,
    );
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).not.toContain('text/html');
    await (
      await h.db()
    )
      .query()
      .updateTable('lessons')
      .set({ videoFileId: videoId })
      .where('id', '=', lessonId)
      .execute();
  });
});

describe('contract scans and employee attachments (S5)', () => {
  const pdf = (name: string) =>
    new File([PDF], name, { type: 'application/pdf' });

  async function contractIds(): Promise<string[]> {
    const listed = await h.call('hr01', 'GET', '/contracts');
    expect(listed.status).toBe(200);
    const data = listed.json.data;
    const items = (Array.isArray(data) ? data : data.items) as {
      id: string;
    }[];
    return items.map((item) => item.id);
  }

  it('attaches only a scan the caller uploaded for a contract and no other record holds', async () => {
    const [first, second] = await contractIds();
    const scan = (await uploadHrFile('hr01', 'contract', pdf('合同扫描件.pdf')))
      .json.data.record.id as string;
    const attached = await h.call('hr01', 'POST', `/contracts/${first}/file`, {
      fileId: scan,
    });
    expect(attached.status).toBe(200);
    // The normal flow still downloads the attached scan.
    const content = await get('hr01', `/uploads/hr-files/${scan}.pdf`);
    expect(content.status).toBe(200);
    // Saving it again is fine; a second contract cannot take it.
    expect(
      (
        await h.call('hr01', 'POST', `/contracts/${first}/file`, {
          fileId: scan,
        })
      ).status,
    ).toBe(200);
    const elsewhere = await h.call(
      'hr01',
      'POST',
      `/contracts/${second}/file`,
      { fileId: scan },
    );
    expect(elsewhere.status).toBe(404);
    expect(elsewhere.json.code).toBe('CONTRACT_FILE_NOT_FOUND');
    // A payroll import, an attachment uploaded for a profile, or another user's upload is refused.
    const payroll = await storedFile(
      '工资导入.xlsx',
      'application/octet-stream',
    );
    const profileFile = (
      await uploadHrFile('hr01', 'profileAttachment', pdf('学历.pdf'))
    ).json.data.record.id as string;
    const foreign = await storedFile('别人的扫描件.pdf', 'application/pdf');
    await (
      await h.db()
    )
      .query()
      .updateTable('hrFiles')
      .set({
        purpose: 'contract',
        uploadedByUserId: await h.userId('trainer01'),
      })
      .where('id', '=', foreign)
      .execute();
    for (const fileId of [payroll, profileFile, foreign])
      expect(
        (
          await h.call('hr01', 'POST', `/contracts/${second}/file`, {
            fileId,
          })
        ).json.code,
      ).toBe('CONTRACT_FILE_NOT_FOUND');
  });

  it('adds an attachment uploaded for the profile, and refuses other files', async () => {
    const own = (
      await uploadHrFile('hr01', 'profileAttachment', pdf('毕业证.pdf'))
    ).json.data.record.id as string;
    const added = await h.call(
      'hr01',
      'POST',
      '/employees/emp-sunli/profile/attachments',
      { fileId: own, category: 'diploma', title: '毕业证' },
    );
    expect(added.status).toBeLessThan(300);
    const itemId = added.json.data.id as string;
    // Editing the attachment keeps its file.
    expect(
      (
        await h.call(
          'hr01',
          'PATCH',
          `/employees/emp-sunli/profile/attachments/${itemId}`,
          { fileId: own, category: 'diploma', title: '毕业证（原件）' },
        )
      ).status,
    ).toBe(200);
    const contractScan = (
      await uploadHrFile('hr01', 'contract', pdf('合同.pdf'))
    ).json.data.record.id as string;
    const mailAttachment = await storedFile('简历.pdf', 'application/pdf');
    for (const fileId of [own, contractScan, mailAttachment]) {
      const refused = await h.call(
        'hr01',
        'POST',
        '/employees/emp-wanglei/profile/attachments',
        { fileId, category: 'other', title: 'x' },
      );
      expect(refused.status).toBe(404);
      expect(refused.json.code).toBe('PROFILE_FILE_NOT_FOUND');
    }
  });
});

describe('practical record photos (S5)', () => {
  it('keeps only the photos taken on the record', async () => {
    const started = await h.call('trainer01', 'POST', '/practicals/records', {
      assessmentId: 'pa-demo-cnc-first-article',
      employeeId: 'emp-qianjin',
      witnessUserId: await h.userId('qa_audit'),
    });
    expect(started.status).toBe(201);
    const id = started.json.data.id as string;
    const photo = await upload(
      'trainer01',
      `/api/talent/practicals/records/${id}/attachments`,
      new File([PNG], '首件.png', { type: 'image/png' }),
    );
    expect(photo.status).toBe(201);
    const own = photo.json.data.attachments[0] as string;
    const foreign = await storedFile('合同扫描件.pdf', 'application/pdf');
    const refused = await h.call(
      'trainer01',
      'PATCH',
      `/practicals/records/${id}`,
      {
        attachments: [own, foreign],
      },
    );
    expect(refused.status).toBe(400);
    expect(refused.json.code).toBe('PRACTICAL_ATTACHMENT_INVALID');
    const kept = await h.call(
      'trainer01',
      'PATCH',
      `/practicals/records/${id}`,
      {
        attachments: [own],
      },
    );
    expect(kept.status).toBe(200);
    const removed = await h.call(
      'trainer01',
      'PATCH',
      `/practicals/records/${id}`,
      {
        attachments: [],
      },
    );
    expect(removed.status).toBe(200);
    expect(removed.json.data.attachments).toEqual([]);
  });
});
