// @vitest-environment node

// The PDF renderer writes the middle dot "·" as U+30FB: STSong-Light's UniGB-UCS2-H turns U+00B7 into a
// triangle in macOS Preview, which showed in every footer ("启衡精密科技 ▲ 1/1").
import { describe, expect, it } from 'vitest';

import { pdfText, renderPdf } from '../../server/providers/hr/profile/pdf.ts';

describe('PDF middle dot', () => {
  it('encodes the middle dot as U+30FB and reads it back', () => {
    const bytes = renderPdf([{ kind: 'text', text: '苏州工厂 · 机加工车间' }], {
      title: '离职证明',
      footer: '启衡精密科技',
    });
    const source = Buffer.from(bytes).toString('latin1');
    expect(source).not.toMatch(/<(?:[0-9a-f]{4})*00b7/u);
    expect(source).toMatch(/30fb/u);
    const text = pdfText(bytes);
    expect(text).toContain('苏州工厂 · 机加工车间');
    expect(text).toContain('启衡精密科技 · 1/1');
  });
});
