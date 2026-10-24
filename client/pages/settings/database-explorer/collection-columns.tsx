import { useTranslation } from '@nocobase/i18n/client';
import { useCallback, type ReactElement } from 'react';
import { useOutletContext } from 'react-router';

import { explorerErrorMessage } from './lib/errors.js';
import { physicalColumns } from './lib/fields.js';
import { useResource } from './lib/use-resource.js';
import type { CollectionPaneContext } from './database-explorer-page.js';
import { DataTable, Loading, Notice } from './parts.js';

/**
 * The Physical columns pane.
 *
 * Its own request, made only when this route is open: the physical schema
 * costs a second full inspection of the same table, which would otherwise be
 * paid on every Collection a viewer clicks for a pane most never open.
 */
export default function CollectionColumnsPane(): ReactElement {
  const { t } = useTranslation();
  const { connection, collection, explorer } =
    useOutletContext<CollectionPaneContext>();

  const key =
    connection === undefined || collection === undefined
      ? undefined
      : JSON.stringify([connection, collection]);
  const physical = useResource(
    key,
    useCallback(
      (selection: string) => {
        const [name, table] = JSON.parse(selection) as [string, string];
        return explorer.physicalCollection(name, table);
      },
      [explorer],
    ),
  );

  if (physical.error) {
    return (
      <div className='p-4'>
        <Notice tone='destructive'>
          {explorerErrorMessage(physical.error, t)}
        </Notice>
      </div>
    );
  }
  if (!physical.value) {
    return (
      <div className='p-4'>
        <Loading label={t('databaseExplorer.states.loading')} />
      </div>
    );
  }

  return (
    <DataTable
      caption={t('databaseExplorer.tabs.columns')}
      headers={[
        t('databaseExplorer.columns.name'),
        t('databaseExplorer.columns.nativeType'),
        t('databaseExplorer.columns.nullable'),
        t('databaseExplorer.columns.length'),
        t('databaseExplorer.columns.collation'),
      ]}
      rows={physicalColumns(physical.value).map((column) => [
        column.columnName,
        column.nativeType,
        column.nullable
          ? t('databaseExplorer.labels.yes')
          : t('databaseExplorer.labels.no'),
        column.length === undefined ? '' : String(column.length),
        column.collation ?? '',
      ])}
      empty={t('databaseExplorer.empty.columns')}
    />
  );
}
