import type { ReactElement } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils';

/**
 * Renders lesson and document Markdown with the application's typography
 * tokens. Raw HTML is not rendered, so content cannot inject markup.
 * Application paths (`/talent/...`, as in the HR assistant's report links)
 * navigate inside the app, so the deployment base path is kept; other links
 * open in a new tab.
 */
const COMPONENTS: Components = {
  a: ({ href, children }) =>
    href?.startsWith('/') && !href.startsWith('//') ? (
      <Link to={href}>{children}</Link>
    ) : (
      <a href={href} target='_blank' rel='noreferrer'>
        {children}
      </a>
    ),
};

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}): ReactElement {
  return (
    <div
      className={cn(
        'space-y-3 text-sm leading-relaxed text-foreground',
        '[&_h1]:font-heading [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:font-heading [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-heading [&_h3]:font-semibold',
        '[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline',
        '[&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
