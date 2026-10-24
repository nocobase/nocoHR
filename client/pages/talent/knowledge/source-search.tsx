import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { KnowledgeView } from '@nocobase/app-plugin-knowledge/client/pages';
import type { KnowledgeSpaceSummary } from '@nocobase/app-plugin-knowledge/shared/knowledge';
import type { DualKnowledgeSearch } from '../../../../server/providers/native-knowledge/service.js';
import { useRemote } from '#components/talent/use-remote';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '#components/talent/states';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';

function nativeKnowledgeLink(
  space: { scope: string; scopeId: string },
  doc?: string,
  lines?: readonly number[],
) {
  const params = new URLSearchParams({
    tab: 'search',
    scope: space.scope,
    scopeId: space.scopeId,
  });
  if (doc) params.set('doc', doc);
  if (lines) params.set('lines', lines.join('-'));
  return '/talent/knowledge?' + params.toString();
}
/** One explicit submit searches both sources; the existing HR document list remains unchanged. */
export function KnowledgeSourceSearch(): ReactElement {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const search = useRemote<DualKnowledgeSearch>(
    query ? 'talent/kb/search' : null,
    { q: query },
  );
  const spaces = useRemote<KnowledgeSpaceSummary[]>('talent/kb/spaces');
  const selected = spaces.data?.find(
    (s) =>
      s.space.scope === params.get('scope') &&
      s.space.scopeId === params.get('scopeId'),
  );
  if (params.has('scope'))
    return (
      <section className='flex min-w-0 flex-col gap-4'>
        <Button
          variant='outline'
          className='self-start'
          nativeButton={false}
          render={<Link to='/talent/knowledge?tab=search' />}
        >
          {t('nativeKnowledge.back')}
        </Button>
        {spaces.loading ? (
          <BlockSkeleton />
        ) : spaces.error ? (
          <LoadError error={spaces.error} onRetry={spaces.reload} />
        ) : selected ? (
          <KnowledgeView space={selected.space} className='h-[70vh] min-h-96' />
        ) : (
          <EmptyState title={t('nativeKnowledge.noSpaces')} />
        )}
      </section>
    );
  return (
    <section className='space-y-6'>
      <p className='text-sm text-muted-foreground'>
        {t('nativeKnowledge.description')}
      </p>
      <form
        className='flex flex-wrap items-end gap-2'
        onSubmit={(event) => {
          event.preventDefault();
          const value = draft.trim();
          if (value === query) search.reload();
          else setQuery(value);
        }}
      >
        <div className='min-w-0 flex-1 space-y-2'>
          <Label htmlFor='knowledge-source-query'>
            {t('nativeKnowledge.query')}
          </Label>
          <Input
            id='knowledge-source-query'
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
          />
        </div>
        <Button type='submit' disabled={!draft.trim() || search.loading}>
          {t('nativeKnowledge.search')}
        </Button>
      </form>
      {search.loading ? (
        <BlockSkeleton />
      ) : search.error ? (
        <LoadError error={search.error} onRetry={search.reload} />
      ) : search.data ? (
        <div className='grid gap-6 lg:grid-cols-2'>
          <section className='min-w-0 space-y-3'>
            <h2 className='font-semibold'>{t('nativeKnowledge.legacy')}</h2>
            {search.data.legacy.status === 'forbidden' ? (
              <p>{t('nativeKnowledge.sourceForbidden')}</p>
            ) : search.data.legacy.status === 'unavailable' ? (
              <p role='alert'>{t('nativeKnowledge.sourceUnavailable')}</p>
            ) : search.data.legacy.items.length ? (
              search.data.legacy.items.map((hit) => (
                <article
                  key={hit.documentId + ':' + hit.sectionIndex}
                  className='space-y-2 rounded-lg border p-4'
                >
                  <Link
                    className='font-medium text-primary underline underline-offset-4'
                    to={hit.path}
                  >
                    {hit.documentTitle} · {hit.sectionTitle}
                  </Link>
                  <p className='whitespace-pre-wrap break-words text-sm'>
                    {hit.excerpt}
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    {hit.citation}
                  </p>
                </article>
              ))
            ) : (
              <EmptyState title={t('nativeKnowledge.noResults')} />
            )}
          </section>
          <section className='min-w-0 space-y-3'>
            <h2 className='font-semibold'>{t('nativeKnowledge.native')}</h2>
            {search.data.native.status === 'unavailable' ? (
              <p role='alert'>{t('nativeKnowledge.sourceUnavailable')}</p>
            ) : (
              <>
                {search.data.native.semantic === 'unavailable' ? (
                  <p role='status' className='text-sm text-muted-foreground'>
                    {t('nativeKnowledge.semanticUnavailable')}
                  </p>
                ) : null}
                {search.data.native.items.length ? (
                  search.data.native.items.map((hit) => (
                    <article
                      key={hit.docId + ':' + hit.lines[0]}
                      className='space-y-2 rounded-lg border p-4'
                    >
                      <Link
                        className='font-medium text-primary underline underline-offset-4'
                        to={nativeKnowledgeLink(hit, hit.docId, hit.lines)}
                      >
                        {hit.title}
                      </Link>
                      <p className='whitespace-pre-wrap break-words text-sm'>
                        {hit.excerpt}
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        {hit.spaceTitle} ·{' '}
                        {t('nativeKnowledge.version', { version: hit.version })}{' '}
                        · {hit.headingPath.join(' / ')}
                      </p>
                    </article>
                  ))
                ) : (
                  <EmptyState title={t('nativeKnowledge.noResults')} />
                )}
              </>
            )}
          </section>
        </div>
      ) : null}
      <section className='space-y-3'>
        <h2 className='font-semibold'>{t('nativeKnowledge.spaces')}</h2>
        {spaces.loading ? (
          <BlockSkeleton />
        ) : spaces.error ? (
          <LoadError error={spaces.error} onRetry={spaces.reload} />
        ) : spaces.data?.length ? (
          <div className='flex flex-wrap gap-2'>
            {spaces.data.map((s) => (
              <Button
                key={JSON.stringify(s.space)}
                variant='outline'
                nativeButton={false}
                render={<Link to={nativeKnowledgeLink(s.space)} />}
              >
                {s.space.title}
              </Button>
            ))}
          </div>
        ) : (
          <EmptyState title={t('nativeKnowledge.noSpaces')} />
        )}
      </section>
      <p className='text-sm text-muted-foreground'>
        {t('nativeKnowledge.qaDeferred')}
      </p>
    </section>
  );
}
