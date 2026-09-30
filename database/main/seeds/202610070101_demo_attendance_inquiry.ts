import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * V2-05 (realigned) 测试数据, development and demo only: the clause 李敏's
 * 考勤异常说明 cites. 《考勤与加班管理制度》 (HR-POL-0002, seeded with the V1-04
 * knowledge base) gains, under 迟到与缺卡, "因公司班车晚点导致的迟到，可在 2 日内
 * 提交说明". Written once: skipped when the document is absent (the knowledge
 * demo is off) or already says it. `HR_DEMO_SEED=false` or
 * `HR_ATTENDANCE_DEMO=false` skips it.
 *
 * The rest of the demo (李敏 12 分钟迟到 and 钱进 two missed check-outs in the
 * device export, the shifts and schedules) is the V2-05 demo seed; the
 * rules' 允许说明豁免 is on by the column default.
 */
const DOCUMENT_ID = 'doc-hr-pol-0002';
const CLAUSE =
  '因公司班车晚点导致的迟到，可在 2 日内提交考勤异常说明，经直接上级批准后不计入月度迟到次数。';

const seed: SeedDefinition = defineSeed({
  name: '202610070101_demo_attendance_inquiry',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_ATTENDANCE_DEMO === 'false'
    )
      return;
    const document = await query
      .selectFrom('kbDocuments')
      .select(['id', 'contentText', 'fileId'])
      .where('id', '=', DOCUMENT_ID)
      .executeTakeFirst();
    if (!document) return;
    const text =
      typeof document.contentText === 'string' ? document.contentText : '';
    if (!text || text.includes('班车晚点')) return;
    const heading = '# 3 迟到与缺卡\n';
    const at = text.indexOf(heading);
    if (at < 0) return;
    // After the section's first paragraph.
    const lineEnd = text.indexOf('\n', at + heading.length);
    const insertAt = lineEnd < 0 ? text.length : lineEnd;
    const content = `${text.slice(0, insertAt)}\n${CLAUSE}${text.slice(insertAt)}`;
    const now = new Date();
    await query
      .updateTable('kbDocuments')
      .set({ contentText: content, updatedAt: now })
      .where('id', '=', DOCUMENT_ID)
      .execute();
    // The stored file the knowledge base previews says the same.
    if (typeof document.fileId === 'string') {
      const file = await query
        .selectFrom('hrFiles')
        .select(['id', 'key'])
        .where('id', '=', document.fileId)
        .executeTakeFirst();
      if (file && typeof file.key === 'string') {
        const bytes = Buffer.from(content, 'utf8');
        const target = path.resolve(process.cwd(), 'storage', file.key);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, bytes);
        await query
          .updateTable('hrFiles')
          .set({ size: bytes.length, updatedAt: now })
          .where('id', '=', document.fileId)
          .execute();
      }
    }
  },
});

export default seed;
