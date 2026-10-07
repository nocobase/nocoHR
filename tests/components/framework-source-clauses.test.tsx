import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      key === 'talent.framework.sourceBasis'
        ? `依据：${String(values?.clauses)}`
        : `${key} ${JSON.stringify(values ?? {})}`,
  }),
}));

import { SourceClauses } from '../../client/pages/talent/framework/source-clauses';

describe('SourceClauses', () => {
  it('wraps inside its cell, shows two lines and keeps the whole basis on hover', () => {
    const quote =
      '负责华东区重点客户的解决方案设计、方案演示与技术澄清，协同交付团队完成试点项目';
    render(
      <SourceClauses
        clauses={[1, 2, 3].map((number) => ({
          source: 'jd' as const,
          number,
          section: '岗位职责',
          item: String(number),
          quote,
        }))}
      />,
    );
    const line = screen.getByText(/^依据：/u);
    expect(line.className).toContain('whitespace-normal');
    expect(line.className).toContain('break-words');
    expect(line.className).toContain('line-clamp-2');
    expect(line.getAttribute('title')).toBe(line.textContent);
  });

  it('shows nothing for a requirement without clauses', () => {
    const { container } = render(<SourceClauses clauses={null} />);
    expect(container.textContent).toBe('');
  });
});
