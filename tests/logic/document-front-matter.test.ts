import { describe, expect, it } from 'vitest';

import {
  FICTION_NOTE,
  withFileProperties,
} from '../../database/seed-data/demo-learning.ts';
import {
  extractDocumentText,
  stripFrontMatter,
} from '../../server/providers/hr/document-text.ts';

// The demo documents' 虚构资料 note is a file property (V1-04 / V3-09): it is in the stored file, never in the text.
describe('Markdown file properties', () => {
  it('keeps the fictional-content note out of the extracted text', async () => {
    const file = withFileProperties('# 1 目的\n\n规范数控车床操作。');
    expect(file).toContain(FICTION_NOTE);
    const text = await extractDocumentText(
      new TextEncoder().encode(file),
      'markdown',
    );
    expect(text).not.toContain('虚构');
    expect(text).toContain('规范数控车床操作');
  });

  it('leaves a document without front matter, or with a later rule, alone', () => {
    const body = '# 标题\n\n正文\n\n---\n\n附录';
    expect(stripFrontMatter(body)).toBe(body);
  });
});
